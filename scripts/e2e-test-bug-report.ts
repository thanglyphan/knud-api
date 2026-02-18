/**
 * E2E Test: The Daniel Bente Bug-Report Scenario
 * 
 * Replicates the EXACT production bug where a user:
 * 1. Uploaded 4 PDF receipts (IKEA, Electrolux, Matværste, Norgespakke)
 * 2. AI analyzed them, identified 3 purchases + 1 unknown
 * 3. User said "uten leverandør på matværste, registrer ikea som leverandør, den fjerne må du også registrere"
 * 4. AI asked for IKEA info + konto for Matværste
 * 5. User said "Bare opprett med ikea. konto 5911, intern middag med kollegaer"
 * 6. AI presented summary, user said "JA"
 * 
 * BUGS THAT OCCURRED:
 * - Files disappeared after "JA" (new HTTP request had no files)
 * - AI went into a loop re-asking about IKEA supplier it already agreed to create
 * - AI suggested konto 6900 which doesn't exist in Fiken
 * - AI lost context and couldn't recover from errors
 * - AI re-asked "hvilken leverandør?" for things already decided
 * 
 * This test validates all Round 3 fixes prevent these issues.
 * 
 * Prerequisites:
 *   - API server running on localhost:3001
 *   - Valid Fiken user token (demo account)
 *   - Docker DB running
 * 
 * Usage:
 *   npx tsx scripts/e2e-test-bug-report.ts
 *   npx tsx scripts/e2e-test-bug-report.ts --verbose
 *   npx tsx scripts/e2e-test-bug-report.ts --step=1    # Run up to step N
 */

const BUG_API_URL = "http://localhost:3001";
const BUG_USER_ID = "678b5c02-c4a1-4496-a479-006f257c37ab";

// ============================================
// Types
// ============================================

interface BugParsedStream {
  fullText: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args?: unknown }>;
  toolResults: Array<{ toolCallId: string; result: unknown }>;
  errors: string[];
  textChunks: number;
}

interface BugConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// ============================================
// ANSI colors
// ============================================

const bc = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

let BUG_VERBOSE = false;

// ============================================
// SSE Stream Parser
// ============================================

async function bugParseSSEStream(response: Response): Promise<BugParsedStream> {
  const result: BugParsedStream = {
    fullText: "",
    toolCalls: [],
    toolResults: [],
    errors: [],
    textChunks: 0,
  };

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      const textMatch = line.match(/^0:"(.*)"/);
      if (textMatch) {
        const content = textMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        result.fullText += content;
        result.textChunks++;
      }

      if (line.startsWith("9:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolCalls.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            toolName: data.toolName || data.name || "unknown",
          });
        } catch { /* ignore */ }
      }

      if (line.startsWith("a:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolResults.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            result: data.result || data,
          });
        } catch { /* ignore */ }
      }

      if (line.startsWith("e:")) {
        try {
          const data = JSON.parse(line.slice(2));
          if (data?.error) {
            result.errors.push(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
          }
        } catch { /* ignore */ }
      }
    }
  }

  if (buffer.trim()) {
    const textMatch = buffer.match(/^0:"(.*)"/);
    if (textMatch) {
      const content = textMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      result.fullText += content;
      result.textChunks++;
    }
  }

  return result;
}

// ============================================
// API helper
// ============================================

async function bugSendChat(
  messages: Array<{ role: string; content: string }>,
  files?: Array<{ name: string; type: string; data: string }>,
  filesResend?: boolean,
): Promise<BugParsedStream> {
  const body: Record<string, unknown> = { messages };
  if (files && files.length > 0) {
    body.files = files;
    if (filesResend) {
      body.filesResend = true;
    }
  }

  const response = await fetch(`${BUG_API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${BUG_USER_ID}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorBody}`);
  }

  return bugParseSSEStream(response);
}

// ============================================
// Helpers
// ============================================

function getPlaceholderPDF(): string {
  // Minimal valid PNG used as placeholder — the actual file content matters
  // less than the fact that files are sent and persisted across turns
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

function bugTextContains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

function bugTextNotContains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return !patterns.some(p => lower.includes(p.toLowerCase()));
}

function bugDelegatedTo(result: BugParsedStream, agentTool: string): boolean {
  return result.toolCalls.some(tc => tc.toolName === agentTool);
}

function bugCalledTool(result: BugParsedStream, toolName: string): boolean {
  return result.toolCalls.some(tc => tc.toolName === toolName);
}

// ============================================
// Test infrastructure
// ============================================

interface StepAssertion {
  name: string;
  check: () => boolean;
}

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assertStep(name: string, passed: boolean, detail?: string): void {
  totalAssertions++;
  if (passed) {
    passedAssertions++;
    console.log(`    ${bc.green}✓${bc.reset} ${name}${detail ? ` ${bc.dim}— ${detail}${bc.reset}` : ""}`);
  } else {
    failedAssertions++;
    console.log(`    ${bc.red}✗${bc.reset} ${name}${detail ? ` ${bc.dim}— ${detail}${bc.reset}` : ""}`);
  }
}

function printResponse(result: BugParsedStream): void {
  if (BUG_VERBOSE) {
    console.log(`    ${bc.dim}Tools: ${result.toolCalls.map(tc => tc.toolName).join(" → ") || "none"}${bc.reset}`);
    const truncated = result.fullText.substring(0, 400);
    console.log(`    ${bc.dim}Response: ${truncated}${result.fullText.length > 400 ? "..." : ""}${bc.reset}`);
  }
}

// ============================================
// THE BUG-REPORT SCENARIO
// ============================================

async function runBugReportScenario(maxStep?: number): Promise<void> {
  const history: BugConversationMessage[] = [];
  
  // The 4 "receipts" (placeholder images — real PDFs aren't needed for flow testing)
  const fourFiles = [
    { name: "NOINV25000000008669.pdf", type: "application/pdf", data: getPlaceholderPDF() },
    { name: "Electrolux Kvittering 2253502653.PDF", type: "application/pdf", data: getPlaceholderPDF() },
    { name: "receipt.pdf", type: "application/pdf", data: getPlaceholderPDF() },
    { name: "kvittering-norgespakke-liten-e699bdf6-da21-46e6-9dc9-9b5bc4206eb1.pdf", type: "application/pdf", data: getPlaceholderPDF() },
  ];

  const stepLimit = maxStep || 99;

  // ═══════════════════════════════════════════════
  // STEP 1: Upload 4 receipts + "før disse inn i regnskapet mitt"
  // Expected: AI analyzes all 4, identifies purchases, asks about unknowns
  // ═══════════════════════════════════════════════
  if (stepLimit < 1) return;
  console.log(`\n${bc.bold}═══ Step 1: Upload 4 receipts${bc.reset}`);
  console.log(`${bc.dim}  "før disse inn i regnskapet mitt" + 4 PDF files${bc.reset}`);
  
  const step1Start = Date.now();
  const step1 = await bugSendChat(
    [{ role: "user", content: "før disse inn i regnskapet mitt" }],
    fourFiles,
  );
  const step1Duration = ((Date.now() - step1Start) / 1000).toFixed(1);
  console.log(`  ${bc.dim}(${step1Duration}s)${bc.reset}`);
  
  printResponse(step1);

  assertStep(
    "Delegates to purchase agent",
    bugDelegatedTo(step1, "delegateToPurchaseAgent"),
  );
  assertStep(
    "Response is not empty",
    step1.fullText.trim().length > 30,
    `${step1.fullText.trim().length} chars`,
  );
  assertStep(
    "Acknowledges multiple files/purchases",
    bugTextContains(step1.fullText, "kjøp", "kvittering", "faktura", "fil"),
  );
  assertStep(
    "No fatal errors",
    step1.errors.length === 0,
    step1.errors.length > 0 ? step1.errors[0] : undefined,
  );
  // BUG CHECK: AI must NOT suggest konto 6900
  assertStep(
    "BUG FIX: Does NOT suggest invalid konto 6900",
    bugTextNotContains(step1.fullText, "6900"),
    bugTextContains(step1.fullText, "6900") ? "FOUND 6900 in response!" : "OK — no 6900",
  );

  history.push({ role: "user", content: "før disse inn i regnskapet mitt" });
  history.push({ role: "assistant", content: step1.fullText });

  // ═══════════════════════════════════════════════
  // STEP 2: User gives instructions about suppliers
  // "uten leverandør på matværste, registrer ikea som leverandør, den fjerne må du også registrere"
  // Expected: AI should accept instructions and proceed, not ask for contactId
  // ═══════════════════════════════════════════════
  if (stepLimit < 2) return;
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(`\n${bc.bold}═══ Step 2: Supplier instructions${bc.reset}`);
  console.log(`${bc.dim}  "uten leverandør på matværste, registrer ikea som leverandør, den fjerne..."${bc.reset}`);

  const step2Msg = "uten leverandør på matværste, registrer ikea som leverandør. den fjerne må du også registrere";
  const step2Msgs = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: step2Msg },
  ];

  const step2Start = Date.now();
  const step2 = await bugSendChat(step2Msgs, fourFiles, true);
  const step2Duration = ((Date.now() - step2Start) / 1000).toFixed(1);
  console.log(`  ${bc.dim}(${step2Duration}s)${bc.reset}`);
  
  printResponse(step2);

  assertStep(
    "Delegates to purchase or contact agent",
    bugDelegatedTo(step2, "delegateToPurchaseAgent") || bugDelegatedTo(step2, "delegateToContactAgent"),
  );
  assertStep(
    "Response acknowledges user instructions",
    bugTextContains(step2.fullText, "ikea", "IKEA", "matværste", "leverandør", "opprett", "konto", "stemmer"),
  );
  // BUG CHECK: Must NOT ask user for contactId
  assertStep(
    "BUG FIX: Does NOT ask user for contactId",
    bugTextNotContains(step2.fullText, "contactId", "kontakt-ID", "leverandør-ID"),
    bugTextContains(step2.fullText, "contactId") ? "FOUND contactId request!" : "OK",
  );
  // BUG CHECK: Must NOT say "VEDLAGTE FILER" (files are resent, not new)
  assertStep(
    "BUG FIX: Does NOT re-analyze files as new uploads",
    bugTextNotContains(step2.fullText, "VEDLAGTE FILER", "har lastet opp nye filer"),
    "Files sent with filesResend=true should be silent",
  );
  assertStep(
    "No fatal errors",
    step2.errors.length === 0,
    step2.errors.length > 0 ? step2.errors[0] : undefined,
  );

  history.push({ role: "user", content: step2Msg });
  history.push({ role: "assistant", content: step2.fullText });

  // ═══════════════════════════════════════════════
  // STEP 3: User gives konto + IKEA details
  // "Bare opprett med ikea. konto 5911, intern middag med kollegaer"
  // Expected: AI should NOT ask again about IKEA. Should present final summary.
  // ═══════════════════════════════════════════════
  if (stepLimit < 3) return;
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(`\n${bc.bold}═══ Step 3: Konto + IKEA details${bc.reset}`);
  console.log(`${bc.dim}  "Bare opprett med ikea. konto 5911, intern middag med kollegaer"${bc.reset}`);

  const step3Msg = "Bare opprett med ikea. konto 5911, intern middag med kollegaer";
  const step3Msgs = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: step3Msg },
  ];

  const step3Start = Date.now();
  const step3 = await bugSendChat(step3Msgs, fourFiles, true);
  const step3Duration = ((Date.now() - step3Start) / 1000).toFixed(1);
  console.log(`  ${bc.dim}(${step3Duration}s)${bc.reset}`);

  printResponse(step3);

  assertStep(
    "Delegates to agent(s)",
    bugDelegatedTo(step3, "delegateToPurchaseAgent") || bugDelegatedTo(step3, "delegateToContactAgent"),
  );
  // BUG CHECK: Must NOT re-ask about IKEA supplier — user already said "bare opprett"
  assertStep(
    "BUG FIX: Does NOT re-ask about IKEA (loop prevention)",
    bugTextNotContains(step3.fullText, "trenger jeg litt mer informasjon om IKEA", "organisasjonsnummer for IKEA", "IKEA finnes ikke"),
    "Should accept 'bare opprett med ikea' without looping",
  );
  // Should present a summary or proceed
  assertStep(
    "Presents summary or proceeds with registration",
    bugTextContains(step3.fullText, "stemmer", "bekreft", "registrer", "opprett", "kjøp", "5911"),
  );
  // BUG CHECK: No invalid konto
  assertStep(
    "BUG FIX: Does NOT suggest invalid konto 6900",
    bugTextNotContains(step3.fullText, "6900"),
  );
  assertStep(
    "No fatal errors",
    step3.errors.length === 0,
    step3.errors.length > 0 ? step3.errors[0] : undefined,
  );

  history.push({ role: "user", content: step3Msg });
  history.push({ role: "assistant", content: step3.fullText });

  // ═══════════════════════════════════════════════
  // STEP 4: User says "JA" to confirm
  // Expected: AI should CREATE all entities, NOT re-ask anything.
  // This is where the original bug manifested — files disappeared,
  // AI lost context and re-asked about IKEA supplier.
  // ═══════════════════════════════════════════════
  if (stepLimit < 4) return;
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log(`\n${bc.bold}═══ Step 4: User says "JA" — the critical moment${bc.reset}`);
  console.log(`${bc.dim}  This is where the original bug caused files to disappear and AI to loop${bc.reset}`);

  const step4Msg = "JA";
  const step4Msgs = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: step4Msg },
  ];

  const step4Start = Date.now();
  // CRITICAL: Files are resent with filesResend=true (simulating frontend behavior)
  const step4 = await bugSendChat(step4Msgs, fourFiles, true);
  const step4Duration = ((Date.now() - step4Start) / 1000).toFixed(1);
  console.log(`  ${bc.dim}(${step4Duration}s)${bc.reset}`);

  printResponse(step4);

  assertStep(
    "Delegates to agent(s) to execute",
    bugDelegatedTo(step4, "delegateToPurchaseAgent") || bugDelegatedTo(step4, "delegateToContactAgent"),
  );
  // BUG CHECK: Must NOT re-ask about IKEA — the whole conversation already decided this
  assertStep(
    "BUG FIX: Does NOT re-ask about IKEA supplier after JA",
    bugTextNotContains(step4.fullText, "IKEA finnes ikke", "finnes ikke som leverandør"),
    "AI should remember IKEA was agreed to be created",
  );
  // BUG CHECK: Must NOT ask for supplier info again
  assertStep(
    "BUG FIX: Does NOT re-ask 'trenger leverandør-ID'",
    bugTextNotContains(step4.fullText, "trenger jeg leverandør-ID", "trenger leverandør-ID"),
    "AI should not request supplier IDs from user",
  );
  // BUG CHECK: Must NOT say 'feil' about missing identifier (the bug)
  assertStep(
    "BUG FIX: Does NOT fail on missing identifier",
    bugTextNotContains(step4.fullText, "manglet et nødvendig felt (identifier)"),
    "Identifier error was a symptom of lost context",
  );
  // BUG CHECK: Must NOT suggest konto 6900
  assertStep(
    "BUG FIX: Does NOT use invalid konto 6900",
    bugTextNotContains(step4.fullText, "6900"),
  );
  // Should show progress — creating, registering, or asking for final details
  assertStep(
    "Shows progress or results",
    bugTextContains(step4.fullText, "registrert", "opprettet", "fullført", "oppretter", "kjøp", "leverandør", "konto", "stemmer"),
    "Should indicate things are being created",
  );
  assertStep(
    "No fatal errors",
    step4.errors.length === 0,
    step4.errors.length > 0 ? step4.errors[0] : undefined,
  );

  // BUG CHECK: If the AI asks a follow-up, it must be about something NEW, 
  // not something already decided
  const isReAskingDecidedThings = 
    bugTextContains(step4.fullText, "hvordan ønsker du") &&
    bugTextContains(step4.fullText, "IKEA") &&
    bugTextContains(step4.fullText, "leverandør");
  assertStep(
    "BUG FIX: Does NOT re-ask 'hvordan ønsker du' about already-decided IKEA",
    !isReAskingDecidedThings,
    isReAskingDecidedThings ? "LOOPING — re-asked about IKEA after it was decided!" : "OK",
  );

  history.push({ role: "user", content: step4Msg });
  history.push({ role: "assistant", content: step4.fullText });

  // ═══════════════════════════════════════════════
  // STEP 5: If AI needs follow-up, provide it — but verify it's not a loop
  // Expected: If the AI asks anything at this point, it should be about
  // genuinely missing info (like a specific account), NOT about suppliers
  // or files that were already discussed.
  // ═══════════════════════════════════════════════
  if (stepLimit < 5) return;
  
  // Only continue if the AI asked something (didn't just complete everything)
  const aiAskedSomething = bugTextContains(step4.fullText, "?");
  
  if (aiAskedSomething) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`\n${bc.bold}═══ Step 5: Follow-up answer (AI asked a question)${bc.reset}`);
    console.log(`${bc.dim}  Answering any remaining questions — verifying no loop${bc.reset}`);

    // Give a comprehensive answer that should resolve any remaining questions
    const step5Msg = "Ja, bare gjør det. Bruk de kontoene du foreslår. Opprett IKEA med bare navn.";
    const step5Msgs = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: step5Msg },
    ];

    const step5Start = Date.now();
    const step5 = await bugSendChat(step5Msgs, fourFiles, true);
    const step5Duration = ((Date.now() - step5Start) / 1000).toFixed(1);
    console.log(`  ${bc.dim}(${step5Duration}s)${bc.reset}`);

    printResponse(step5);

    assertStep(
      "Delegates to agent(s)",
      bugDelegatedTo(step5, "delegateToPurchaseAgent") || bugDelegatedTo(step5, "delegateToContactAgent"),
    );
    // BUG CHECK: At this point, after 5 turns, it must NOT still be asking about IKEA
    assertStep(
      "BUG FIX: Does NOT loop back to IKEA supplier question",
      bugTextNotContains(step5.fullText, "IKEA finnes ikke som leverandør", "opprette IKEA som ny leverandør"),
      "After 5 turns, IKEA should be handled",
    );
    // Should be making progress
    assertStep(
      "Shows progress or completion",
      bugTextContains(step5.fullText, "registrert", "opprettet", "fullført", "kjøp", "stemmer", "konto", "leverandør"),
    );
    assertStep(
      "No fatal errors",
      step5.errors.length === 0,
      step5.errors.length > 0 ? step5.errors[0] : undefined,
    );

    history.push({ role: "user", content: step5Msg });
    history.push({ role: "assistant", content: step5.fullText });
  } else {
    console.log(`\n${bc.dim}═══ Step 5: Skipped (AI completed without asking questions)${bc.reset}`);
  }
}

// ============================================
// Main
// ============================================

async function main() {
  console.log("=".repeat(60));
  console.log(`${bc.bold}E2E Test: Daniel Bente Bug-Report Scenario${bc.reset}`);
  console.log(`${bc.dim}4 receipts → multi-purchase → supplier creation → JA → execute${bc.reset}`);
  console.log(`${bc.dim}Tests: file persistence, supplier loops, konto 6900, context loss${bc.reset}`);
  console.log("=".repeat(60));

  // Parse CLI args
  const args = process.argv.slice(2);
  BUG_VERBOSE = args.includes("--verbose");
  const stepArg = args.find(a => a.startsWith("--step="))?.split("=")[1];
  const maxStep = stepArg ? parseInt(stepArg) : undefined;

  // Health check
  try {
    const health = await fetch(`${BUG_API_URL}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log(`\n${bc.green}[OK]${bc.reset} Server is running at ${BUG_API_URL}`);
  } catch {
    console.error(`${bc.red}[FAIL]${bc.reset} Server is not running at ${BUG_API_URL}`);
    console.error("Start the server with: npm run dev");
    process.exit(1);
  }

  // Auth check
  try {
    const authCheck = await fetch(`${BUG_API_URL}/api/chats`, {
      headers: { "Authorization": `Bearer ${BUG_USER_ID}` },
    });
    if (authCheck.status === 401) {
      const body = await authCheck.json();
      console.error(`${bc.red}[FAIL]${bc.reset} Authentication failed:`, body);
      process.exit(1);
    }
    console.log(`${bc.green}[OK]${bc.reset} Authentication valid`);
  } catch (error) {
    console.error(`${bc.red}[FAIL]${bc.reset} Auth check error:`, error);
    process.exit(1);
  }

  const startTime = Date.now();

  try {
    await runBugReportScenario(maxStep);
  } catch (error) {
    console.error(`\n${bc.red}FATAL ERROR:${bc.reset}`, error instanceof Error ? error.message : error);
    failedAssertions++;
    totalAssertions++;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`${bc.bold}SUMMARY — Bug-Report Scenario${bc.reset}`);
  console.log("=".repeat(60));
  console.log(`Assertions: ${bc.green}${passedAssertions} passed${bc.reset}, ${failedAssertions > 0 ? bc.red : bc.dim}${failedAssertions} failed${bc.reset} / ${totalAssertions} total`);
  console.log(`Duration:   ${duration}s`);

  if (failedAssertions > 0) {
    console.log(`\n${bc.red}${bc.bold}SOME ASSERTIONS FAILED${bc.reset}`);
    console.log(`${bc.dim}The original bug may still be partially present.${bc.reset}`);
    console.log(`${bc.dim}Run with --verbose to see full responses.${bc.reset}`);
  } else {
    console.log(`\n${bc.green}${bc.bold}ALL ASSERTIONS PASSED${bc.reset}`);
    console.log(`${bc.dim}The bug-report scenario is fixed.${bc.reset}`);
  }

  console.log("");
  process.exit(failedAssertions > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(`${bc.red}Fatal error:${bc.reset}`, error);
  process.exit(1);
});
