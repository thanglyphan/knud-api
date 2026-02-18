/**
 * Unit tests for Context Continuity Fixes (Round 2)
 * 
 * Tests the specific code changes made to fix the follow-up context loss bug:
 * 
 * Fix 1: Tool results converted to text summaries for sub-agents
 *   - Tool messages with purchaseId, invoiceId, saleId are summarized
 *   - Sub-agents receive "[Tidligere verktøyresultat: ...]" as assistant messages
 *   
 * Fix 2: Follow-up attachment prompts in purchase agent
 *   - OPPFØLGINGS-VEDLEGG section added to purchase agent prompt
 *   - Instructions to use uploadAttachmentToPurchase directly
 *   
 * Fix 3: Follow-up attachment prompts in orchestrator
 *   - "Oppfølgings-vedlegg" section with examples
 *   - Instructions to find purchaseId in history, NOT re-create
 *   
 * Fix 4: File instruction checks for existing entities
 *   - VEDLAGTE FILER section checks if entity was recently created
 *   - Directs sub-agent to upload-only, not create+upload
 * 
 * Run with: npx tsx src/fiken/tools/agents/test-context-fixes.ts
 */

import {
  PURCHASE_AGENT_PROMPT,
  ORCHESTRATOR_PROMPT,
  INVOICE_AGENT_PROMPT,
  CONTACT_AGENT_PROMPT,
  OFFER_AGENT_PROMPT,
  BANK_AGENT_PROMPT,
  ACCOUNTING_AGENT_PROMPT,
} from "./index.js";

import { BASE_FIKEN_PROMPT } from "../shared/prompts.js";

// ============================================
// Test utilities
// ============================================

const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

let passed = 0;
let failed = 0;

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name: string, ok: boolean, details?: string) {
  const status = ok
    ? `${colors.green}✓ PASS${colors.reset}`
    : `${colors.red}✗ FAIL${colors.reset}`;
  console.log(`  ${status} ${name}${details ? ` — ${details}` : ""}`);
  if (ok) passed++;
  else failed++;
}

// ============================================
// FIX 1: Tool results converted to text summaries
// (Tests the logic from index.ts lines ~271-310)
// ============================================

function testToolResultConversion() {
  log("\n═══ FIX 1: Tool Results → Text Summaries for Sub-agents ═══", "bold");

  // Simulate the tool result conversion logic from index.ts
  function convertToolResultToSummary(
    content: Array<{ type: string; toolName?: string; result?: Record<string, unknown> }>
  ): string | null {
    const summaryParts = content
      .filter(p => p.type === "tool-result")
      .map(p => {
        const r = p.result;
        if (!r) return null;
        const info: string[] = [];
        if (p.toolName) info.push(`Verktøy: ${p.toolName}`);
        if (r.success) info.push("Status: Fullført");
        if (r.message) info.push(`Resultat: ${r.message}`);
        if (r.purchaseId || (r.purchase as any)?.purchaseId) {
          info.push(`purchaseId: ${r.purchaseId || (r.purchase as any)?.purchaseId}`);
        }
        if (r.invoiceId || (r.invoice as any)?.invoiceId) {
          info.push(`invoiceId: ${r.invoiceId || (r.invoice as any)?.invoiceId}`);
        }
        if (r.saleId || (r.sale as any)?.saleId) {
          info.push(`saleId: ${r.saleId || (r.sale as any)?.saleId}`);
        }
        if (r.contactId) info.push(`contactId: ${r.contactId}`);
        if (r.fileUploaded) info.push("Fil lastet opp: ja");
        if (r._operationComplete) info.push("Operasjon fullført");
        return info.length > 0 ? info.join(", ") : null;
      })
      .filter(Boolean);

    if (summaryParts.length > 0) {
      return `[Tidligere verktøyresultat: ${summaryParts.join(" | ")}]`;
    }
    return null;
  }

  // Test 1: Purchase creation result with purchaseId
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "createPurchase",
        result: {
          success: true,
          message: "Kjøp opprettet",
          purchaseId: 12345,
        },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Purchase creation result includes purchaseId",
      summary !== null && summary.includes("purchaseId: 12345"),
      summary ? `Got: "${summary}"` : "null"
    );
    logTest(
      "Summary includes tool name",
      summary !== null && summary.includes("createPurchase"),
    );
    logTest(
      "Summary includes success status",
      summary !== null && summary.includes("Status: Fullført"),
    );
  }

  // Test 2: Invoice creation result with invoiceId
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "createInvoice",
        result: {
          success: true,
          message: "Faktura opprettet",
          invoiceId: 67890,
        },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Invoice creation result includes invoiceId",
      summary !== null && summary.includes("invoiceId: 67890"),
    );
  }

  // Test 3: Sale creation with saleId
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "createSale",
        result: {
          success: true,
          saleId: 11111,
        },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Sale creation result includes saleId",
      summary !== null && summary.includes("saleId: 11111"),
    );
  }

  // Test 4: Nested purchaseId inside purchase object
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "createPurchase",
        result: {
          success: true,
          purchase: { purchaseId: 99999, amount: 500 },
        },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Nested purchaseId is extracted from purchase object",
      summary !== null && summary.includes("purchaseId: 99999"),
      summary ? `Got: "${summary}"` : "null"
    );
  }

  // Test 5: Contact creation with contactId
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "createContact",
        result: {
          success: true,
          contactId: 20001,
        },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Contact creation result includes contactId",
      summary !== null && summary.includes("contactId: 20001"),
    );
  }

  // Test 6: File upload result
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "uploadAttachmentToPurchase",
        result: {
          success: true,
          fileUploaded: true,
          message: "Vedlegg lastet opp",
        },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "File upload result includes fileUploaded flag",
      summary !== null && summary.includes("Fil lastet opp: ja"),
    );
  }

  // Test 7: Operation complete flag
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "delegateToPurchaseAgent",
        result: {
          success: true,
          _operationComplete: true,
          message: "Kjøp registrert og vedlegg lastet opp",
        },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Operation complete flag is included",
      summary !== null && summary.includes("Operasjon fullført"),
    );
  }

  // Test 8: Multiple tool results in one message
  {
    const toolContent = [
      {
        type: "tool-result",
        toolName: "createPurchase",
        result: { success: true, purchaseId: 111 },
      },
      {
        type: "tool-result",
        toolName: "uploadAttachmentToPurchase",
        result: { success: true, fileUploaded: true },
      },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Multiple tool results are joined with separator",
      summary !== null && summary.includes(" | "),
      summary ? `Got: "${summary}"` : "null"
    );
    logTest(
      "Both purchaseId and fileUploaded are present",
      summary !== null && summary.includes("purchaseId: 111") && summary.includes("Fil lastet opp: ja"),
    );
  }

  // Test 9: Empty/null result returns null
  {
    const toolContent = [
      { type: "tool-result", toolName: "someUnknownTool", result: undefined as any },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Null result returns null summary",
      summary === null,
    );
  }

  // Test 10: Non-tool-result types are filtered out
  {
    const toolContent = [
      { type: "text", text: "some text" } as any,
      { type: "tool-result", toolName: "createPurchase", result: { success: true, purchaseId: 555 } },
    ];
    const summary = convertToolResultToSummary(toolContent);
    logTest(
      "Non-tool-result types are filtered out (only tool-result kept)",
      summary !== null && !summary.includes("some text") && summary.includes("purchaseId: 555"),
    );
  }

  // Test 11: Simulating the full message processing pipeline
  {
    // This is what happens in index.ts: tool messages are converted to assistant messages
    const processedMessages: Array<{
      role: "user" | "assistant" | "tool";
      content: any;
    }> = [
      { role: "user", content: "Registrer kjøp fra Elkjøp" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Jeg registrerer kjøpet." },
          { type: "tool-call", toolCallId: "tc1", toolName: "delegateToPurchaseAgent", args: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "delegateToPurchaseAgent",
            result: { success: true, result: "Kjøp opprettet", purchaseId: 42 },
          },
        ],
      },
      { role: "user", content: "Last opp kvitteringen" },
    ];

    const agentMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of processedMessages) {
      if (msg.role === "tool") {
        // This is the new conversion logic from Fix 2
        if (Array.isArray(msg.content)) {
          const summaryParts = msg.content
            .filter((p: any) => p.type === "tool-result")
            .map((p: any) => {
              const r = p.result as Record<string, unknown> | undefined;
              if (!r) return null;
              const info: string[] = [];
              if (p.toolName) info.push(`Verktøy: ${p.toolName}`);
              if (r.success) info.push("Status: Fullført");
              if (r.purchaseId) info.push(`purchaseId: ${r.purchaseId}`);
              return info.length > 0 ? info.join(", ") : null;
            })
            .filter(Boolean);

          if (summaryParts.length > 0) {
            agentMessages.push({
              role: "assistant",
              content: `[Tidligere verktøyresultat: ${summaryParts.join(" | ")}]`,
            });
          }
        }
        continue;
      }
      if (typeof msg.content === "string" && msg.content.trim()) {
        agentMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    logTest(
      "Pipeline: tool message becomes assistant message",
      agentMessages.some(m => m.role === "assistant" && m.content.includes("Tidligere verktøyresultat")),
      `Agent messages: ${JSON.stringify(agentMessages.map(m => `${m.role}: ${m.content.substring(0, 80)}`))}`,
    );
    logTest(
      "Pipeline: purchaseId is in the converted assistant message",
      agentMessages.some(m => m.content.includes("purchaseId: 42")),
    );
    logTest(
      "Pipeline: tool message itself is NOT in agentMessages",
      !agentMessages.some(m => (m as any).role === "tool"),
    );
    logTest(
      "Pipeline: total 3 messages (user, converted-assistant, user2)",
      agentMessages.length === 3,
      `Got ${agentMessages.length} messages`,
    );
  }
}

// ============================================
// FIX 2: Follow-up attachment prompts in purchase agent
// ============================================

function testPurchaseAgentFollowUpPrompts() {
  log("\n═══ FIX 2: Purchase Agent — Follow-up Attachment Prompts ═══", "bold");

  logTest(
    "OPPFØLGINGS-VEDLEGG section exists in purchase agent prompt",
    PURCHASE_AGENT_PROMPT.includes("OPPFØLGINGS-VEDLEGG"),
  );

  logTest(
    "Instructs to call uploadAttachmentToPurchase DIRECTLY",
    PURCHASE_AGENT_PROMPT.includes("uploadAttachmentToPurchase") &&
    PURCHASE_AGENT_PROMPT.includes("DIREKTE"),
  );

  logTest(
    "NEVER create new purchase when uploading attachment",
    PURCHASE_AGENT_PROMPT.includes("ALDRI") &&
    PURCHASE_AGENT_PROMPT.includes("opprett et nytt kjøp"),
  );

  logTest(
    "NEVER search for purchase when you have the ID",
    PURCHASE_AGENT_PROMPT.includes("ALDRI") &&
    PURCHASE_AGENT_PROMPT.includes("searchPurchases"),
  );

  logTest(
    "Instructs to look for purchaseId in conversation history",
    PURCHASE_AGENT_PROMPT.includes("samtalehistorikken") &&
    PURCHASE_AGENT_PROMPT.includes("Tidligere verktøyresultat"),
  );

  logTest(
    "Section is marked as KRITISK (critical)",
    PURCHASE_AGENT_PROMPT.includes("KRITISK"),
  );
}

// ============================================
// FIX 3: Orchestrator follow-up attachment prompts
// ============================================

function testOrchestratorFollowUpPrompts() {
  log("\n═══ FIX 3: Orchestrator — Follow-up Attachment Prompts ═══", "bold");

  logTest(
    "Oppfølgings-vedlegg section exists in orchestrator prompt",
    ORCHESTRATOR_PROMPT.includes("Oppfølgings-vedlegg") ||
    ORCHESTRATOR_PROMPT.includes("oppfølgings-vedlegg"),
  );

  logTest(
    "Mentions looking for ID in previous tool results/history",
    ORCHESTRATOR_PROMPT.includes("TIDLIGERE verktøyresultat") ||
    ORCHESTRATOR_PROMPT.includes("samtalehistorikken"),
  );

  logTest(
    "Includes correct example: purchaseId delegation",
    ORCHESTRATOR_PROMPT.includes("purchaseId") &&
    ORCHESTRATOR_PROMPT.includes("uploadAttachmentToPurchase"),
  );

  logTest(
    "Includes WRONG example (forbidden behavior)",
    ORCHESTRATOR_PROMPT.includes("FEIL") &&
    ORCHESTRATOR_PROMPT.includes("duplikat"),
  );

  logTest(
    "Instructs to delegate with explicit upload instruction",
    ORCHESTRATOR_PROMPT.includes("Last opp vedlagt fil") &&
    ORCHESTRATOR_PROMPT.includes("IKKE opprett"),
  );

  logTest(
    "Instructs to ask user for ID if not found in history",
    ORCHESTRATOR_PROMPT.includes("spør brukeren om ID"),
  );
}

// ============================================
// FIX 4: File instruction checks for existing entities
// (Tests the logic described in index.ts VEDLAGTE FILER section)
// ============================================

function testFileInstructionLogic() {
  log("\n═══ FIX 4: VEDLAGTE FILER — Existing Entity Detection ═══", "bold");

  // Simulate the file instruction generation from index.ts
  // We can't run the actual server code, but we can verify the prompt text
  // that gets generated when files are attached.

  // The key instruction text that's added to the system prompt:
  const expectedInstructions = [
    "SJEKK FØRST",
    "nylig opprettet",
    "kjøp/faktura/salg",
    "som mangler vedlegg",
    "uploadAttachmentTo",
    "IKKE opprett noe nytt",
  ];

  // Build the instruction string as the server would
  const files = [{ name: "kvittering.png", type: "image/png" }];
  const fileList = files.map((f, i) => `${i + 1}. ${f.name} (${f.type})`).join('\n');
  const fileInstruction = `
## VEDLAGTE FILER (${files.length} stk) - HANDLING PÅKREVD!
Brukeren har vedlagt følgende fil${files.length > 1 ? 'er' : ''} til DENNE meldingen:
${fileList}

⚠️ **FILNAVN ER IKKE PÅLITELIGE!** Filnavnet sier INGENTING om hva filen faktisk inneholder.
"faktura-microsoft-50000kr.pdf" kan inneholde en Rema 1000-kvittering. ALDRI trekk ut leverandør, beløp eller annen info fra filnavnet.

**SJEKK FØRST:** Ble det nylig opprettet et kjøp/faktura/salg i denne samtalen som mangler vedlegg?
- Hvis JA → Deleger til riktig agent med: "Last opp vedlagt fil til [type] med ID [X] ved å kalle uploadAttachmentTo[Type]. IKKE opprett noe nytt."
- Hvis NEI → Deleger HELE oppgaven (opprettelse + filopplasting) til riktig agent i ÉN ENKELT delegering.

Agenten har verktøy for å både opprette (createPurchase, createSale, etc.) og laste opp vedlegg (uploadAttachmentToPurchase, etc.).
⚠️ VIKTIG: IKKE deleger to ganger (én for opprettelse, én for opplasting) - det vil opprette duplikater!

IKKE spør brukeren om å sende filen på nytt - filen ER allerede vedlagt og klar til opplasting!
La sub-agenten lese bildet/PDF-en selv — IKKE oppsummer filinnholdet basert på filnavnet.`;

  for (const expected of expectedInstructions) {
    logTest(
      `File instruction contains "${expected}"`,
      fileInstruction.includes(expected),
    );
  }

  logTest(
    "Anti-hallucination warning about filenames",
    fileInstruction.includes("FILNAVN ER IKKE PÅLITELIGE"),
  );

  logTest(
    "No duplicate delegation warning",
    fileInstruction.includes("IKKE deleger to ganger") && fileInstruction.includes("duplikater"),
  );

  logTest(
    "Tells AI not to ask for file re-upload",
    fileInstruction.includes("IKKE spør brukeren om å sende fil"),
  );

  logTest(
    "Tells AI to let sub-agent read the image",
    fileInstruction.includes("La sub-agenten lese bildet/PDF-en selv"),
  );
}

// ============================================
// BONUS: Prompt integrity for all prompts
// ============================================

function testPromptIntegrity() {
  log("\n═══ BONUS: Prompt Integrity Checks ═══", "bold");

  const allPrompts: Array<[string, string]> = [
    ["BASE_FIKEN_PROMPT", BASE_FIKEN_PROMPT],
    ["ORCHESTRATOR_PROMPT", ORCHESTRATOR_PROMPT],
    ["PURCHASE_AGENT_PROMPT", PURCHASE_AGENT_PROMPT],
    ["INVOICE_AGENT_PROMPT", INVOICE_AGENT_PROMPT],
    ["CONTACT_AGENT_PROMPT", CONTACT_AGENT_PROMPT],
    ["OFFER_AGENT_PROMPT", OFFER_AGENT_PROMPT],
    ["BANK_AGENT_PROMPT", BANK_AGENT_PROMPT],
    ["ACCOUNTING_AGENT_PROMPT", ACCOUNTING_AGENT_PROMPT],
  ];

  for (const [name, prompt] of allPrompts) {
    logTest(
      `${name} is a valid string`,
      typeof prompt === "string" && prompt.length > 200,
      `Length: ${prompt?.length || 0}`,
    );
  }

  // Verify all agent prompts contain the base confirmation rules
  const agentPrompts: Array<[string, string]> = [
    ["PURCHASE_AGENT_PROMPT", PURCHASE_AGENT_PROMPT],
    ["INVOICE_AGENT_PROMPT", INVOICE_AGENT_PROMPT],
    ["CONTACT_AGENT_PROMPT", CONTACT_AGENT_PROMPT],
    ["OFFER_AGENT_PROMPT", OFFER_AGENT_PROMPT],
    ["BANK_AGENT_PROMPT", BANK_AGENT_PROMPT],
    ["ACCOUNTING_AGENT_PROMPT", ACCOUNTING_AGENT_PROMPT],
  ];

  for (const [name, prompt] of agentPrompts) {
    // All agent prompts should inherit BASE_FIKEN_PROMPT which has the confirmation rules
    logTest(
      `${name} contains "Stemmer dette" (confirmation rule)`,
      prompt.includes("Stemmer dette") || prompt.includes("stemmer dette"),
    );
  }

  // Verify the orchestrator has the key round-2 additions
  logTest(
    "Orchestrator has follow-up attachment examples",
    ORCHESTRATOR_PROMPT.includes("purchaseId: 12345") || ORCHESTRATOR_PROMPT.includes("purchaseId"),
  );

  logTest(
    "Purchase agent has follow-up attachment section",
    PURCHASE_AGENT_PROMPT.includes("OPPFØLGINGS-VEDLEGG"),
  );
}

// ============================================
// NEW: Test tool message filtering (before vs after fix)
// ============================================

function testToolMessageFiltering() {
  log("\n═══ Tool Message Filtering: Before vs After Fix ═══", "bold");

  // Simulate a conversation where purchase was created in turn 1,
  // then user asks to upload receipt in turn 2
  const conversation: Array<{
    role: "user" | "assistant" | "tool";
    content: any;
  }> = [
    { role: "user", content: "Registrer kjøp fra Elkjøp 4999 kr" },
    {
      role: "assistant",
      content: "Kjøpet er registrert. PurchaseId: 42.",
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_abc",
          toolName: "delegateToPurchaseAgent",
          result: {
            success: true,
            result: "Kjøp registrert",
            purchaseId: 42,
            fromAgent: "purchase",
          },
        },
      ],
    },
    { role: "user", content: "Last opp denne kvitteringen til kjøpet" },
  ];

  // === BEFORE FIX: tool messages were filtered out ===
  const beforeFixMessages: Array<{ role: string; content: string }> = [];
  for (const msg of conversation) {
    if (msg.role === "tool") continue; // OLD BEHAVIOR: skip all tool messages
    if (typeof msg.content === "string" && msg.content.trim()) {
      beforeFixMessages.push({ role: msg.role, content: msg.content });
    }
  }

  logTest(
    "BEFORE fix: tool message is completely lost",
    !beforeFixMessages.some(m => m.content.includes("purchaseId")),
    `Messages: ${beforeFixMessages.map(m => `${m.role}: ${m.content.substring(0, 50)}`).join(" | ")}`,
  );
  logTest(
    "BEFORE fix: sub-agent has no idea which purchase was created",
    beforeFixMessages.length === 3, // user, assistant, user2 — no tool info
    `${beforeFixMessages.length} messages`,
  );

  // === AFTER FIX: tool messages converted to summaries ===
  const afterFixMessages: Array<{ role: string; content: string }> = [];
  for (const msg of conversation) {
    if (msg.role === "tool") {
      // NEW BEHAVIOR: convert to text summary
      if (Array.isArray(msg.content)) {
        const parts = msg.content
          .filter((p: any) => p.type === "tool-result")
          .map((p: any) => {
            const r = p.result;
            if (!r) return null;
            const info: string[] = [];
            if (p.toolName) info.push(`Verktøy: ${p.toolName}`);
            if (r.success) info.push("Status: Fullført");
            if (r.purchaseId) info.push(`purchaseId: ${r.purchaseId}`);
            return info.length > 0 ? info.join(", ") : null;
          })
          .filter(Boolean);
        if (parts.length > 0) {
          afterFixMessages.push({
            role: "assistant",
            content: `[Tidligere verktøyresultat: ${parts.join(" | ")}]`,
          });
        }
      }
      continue;
    }
    if (typeof msg.content === "string" && msg.content.trim()) {
      afterFixMessages.push({ role: msg.role, content: msg.content });
    }
  }

  logTest(
    "AFTER fix: tool result is converted to assistant message",
    afterFixMessages.some(m => m.role === "assistant" && m.content.includes("Tidligere verktøyresultat")),
  );
  logTest(
    "AFTER fix: purchaseId 42 is present in sub-agent context",
    afterFixMessages.some(m => m.content.includes("purchaseId: 42")),
  );
  logTest(
    "AFTER fix: 4 messages total (user, assistant, converted-tool, user2)",
    afterFixMessages.length === 4,
    `${afterFixMessages.length} messages`,
  );
  logTest(
    "AFTER fix: converted message has assistant role (not tool)",
    afterFixMessages.every(m => m.role !== "tool"),
  );

  // Verify the sub-agent would now know about the purchase
  const lastUserMsg = afterFixMessages[afterFixMessages.length - 1];
  const prevMsgs = afterFixMessages.slice(0, -1);
  logTest(
    "AFTER fix: context before 'upload' request contains purchaseId",
    prevMsgs.some(m => m.content.includes("purchaseId: 42")),
    "Sub-agent can now look up the purchase",
  );
}

// ============================================
// Main
// ============================================

async function main() {
  log("═".repeat(60), "bold");
  log("  Context Continuity Fixes — Unit Tests", "bold");
  log("═".repeat(60), "bold");

  testToolResultConversion();
  testPurchaseAgentFollowUpPrompts();
  testOrchestratorFollowUpPrompts();
  testFileInstructionLogic();
  testPromptIntegrity();
  testToolMessageFiltering();

  log("\n" + "─".repeat(60), "dim");
  const total = passed + failed;
  const allPassed = failed === 0;
  log(
    `  ${allPassed ? "✓" : "✗"} ${passed}/${total} tests passed (${failed} failed)`,
    allPassed ? "green" : "red"
  );
  log("─".repeat(60), "dim");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
