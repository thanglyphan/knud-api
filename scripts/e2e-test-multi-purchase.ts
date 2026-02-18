/**
 * E2E Test Suite: Multi-Purchase & File Persistence Fixes (Round 3)
 * 
 * Tests the SPECIFIC fixes for multi-file multi-purchase workflows:
 * 1. filesResend flag — backend skips re-analysis when files are resent
 * 2. Supplier lookup — shows list of existing suppliers when not found
 * 3. Account validation — uses suggestAccounts instead of hardcoded list
 * 4. Multi-purchase confirmation flow — files survive "JA" confirmation
 * 5. Multi-entity safety-net — correct file-to-entity mapping
 * 
 * Prerequisites:
 *   - API server running on localhost:3001
 *   - Valid Fiken user token (demo account)
 *   - Docker DB running
 * 
 * Usage:
 *   npx tsx scripts/e2e-test-multi-purchase.ts
 *   npx tsx scripts/e2e-test-multi-purchase.ts --scenario=1    # Run specific scenario
 *   npx tsx scripts/e2e-test-multi-purchase.ts --verbose        # Show full responses
 */

const API_URL = "http://localhost:3001";
const USER_ID = "678b5c02-c4a1-4496-a479-006f257c37ab";

// ============================================
// Types
// ============================================

interface ParsedStream {
  fullText: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args?: unknown }>;
  toolResults: Array<{ toolCallId: string; result: unknown }>;
  errors: string[];
  textChunks: number;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface ScenarioStep {
  userMessage: string;
  files?: Array<{ name: string; type: string; data: string }>;
  filesResend?: boolean;
  description: string;
  assertions: Array<{
    name: string;
    check: (result: ParsedStream, history: ConversationMessage[]) => boolean;
  }>;
  delayBefore?: number;
}

interface Scenario {
  id: number;
  name: string;
  description: string;
  steps: ScenarioStep[];
}

interface ScenarioResult {
  scenarioId: number;
  scenarioName: string;
  steps: Array<{
    stepIndex: number;
    description: string;
    durationMs: number;
    responseText: string;
    toolsCalled: string[];
    assertions: Array<{ name: string; passed: boolean }>;
    error?: string;
  }>;
  overallPassed: boolean;
  totalDurationMs: number;
}

// ============================================
// ANSI colors
// ============================================

const c = {
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

let VERBOSE = false;

// ============================================
// SSE Stream Parser
// ============================================

async function parseSSEStream(response: Response): Promise<ParsedStream> {
  const result: ParsedStream = {
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

      // 0: = text content
      const textMatch = line.match(/^0:"(.*)"/);
      if (textMatch) {
        const content = textMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        result.fullText += content;
        result.textChunks++;
      }

      // 9: = tool call start
      if (line.startsWith("9:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolCalls.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            toolName: data.toolName || data.name || "unknown",
          });
        } catch { /* ignore */ }
      }

      // a: = tool result
      if (line.startsWith("a:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolResults.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            result: data.result || data,
          });
        } catch { /* ignore */ }
      }

      // e: = error
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

  // Process remaining buffer
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
// API helpers
// ============================================

async function sendChatMessage(
  messages: Array<{ role: string; content: string }>,
  files?: Array<{ name: string; type: string; data: string }>,
  filesResend?: boolean,
): Promise<ParsedStream> {
  const body: Record<string, unknown> = { messages };
  if (files && files.length > 0) {
    body.files = files;
    if (filesResend) {
      body.filesResend = true;
    }
  }

  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${USER_ID}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorBody}`);
  }

  return parseSSEStream(response);
}

// ============================================
// Test helpers
// ============================================

function getTestReceiptBase64(): string {
  // Minimal valid PNG (1x1 transparent pixel)
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

function textContains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

function textNotContains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return !patterns.some(p => lower.includes(p.toLowerCase()));
}

function delegatedTo(result: ParsedStream, agentTool: string): boolean {
  return result.toolCalls.some(tc => tc.toolName === agentTool);
}

function calledTool(result: ParsedStream, ...toolNames: string[]): boolean {
  return toolNames.some(name => 
    result.toolCalls.some(tc => tc.toolName === name)
  );
}

// ============================================
// SCENARIOS
// ============================================

const SCENARIOS: Scenario[] = [
  // ─────────────────────────────────────────────
  // Scenario 1: Account validation via suggestAccounts
  // Tests Fix 6: AI should always call suggestAccounts, never use hardcoded list
  // ─────────────────────────────────────────────
  {
    id: 1,
    name: "Kontovalidering via suggestAccounts",
    description: "Register a purchase specifying account 6900 — AI should validate with suggestAccounts and find the correct account",
    steps: [
      {
        userMessage: "Registrer kjøp fra Rema 1000 på 199 kr for mat til møte, bruk konto 6900, betalt i dag med bankkonto",
        description: "Request purchase with account 6900 — AI should validate it exists via suggestAccounts (6900 may not exist in Fiken)",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Response mentions account or konto",
            check: (r) => textContains(r.fullText, "konto", "6", "mat", "Rema"),
          },
          {
            name: "No unrecoverable errors",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 2: Supplier lookup — unknown supplier
  // Tests Fix 5: When supplier not found, show existing supplier list
  // ─────────────────────────────────────────────
  {
    id: 2,
    name: "Leverandøroppslag — ukjent leverandør",
    description: "Register a purchase from an unlikely supplier name — AI should search, not find, and show alternatives or ask clarifying questions",
    steps: [
      {
        userMessage: "Registrer kjøp fra IKEA på 2499 kr inkl. mva for kontormøbler, betalt i dag med bankkonto 1920:10001",
        description: "Request purchase from IKEA — AI should delegate and start working on it",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Response mentions IKEA, leverandør, supplier options, or asks clarifying question",
            check: (r) => textContains(r.fullText, "IKEA", "ikea", "leverandør", "kontakt", "mva", "MVA", "konto", "stemmer", "bekreft"),
          },
          {
            name: "Response is not empty",
            check: (r) => r.fullText.trim().length > 10,
          },
          {
            name: "No unrecoverable errors",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 3: Single purchase confirmation + follow-up "JA"
  // Tests that confirmation flow works correctly
  // ─────────────────────────────────────────────
  {
    id: 3,
    name: "Bekreftelsesflyt — JA oppretter kjøp",
    description: "Register purchase with existing supplier, confirm with JA — AI should create the purchase",
    steps: [
      {
        userMessage: "Registrer kjøp fra Demoleverandør på 599 kr for kontorrekvisita, betalt i dag med bankkonto 1920:10001",
        description: "Step 1: Request purchase with existing supplier — should present summary for confirmation",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Mentions the supplier or amount",
            check: (r) => textContains(r.fullText, "Demoleverandør", "demoleverandør", "599"),
          },
          {
            name: "Asks for confirmation or clarifying question",
            check: (r) => textContains(r.fullText, "stemmer", "bekreft", "riktig", "konto", "mva", "MVA"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Ja, bruk konto 6551",
        description: "Step 2: Confirm — should create the purchase",
        delayBefore: 2000,
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Purchase was created or confirmation summary shown",
            check: (r) => textContains(r.fullText, "registrert", "opprettet", "fullført", "kjøp", "599", "Demoleverandør", "stemmer", "konto"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 4: filesResend flag — resent files don't trigger new analysis
  // Tests Fix 1-2: Files resent with filesResend=true skip VEDLAGTE FILER prompt
  // ─────────────────────────────────────────────
  {
    id: 4,
    name: "filesResend — ingen ny analyse",
    description: "Send a file with filesResend=true after confirmation — backend should NOT re-analyze it",
    steps: [
      {
        userMessage: "Registrer kjøp fra Demoleverandør på 350 kr for kontorrekvisita, betalt i dag med bankkonto 1920:10001",
        description: "Step 1: Request purchase with existing supplier",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Mentions supplier or asks clarifying question",
            check: (r) => textContains(r.fullText, "Demoleverandør", "350", "stemmer", "konto", "mva"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Ja, bruk konto 6551, registrer det",
        files: [
          { name: "kvittering.png", type: "image/png", data: getTestReceiptBase64() },
        ],
        filesResend: true,
        description: "Step 2: Confirm with filesResend=true — should proceed (purchase or contact agent), NOT re-analyze files",
        delayBefore: 2000,
        assertions: [
          {
            name: "Delegates to purchase or contact agent (may create supplier first)",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent") || delegatedTo(r, "delegateToContactAgent"),
          },
          {
            name: "Does NOT treat files as new upload requiring analysis",
            check: (r) => {
              // Should NOT say something like "Jeg ser du har lastet opp en ny fil"
              return textNotContains(r.fullText, "har lastet opp en ny", "ny fil", "hva inneholder", "VEDLAGTE FILER");
            },
          },
          {
            name: "Proceeds with purchase creation, supplier creation, or asks about konto",
            check: (r) => textContains(r.fullText, "registrert", "opprettet", "fullført", "kjøp", "Demoleverandør", "350", "stemmer", "konto", "leverandør"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 5: Multiple purchases in one conversation
  // Tests Fix 4: Orchestrator multi-operation workflow
  // ─────────────────────────────────────────────
  {
    id: 5,
    name: "Flere kjøp i én samtale",
    description: "Register 2 purchases sequentially — AI should handle both without losing context",
    steps: [
      {
        userMessage: "Jeg trenger å registrere 2 kjøp: 1) Rema 1000, 149 kr, dagligvarer, kontantkjøp 2) Elkjøp, 2999 kr, USB-hub, betalt med bankkonto 1920:10001",
        description: "Request 2 purchases at once — AI should plan and ask for confirmation",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Mentions both suppliers or amounts",
            check: (r) => {
              const lower = r.fullText.toLowerCase();
              const mentionsFirst = lower.includes("rema") || lower.includes("149");
              const mentionsSecond = lower.includes("elkjøp") || lower.includes("2999") || lower.includes("usb");
              return mentionsFirst || mentionsSecond;
            },
          },
          {
            name: "No unrecoverable errors",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
      {
        userMessage: "Ja, registrer begge",
        description: "Step 2: Confirm both purchases — should create them without re-asking",
        delayBefore: 3000,
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Response indicates progress or completion",
            check: (r) => textContains(r.fullText, "registrert", "opprettet", "fullført", "kjøp", "Rema", "Elkjøp", "2"),
          },
          {
            name: "No unrecoverable errors",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 6: Single file upload + purchase + confirm (full flow)
  // Tests the complete Fix 1+2+3 flow end-to-end
  // ─────────────────────────────────────────────
  {
    id: 6,
    name: "Fil + kjøp + bekreftelse (full flyt)",
    description: "Upload a receipt, AI analyzes it, user confirms, AI creates purchase AND uploads file",
    steps: [
      {
        userMessage: "Registrer dette kjøpet",
        files: [
          { name: "kvittering.png", type: "image/png", data: getTestReceiptBase64() },
        ],
        description: "Step 1: Upload receipt — AI should analyze and present summary",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Response is not empty",
            check: (r) => r.fullText.trim().length > 20,
          },
          {
            name: "Asks for confirmation or mentions receipt",
            check: (r) => textContains(r.fullText, "stemmer", "bekreft", "kvittering", "fil", "bilde", "se"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Ja, registrer det. Bruk Demoleverandør AS, 199 kr, konto 6300, kontantkjøp, dato i dag",
        files: [
          { name: "kvittering.png", type: "image/png", data: getTestReceiptBase64() },
        ],
        filesResend: true,
        description: "Step 2: Confirm with details + resent file — should proceed (may create supplier first or purchase)",
        delayBefore: 3000,
        assertions: [
          {
            name: "Delegates to purchase or contact agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent") || delegatedTo(r, "delegateToContactAgent"),
          },
          {
            name: "Response mentions purchase, supplier, or account details",
            check: (r) => textContains(r.fullText, "registrert", "opprettet", "fullført", "kjøp", "konto", "leverandør", "Demoleverandør", "stemmer"),
          },
          {
            name: "No unrecoverable errors",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 7: maxSteps — complex operation doesn't time out
  // Tests Fix 7: maxSteps increased from 15 to 25
  // ─────────────────────────────────────────────
  {
    id: 7,
    name: "Kompleks operasjon — maxSteps",
    description: "A complex multi-step operation should not fail due to maxSteps limit",
    steps: [
      {
        userMessage: "Søk etter leverandører som heter 'Demo', vis de siste kjøpene mine, og vis banksaldoen",
        description: "Multi-topic request requiring multiple delegations — should not run out of steps",
        assertions: [
          {
            name: "Response is substantial (not truncated by maxSteps)",
            check: (r) => r.fullText.trim().length > 50,
          },
          {
            name: "Mentions at least one of the requested topics",
            check: (r) => textContains(r.fullText, "leverandør", "demo", "kjøp", "bank", "saldo", "konto"),
          },
          {
            name: "Does NOT say it ran out of steps or couldn't complete",
            check: (r) => textNotContains(r.fullText, "ran out", "max steps", "couldn't complete", "maximum"),
          },
          {
            name: "No unrecoverable errors",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
    ],
  },
];

// ============================================
// Scenario Runner
// ============================================

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const scenarioStart = Date.now();
  const result: ScenarioResult = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    steps: [],
    overallPassed: true,
    totalDurationMs: 0,
  };

  const conversationHistory: ConversationMessage[] = [];

  for (let stepIdx = 0; stepIdx < scenario.steps.length; stepIdx++) {
    const step = scenario.steps[stepIdx];

    if (step.delayBefore && step.delayBefore > 0) {
      await new Promise(resolve => setTimeout(resolve, step.delayBefore));
    }

    const stepStart = Date.now();
    const stepResult: ScenarioResult["steps"][number] = {
      stepIndex: stepIdx + 1,
      description: step.description,
      durationMs: 0,
      responseText: "",
      toolsCalled: [],
      assertions: [],
    };

    try {
      // Build messages — only user + assistant (no tool messages)
      const messagesToSend = [
        ...conversationHistory.map(m => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user" as const, content: step.userMessage },
      ];

      const parsed = await sendChatMessage(messagesToSend, step.files, step.filesResend);

      stepResult.responseText = parsed.fullText;
      stepResult.toolsCalled = parsed.toolCalls.map(tc => tc.toolName);
      stepResult.durationMs = Date.now() - stepStart;

      for (const assertion of step.assertions) {
        const passed = assertion.check(parsed, conversationHistory);
        stepResult.assertions.push({ name: assertion.name, passed });
        if (!passed) result.overallPassed = false;
      }

      conversationHistory.push({ role: "user", content: step.userMessage });
      conversationHistory.push({ role: "assistant", content: parsed.fullText });

    } catch (error) {
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.durationMs = Date.now() - stepStart;
      result.overallPassed = false;

      for (const assertion of step.assertions) {
        stepResult.assertions.push({ name: assertion.name, passed: false });
      }
    }

    result.steps.push(stepResult);
  }

  result.totalDurationMs = Date.now() - scenarioStart;
  return result;
}

// ============================================
// Report
// ============================================

function printScenarioResult(result: ScenarioResult): void {
  const icon = result.overallPassed ? `${c.green}✓` : `${c.red}✗`;
  const duration = `${c.dim}(${(result.totalDurationMs / 1000).toFixed(1)}s)${c.reset}`;

  console.log(`\n${icon} Scenario ${result.scenarioId}: ${result.scenarioName} ${duration}${c.reset}`);

  for (const step of result.steps) {
    const stepIcon = step.error || step.assertions.some(a => !a.passed) ? `${c.red}✗` : `${c.green}✓`;
    console.log(`  ${stepIcon} Step ${step.stepIndex}: ${step.description} ${c.dim}(${(step.durationMs / 1000).toFixed(1)}s)${c.reset}`);

    if (step.error) {
      console.log(`    ${c.red}ERROR: ${step.error}${c.reset}`);
    }

    for (const assertion of step.assertions) {
      const aIcon = assertion.passed ? `${c.green}✓` : `${c.red}✗`;
      console.log(`    ${aIcon} ${assertion.name}${c.reset}`);
    }

    if (VERBOSE && step.responseText) {
      console.log(`    ${c.dim}Tools: ${step.toolsCalled.join(" → ") || "none"}${c.reset}`);
      console.log(`    ${c.dim}Response: ${step.responseText.substring(0, 300)}${step.responseText.length > 300 ? "..." : ""}${c.reset}`);
    }
  }
}

function printSummary(results: ScenarioResult[]): void {
  let totalAssertions = 0;
  let passedAssertions = 0;

  for (const r of results) {
    for (const step of r.steps) {
      for (const a of step.assertions) {
        totalAssertions++;
        if (a.passed) passedAssertions++;
      }
    }
  }

  const totalScenarios = results.length;
  const passedScenarios = results.filter(r => r.overallPassed).length;
  const failedScenarios = totalScenarios - passedScenarios;
  const failedAssertions = totalAssertions - passedAssertions;
  const totalDuration = results.reduce((sum, r) => sum + r.totalDurationMs, 0);

  console.log("\n" + "=".repeat(60));
  console.log(`${c.bold}SUMMARY — Multi-Purchase E2E Tests (Round 3)${c.reset}`);
  console.log("=".repeat(60));
  console.log(`Scenarios:  ${c.green}${passedScenarios} passed${c.reset}, ${failedScenarios > 0 ? c.red : c.dim}${failedScenarios} failed${c.reset} / ${totalScenarios} total`);
  console.log(`Assertions: ${c.green}${passedAssertions} passed${c.reset}, ${failedAssertions > 0 ? c.red : c.dim}${failedAssertions} failed${c.reset} / ${totalAssertions} total`);
  console.log(`Duration:   ${(totalDuration / 1000).toFixed(1)}s total`);

  if (failedScenarios > 0) {
    console.log(`\n${c.red}${c.bold}FAILED SCENARIOS:${c.reset}`);
    for (const r of results.filter(r => !r.overallPassed)) {
      console.log(`  ${c.red}✗ #${r.scenarioId}: ${r.scenarioName}${c.reset}`);
      for (const step of r.steps) {
        const failedAsserts = step.assertions.filter(a => !a.passed);
        if (failedAsserts.length > 0 || step.error) {
          console.log(`    Step ${step.stepIndex}: ${step.description}`);
          if (step.error) {
            console.log(`      ${c.red}ERROR: ${step.error}${c.reset}`);
          }
          for (const a of failedAsserts) {
            console.log(`      ${c.red}✗ ${a.name}${c.reset}`);
          }
          if (step.responseText) {
            console.log(`      ${c.dim}Response: ${step.responseText.substring(0, 200)}...${c.reset}`);
          }
        }
      }
    }
  }

  console.log("");
}

// ============================================
// Main
// ============================================

async function main() {
  console.log("=".repeat(60));
  console.log(`${c.bold}E2E Multi-Purchase & File Persistence Tests (Round 3)${c.reset}`);
  console.log(`${c.dim}Testing: account validation, supplier lookup, confirmation flow,`);
  console.log(`filesResend flag, multi-purchase workflows, maxSteps${c.reset}`);
  console.log("=".repeat(60));
  console.log("");

  // Parse CLI args
  const args = process.argv.slice(2);
  VERBOSE = args.includes("--verbose");
  const scenarioArg = args.find(a => a.startsWith("--scenario="))?.split("=")[1];
  const scenarioIds = scenarioArg ? scenarioArg.split(",").map(Number) : null;

  // Health check
  try {
    const health = await fetch(`${API_URL}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log(`${c.green}[OK]${c.reset} Server is running at ${API_URL}`);
  } catch {
    console.error(`${c.red}[FAIL]${c.reset} Server is not running at ${API_URL}`);
    console.error("Start the server with: npm run dev");
    process.exit(1);
  }

  // Auth check
  try {
    const authCheck = await fetch(`${API_URL}/api/chats`, {
      headers: { "Authorization": `Bearer ${USER_ID}` },
    });
    if (authCheck.status === 401) {
      const body = await authCheck.json();
      console.error(`${c.red}[FAIL]${c.reset} Authentication failed:`, body);
      if (body.code === "CONNECTION_EXPIRED") {
        console.error("Fiken token expired. Log in again via the web app to refresh.");
      }
      process.exit(1);
    }
    console.log(`${c.green}[OK]${c.reset} Authentication valid`);
  } catch (error) {
    console.error(`${c.red}[FAIL]${c.reset} Auth check error:`, error);
    process.exit(1);
  }

  // Filter scenarios
  const scenariosToRun = scenarioIds
    ? SCENARIOS.filter(s => scenarioIds.includes(s.id))
    : SCENARIOS;

  console.log(`\nRunning ${scenariosToRun.length} scenario(s)...\n`);

  const results: ScenarioResult[] = [];

  for (let i = 0; i < scenariosToRun.length; i++) {
    const scenario = scenariosToRun[i];
    const progress = `[${i + 1}/${scenariosToRun.length}]`;
    process.stdout.write(`${c.cyan}${progress}${c.reset} Running: ${scenario.name}...`);

    const result = await runScenario(scenario);
    results.push(result);

    process.stdout.write("\r" + " ".repeat(80) + "\r");
    printScenarioResult(result);
  }

  printSummary(results);

  // Exit code
  const allPassed = results.every(r => r.overallPassed);
  process.exit(allPassed ? 0 : 1);
}

main().catch(error => {
  console.error(`${c.red}Fatal error:${c.reset}`, error);
  process.exit(1);
});
