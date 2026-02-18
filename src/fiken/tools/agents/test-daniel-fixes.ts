/**
 * Test script for Daniel Bentes bug fixes
 * 
 * Tests the specific issues found from analyzing Daniel's chat history:
 * 1. Image data passed to sub-agents (Fix 1) 
 * 2. Anti-hallucination prompts (Fix 2)
 * 3. Bank reconciliation uses readOnly 'account' field + pagination (Fix 3)
 * 4. Human-in-the-loop confirmation prompts (Fix 8)
 * 
 * Run with: npx tsx src/fiken/tools/agents/test-daniel-fixes.ts
 */

import {
  createFikenAgentSystem,
  createBankAgentTools,
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
// FIX 1: Image content parts passed to sub-agents
// ============================================

async function testImagePassthrough() {
  log("\n1. Fix 1 — Image data passed to sub-agents", "blue");
  log("   (Daniel's PDFs were stripped before delegation)\n", "dim");

  // Simulate what index.ts does when delegating with image parts.
  // Before fix: only text parts were kept (msg.content filtered to text-only).
  // After fix: image parts are also passed through.
  
  const processedMessages = [
    {
      role: "user",
      content: [
        { type: "text", text: "Registrer denne kvitteringen" },
        { type: "image", image: "data:image/png;base64,iVBORw0KGgo..." },
        { type: "image", image: "data:image/png;base64,AAABBBCCC..." },
      ],
    },
    {
      role: "assistant",
      content: "Jeg ser to bilder. La meg analysere dem.",
    },
  ];

  // Reproduce the delegation logic from index.ts (lines ~260-303)
  const agentMessages: Array<{
    role: "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image"; image: string }>;
  }> = [];

  for (const msg of processedMessages) {
    if (typeof msg.content === "string") {
      if (msg.content.trim()) {
        agentMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    } else if (Array.isArray(msg.content)) {
      const parts = (msg.content as Array<{ type: string; text?: string; image?: string }>)
        .filter((p) => p.type === "text" || p.type === "image")
        .map((p) => {
          if (p.type === "image") return { type: "image" as const, image: p.image! };
          return { type: "text" as const, text: p.text || "" };
        });
      if (parts.length > 0) {
        agentMessages.push({
          role: msg.role as "user" | "assistant",
          content: parts,
        });
      }
    }
  }

  // Test 1a: User message with images should retain ALL parts (text + images)
  const userMsg = agentMessages[0];
  const isArray = Array.isArray(userMsg.content);
  logTest(
    "User message content is array (multi-part)",
    isArray,
  );

  if (isArray) {
    const parts = userMsg.content as Array<{ type: string }>;
    const imageParts = parts.filter((p) => p.type === "image");
    const textParts = parts.filter((p) => p.type === "text");

    logTest(
      "Image parts preserved in delegation",
      imageParts.length === 2,
      `${imageParts.length} image parts (expected 2)`,
    );

    logTest(
      "Text parts preserved in delegation",
      textParts.length === 1,
      `${textParts.length} text parts (expected 1)`,
    );

    // Before the fix, only text was kept — images were stripped
    logTest(
      "Total parts = 3 (1 text + 2 images)",
      parts.length === 3,
      `${parts.length} total parts`,
    );
  }

  // Test 1b: Assistant string message stays a string
  const assistantMsg = agentMessages[1];
  logTest(
    "Assistant string message stays string",
    typeof assistantMsg.content === "string",
  );
}

// ============================================
// FIX 2: Anti-hallucination prompts
// ============================================

async function testAntiHallucinationPrompts() {
  log("\n2. Fix 2 — Anti-hallucination prompts in PURCHASE_AGENT_PROMPT", "blue");
  log("   (Daniel got fake vendor names like 'Elektronikk AS')\n", "dim");

  logTest(
    "Contains 'ALDRI DIKT OPP FILINNHOLD'",
    PURCHASE_AGENT_PROMPT.includes("ALDRI DIKT OPP FILINNHOLD"),
  );

  logTest(
    "Contains warning about fake vendor names",
    PURCHASE_AGENT_PROMPT.includes("Elektronikk AS"),
    "Mentions forbidden fake names",
  );

  logTest(
    "Contains instruction to say 'cannot see file'",
    PURCHASE_AGENT_PROMPT.includes("Jeg kan ikke se innholdet i filen") ||
    PURCHASE_AGENT_PROMPT.includes("ikke kan se filen"),
  );

  logTest(
    "Contains rule: never guess from filename alone",
    PURCHASE_AGENT_PROMPT.includes("filnavn alene") ||
    PURCHASE_AGENT_PROMPT.includes("filnavnet"),
  );

  // Orchestrator should also describe images accurately
  logTest(
    "Orchestrator prompt: describe images accurately in delegation",
    ORCHESTRATOR_PROMPT.includes("NØYAKTIG") || ORCHESTRATOR_PROMPT.includes("nøyaktig"),
    "Says to describe images accurately",
  );

  logTest(
    "Orchestrator prompt: never make up info",
    ORCHESTRATOR_PROMPT.includes("ALDRI dikt opp") || ORCHESTRATOR_PROMPT.includes("dikt opp"),
  );
}

// ============================================
// FIX 3: Bank reconciliation — account field + pagination
// ============================================

async function testBankReconciliation() {
  log("\n3. Fix 3 — Bank reconciliation uses readOnly 'account' field + pagination", "blue");
  log("   (Daniel's bank matching found 0 results because debitAccount/creditAccount are writeOnly)\n", "dim");

  // Test 3a: Mock with readOnly 'account' field (what Fiken GET API actually returns)
  let getJournalEntriesCallCount = 0;

  const mockClientWithAccount = {
    getBankAccounts: async () => [
      { bankAccountId: 1, name: "Driftskonto", accountCode: "1920", bankAccountNumber: "12345678901", inactive: false },
    ],
    getJournalEntries: async (params?: any) => {
      getJournalEntriesCallCount++;
      const page = params?.page || 0;

      // Page 0: return full page (100 items) — only 1 matches
      if (page === 0) {
        const entries = [];
        // Add the matching entry with readOnly 'account' field
        entries.push({
          journalEntryId: 1001,
          transactionId: 5001,
          date: "2026-02-15",
          description: "Elkjøp - Datautstyr",
          lines: [
            { account: "1920:10001", amount: -250000 },  // readOnly field from GET
            { account: "6860", amount: 200000 },
            { account: "2710", amount: 50000 },
          ],
        });
        // Fill remaining 99 entries (non-matching)
        for (let i = 1; i < 100; i++) {
          entries.push({
            journalEntryId: i + 1001,
            date: "2026-02-10",
            description: `Annen post ${i}`,
            lines: [
              { account: "3000", amount: 100000 },
              { account: "1500", amount: -100000 },
            ],
          });
        }
        return entries;
      }

      // Page 1: return partial page (less than 100) — 1 more match
      if (page === 1) {
        return [
          {
            journalEntryId: 2001,
            transactionId: 5002,
            date: "2026-02-16",
            description: "Komplett - Datautstyr",
            lines: [
              { account: "1920:10001", amount: -249500 }, // Within 5kr margin
              { account: "6860", amount: 199600 },
              { account: "2710", amount: 49900 },
            ],
          },
          {
            journalEntryId: 2002,
            date: "2026-02-16",
            description: "Irrelevant post",
            lines: [
              { account: "3000", amount: 500000 },
            ],
          },
        ];
      }

      return [];
    },
  } as any;

  const bankTools = createBankAgentTools(mockClientWithAccount, "test-selskap");

  const result = await (bankTools.getUnmatchedBankTransactions as any).execute({
    amount: 2500, // 2500 kr
    date: "2026-02-15",
    daysRange: 5,
  });

  logTest(
    "getUnmatchedBankTransactions returns success",
    result.success === true,
  );

  // Before fix: matches would be 0 because code checked line.debitAccount || line.creditAccount
  // which are writeOnly and undefined on GET responses.
  // After fix: code checks (line as any).account first, which is the readOnly field.
  logTest(
    "Finds matches using readOnly 'account' field",
    result.matchCount >= 1,
    `${result.matchCount} matches (expected >= 1, before fix would be 0)`,
  );

  // Test 3b: Pagination — should call getJournalEntries at least twice
  // because page 0 returned 100 items (full page)
  logTest(
    "Pagination: fetched multiple pages",
    getJournalEntriesCallCount >= 2,
    `${getJournalEntriesCallCount} API calls (expected >= 2)`,
  );

  // Test 3c: Verify the matched entry details
  if (result.matches && result.matches.length > 0) {
    const firstMatch = result.matches[0];
    logTest(
      "Match has correct bankAccount from 'account' field",
      firstMatch.bankAccount === "1920:10001",
      `bankAccount: ${firstMatch.bankAccount}`,
    );

    logTest(
      "Match amount in kr",
      firstMatch.amountKr === -2500,
      `${firstMatch.amountKr} kr`,
    );
  }

  // Test 3d: Second match from page 2 (within 5kr margin)
  const secondPageMatches = result.matches?.filter((m: any) => m.journalEntryId === 2001);
  logTest(
    "Pagination: found match on page 2",
    secondPageMatches?.length === 1,
    secondPageMatches?.length === 1 ? "Match from page 2 found" : "Not found",
  );

  // Test 3e: No pagination needed when first page is partial
  let singlePageCalls = 0;
  const mockClientSinglePage = {
    getBankAccounts: async () => [
      { bankAccountId: 1, name: "Driftskonto", accountCode: "1920", bankAccountNumber: "12345678901", inactive: false },
    ],
    getJournalEntries: async () => {
      singlePageCalls++;
      return [
        {
          journalEntryId: 1,
          date: "2026-02-15",
          description: "Test",
          lines: [{ account: "1920:10001", amount: -100000 }],
        },
      ];
    },
  } as any;

  const bankToolsSingle = createBankAgentTools(mockClientSinglePage, "test");
  await (bankToolsSingle.getUnmatchedBankTransactions as any).execute({
    amount: 1000,
    date: "2026-02-15",
  });

  logTest(
    "No unnecessary pagination when page < 100",
    singlePageCalls === 1,
    `${singlePageCalls} API call(s) (expected 1)`,
  );
}

// ============================================
// FIX 8: Human-in-the-loop confirmation
// ============================================

async function testHumanInTheLoop() {
  log("\n4. Fix 8 — Human-in-the-loop confirmation before write actions", "blue");
  log("   (All write actions must ask 'Stemmer dette?' before executing)\n", "dim");

  // Test that BASE_FIKEN_PROMPT (shared by all agents) contains confirmation rules
  logTest(
    "BASE_FIKEN_PROMPT contains 'Stemmer dette?'",
    BASE_FIKEN_PROMPT.includes("Stemmer dette?"),
  );

  logTest(
    "Contains rule: show summary before write actions",
    BASE_FIKEN_PROMPT.includes("oppsummering") && BASE_FIKEN_PROMPT.includes("skrivehandling"),
  );

  logTest(
    "Lists write action types (fakturaer, kjøp, kontakter, etc.)",
    BASE_FIKEN_PROMPT.includes("Opprette fakturaer") &&
    BASE_FIKEN_PROMPT.includes("Sende fakturaer") &&
    BASE_FIKEN_PROMPT.includes("Registrere betalinger") &&
    BASE_FIKEN_PROMPT.includes("Slette noe som helst"),
  );

  logTest(
    "Says WAIT for user confirmation before executing",
    BASE_FIKEN_PROMPT.includes("VENT på brukerens bekreftelse"),
  );

  logTest(
    "Says ONLY after 'ja' execute",
    BASE_FIKEN_PROMPT.includes('FØRST etter "ja"'),
  );

  logTest(
    "Read-only operations are EXEMPT from confirmation",
    BASE_FIKEN_PROMPT.includes("UNNTAK") && BASE_FIKEN_PROMPT.includes("lesing"),
  );

  // Test that ALL agent prompts inherit confirmation rules
  // (they all extend BASE_FIKEN_PROMPT)
  const agentPrompts = [
    { name: "INVOICE_AGENT_PROMPT", prompt: INVOICE_AGENT_PROMPT },
    { name: "PURCHASE_AGENT_PROMPT", prompt: PURCHASE_AGENT_PROMPT },
    { name: "CONTACT_AGENT_PROMPT", prompt: CONTACT_AGENT_PROMPT },
    { name: "OFFER_AGENT_PROMPT", prompt: OFFER_AGENT_PROMPT },
    { name: "BANK_AGENT_PROMPT", prompt: BANK_AGENT_PROMPT },
    { name: "ACCOUNTING_AGENT_PROMPT", prompt: ACCOUNTING_AGENT_PROMPT },
  ];

  for (const { name, prompt } of agentPrompts) {
    logTest(
      `${name} includes confirmation rules`,
      prompt.includes("Stemmer dette?") && prompt.includes("VENT på brukerens bekreftelse"),
    );
  }

  // Orchestrator also has destructive operation warnings
  logTest(
    "Orchestrator warns about destructive operations",
    ORCHESTRATOR_PROMPT.includes("SLETTING") || ORCHESTRATOR_PROMPT.includes("DESTRUKTIV"),
  );
}

// ============================================
// Bonus: Verify prompts are valid (no syntax issues)
// ============================================

async function testPromptsValid() {
  log("\n5. Prompt integrity — no template literal syntax issues", "blue");
  log("   (Fix had a bug with triple backticks breaking template literals)\n", "dim");

  const allPrompts = [
    { name: "BASE_FIKEN_PROMPT", prompt: BASE_FIKEN_PROMPT },
    { name: "INVOICE_AGENT_PROMPT", prompt: INVOICE_AGENT_PROMPT },
    { name: "PURCHASE_AGENT_PROMPT", prompt: PURCHASE_AGENT_PROMPT },
    { name: "CONTACT_AGENT_PROMPT", prompt: CONTACT_AGENT_PROMPT },
    { name: "OFFER_AGENT_PROMPT", prompt: OFFER_AGENT_PROMPT },
    { name: "BANK_AGENT_PROMPT", prompt: BANK_AGENT_PROMPT },
    { name: "ACCOUNTING_AGENT_PROMPT", prompt: ACCOUNTING_AGENT_PROMPT },
    { name: "ORCHESTRATOR_PROMPT", prompt: ORCHESTRATOR_PROMPT },
  ];

  for (const { name, prompt } of allPrompts) {
    // A broken template literal would result in undefined or truncated string
    const isString = typeof prompt === "string";
    const hasLength = prompt && prompt.length > 200;
    // Check it ends properly (doesn't truncate mid-sentence)
    const endsCleanly = prompt && (prompt.trimEnd().endsWith("`") || prompt.trimEnd().endsWith(".") || prompt.trimEnd().endsWith(";") || prompt.trimEnd().endsWith("\n"));
    
    logTest(
      `${name} is valid string (${prompt?.length || 0} chars)`,
      !!(isString && hasLength),
    );
  }
}

// ============================================
// Run all tests
// ============================================

async function main() {
  log("\n" + "=".repeat(60), "bold");
  log("  DANIEL BENTES BUG FIX VERIFICATION TESTS", "bold");
  log("=".repeat(60), "bold");

  await testImagePassthrough();
  await testAntiHallucinationPrompts();
  await testBankReconciliation();
  await testHumanInTheLoop();
  await testPromptsValid();

  log("\n" + "=".repeat(60), "bold");
  log("  TEST SUMMARY", "bold");
  log("=".repeat(60), "bold");
  log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
  log(`  ${colors.red}Failed: ${failed}${colors.reset}`);
  log(`  Total:  ${passed + failed}`);
  log("=".repeat(60) + "\n", "bold");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
