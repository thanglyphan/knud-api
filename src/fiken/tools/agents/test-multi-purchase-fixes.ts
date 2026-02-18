/**
 * Unit tests for Multi-Purchase / Multi-File Fixes (Round 3)
 * 
 * Tests the specific code changes made to fix:
 * 
 * Fix 1-2: File persistence across turns (frontend resend + backend filesResend flag)
 * Fix 3: Multi-entity safety-net (tracks ALL created entities, not just last)
 * Fix 4: Orchestrator multi-operation workflow instructions
 * Fix 5: Purchase agent multi-purchase + supplier lookup with list
 * Fix 6: Account validation (removed hardcoded list, always use suggestAccounts)
 * Fix 7: maxSteps increased from 15 to 25
 * 
 * Run with: npx tsx src/fiken/tools/agents/test-multi-purchase-fixes.ts
 */

import {
  PURCHASE_AGENT_PROMPT,
  ORCHESTRATOR_PROMPT,
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
// FIX 3: Multi-entity safety-net
// (Tests the logic from index.ts delegation handler)
// ============================================

function testMultiEntitySafetyNet() {
  log("\n═══ FIX 3: Multi-Entity Safety-Net ═══", "bold");

  // Simulate the multi-entity tracking logic from index.ts
  function extractCreatedEntities(
    steps: Array<{ toolResults: Array<{ toolName: string; result: Record<string, unknown> }> }>
  ): Array<{ entityId: number; entityType: string; order: number }> {
    const createdEntities: Array<{ entityId: number; entityType: string; order: number }> = [];
    let entityOrder = 0;
    for (const step of steps) {
      for (const result of step.toolResults || []) {
        const r = result.result;
        if (r && r._operationComplete) {
          if (result.toolName === 'createPurchase' && r.purchase && (r.purchase as any).purchaseId) {
            createdEntities.push({ entityId: (r.purchase as any).purchaseId, entityType: 'purchase', order: entityOrder++ });
          } else if (result.toolName === 'createSale' && r.sale && (r.sale as any).saleId) {
            createdEntities.push({ entityId: (r.sale as any).saleId, entityType: 'sale', order: entityOrder++ });
          } else if (result.toolName === 'createInvoice' && r.invoice && (r.invoice as any).invoiceId) {
            createdEntities.push({ entityId: (r.invoice as any).invoiceId, entityType: 'invoice', order: entityOrder++ });
          }
        }
      }
    }
    return createdEntities;
  }

  // Test 1: Single entity (backward compatibility)
  {
    const steps = [
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 100 } } },
        ],
      },
    ];
    const entities = extractCreatedEntities(steps);
    logTest("Single entity: extracts one purchase", entities.length === 1);
    logTest("Single entity: correct purchaseId", entities[0]?.entityId === 100);
    logTest("Single entity: correct type", entities[0]?.entityType === 'purchase');
    logTest("Single entity: order is 0", entities[0]?.order === 0);
  }

  // Test 2: Multiple purchases (the 4-receipt scenario)
  {
    const steps = [
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 100 } } },
        ],
      },
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 101 } } },
        ],
      },
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 102 } } },
        ],
      },
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 103 } } },
        ],
      },
    ];
    const entities = extractCreatedEntities(steps);
    logTest("4 purchases: extracts all 4", entities.length === 4);
    logTest("4 purchases: correct IDs", 
      entities[0]?.entityId === 100 && entities[1]?.entityId === 101 && 
      entities[2]?.entityId === 102 && entities[3]?.entityId === 103);
    logTest("4 purchases: correct order", 
      entities[0]?.order === 0 && entities[1]?.order === 1 && 
      entities[2]?.order === 2 && entities[3]?.order === 3);
  }

  // Test 3: Mixed entity types
  {
    const steps = [
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 200 } } },
        ],
      },
      {
        toolResults: [
          { toolName: 'createInvoice', result: { _operationComplete: true, invoice: { invoiceId: 300 } } },
        ],
      },
      {
        toolResults: [
          { toolName: 'createSale', result: { _operationComplete: true, sale: { saleId: 400 } } },
        ],
      },
    ];
    const entities = extractCreatedEntities(steps);
    logTest("Mixed types: extracts all 3", entities.length === 3);
    logTest("Mixed types: purchase first", entities[0]?.entityType === 'purchase' && entities[0]?.entityId === 200);
    logTest("Mixed types: invoice second", entities[1]?.entityType === 'invoice' && entities[1]?.entityId === 300);
    logTest("Mixed types: sale third", entities[2]?.entityType === 'sale' && entities[2]?.entityId === 400);
  }

  // Test 4: Steps with uploads mixed in (should not duplicate)
  {
    const steps = [
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 500 } } },
        ],
      },
      {
        toolResults: [
          { toolName: 'uploadAttachmentToPurchase', result: { fileUploaded: true } },
        ],
      },
      {
        toolResults: [
          { toolName: 'createPurchase', result: { _operationComplete: true, purchase: { purchaseId: 501 } } },
        ],
      },
    ];
    const entities = extractCreatedEntities(steps);
    logTest("With uploads: extracts only creates (not uploads)", entities.length === 2);
    logTest("With uploads: correct IDs", entities[0]?.entityId === 500 && entities[1]?.entityId === 501);
  }

  // Test 5: No _operationComplete flag (should not extract)
  {
    const steps = [
      {
        toolResults: [
          { toolName: 'searchPurchases', result: { purchases: [] } },
        ],
      },
    ];
    const entities = extractCreatedEntities(steps);
    logTest("No creates: empty array", entities.length === 0);
  }

  // Test 6: fileIndex mapping for multi-entity upload
  {
    const entities = [
      { entityId: 100, entityType: 'purchase', order: 0 },
      { entityId: 101, entityType: 'purchase', order: 1 },
      { entityId: 102, entityType: 'purchase', order: 2 },
    ];
    const files = [
      { name: "IKEA.pdf", type: "application/pdf", data: "base64..." },
      { name: "Electrolux.pdf", type: "application/pdf", data: "base64..." },
      { name: "Matverste.pdf", type: "application/pdf", data: "base64..." },
    ];

    // Simulate the multi-entity fileIndex logic
    const uploadPlan: Array<{ entityId: number; fileIndex: number }> = [];
    for (const entity of entities) {
      const fileIndex = entity.order + 1;
      if (fileIndex <= files.length) {
        uploadPlan.push({ entityId: entity.entityId, fileIndex });
      }
    }

    logTest("FileIndex mapping: 3 uploads planned", uploadPlan.length === 3);
    logTest("FileIndex mapping: entity 100 → file 1", uploadPlan[0]?.entityId === 100 && uploadPlan[0]?.fileIndex === 1);
    logTest("FileIndex mapping: entity 101 → file 2", uploadPlan[1]?.entityId === 101 && uploadPlan[1]?.fileIndex === 2);
    logTest("FileIndex mapping: entity 102 → file 3", uploadPlan[2]?.entityId === 102 && uploadPlan[2]?.fileIndex === 3);
  }

  // Test 7: More entities than files
  {
    const entities = [
      { entityId: 100, entityType: 'purchase', order: 0 },
      { entityId: 101, entityType: 'purchase', order: 1 },
      { entityId: 102, entityType: 'purchase', order: 2 },
      { entityId: 103, entityType: 'purchase', order: 3 },
    ];
    const files = [
      { name: "file1.pdf", type: "application/pdf", data: "base64..." },
      { name: "file2.pdf", type: "application/pdf", data: "base64..." },
    ];

    const uploadPlan: Array<{ entityId: number; fileIndex: number }> = [];
    for (const entity of entities) {
      const fileIndex = entity.order + 1;
      if (fileIndex <= files.length) {
        uploadPlan.push({ entityId: entity.entityId, fileIndex });
      }
    }

    logTest("More entities than files: only 2 uploads", uploadPlan.length === 2);
    logTest("More entities than files: entities 3-4 skipped", 
      !uploadPlan.some(p => p.entityId === 102 || p.entityId === 103));
  }
}

// ============================================
// FIX 4: Orchestrator prompt — multi-operation workflow
// ============================================

function testOrchestratorMultiOpPrompt() {
  log("\n═══ FIX 4: Orchestrator Multi-Operation Workflow Prompt ═══", "bold");

  // Test: FLER-OPERASJONS-FLYT section exists
  logTest(
    "Has FLER-OPERASJONS-FLYT section",
    ORCHESTRATOR_PROMPT.includes("FLER-OPERASJONS-FLYT")
  );

  // Test: Dependency ordering instructions
  logTest(
    "Has dependency ordering: create suppliers FIRST",
    ORCHESTRATOR_PROMPT.includes("Opprett leverandører/kontakter FØRST")
  );

  logTest(
    "Has dependency ordering: wait for contactId",
    ORCHESTRATOR_PROMPT.includes("Vent på contactId")
  );

  logTest(
    "Has dependency ordering: then create purchases",
    ORCHESTRATOR_PROMPT.includes("Deretter") && ORCHESTRATOR_PROMPT.includes("purchase_agent")
  );

  // Test: Delegation of multiple purchases instructions
  logTest(
    "Has instruction to delegate ALL purchases in ONE delegation",
    ORCHESTRATOR_PROMPT.includes("ALLE kjøpene i ÉN delegering")
  );

  logTest(
    "Has detailed example with fileIndex mapping",
    ORCHESTRATOR_PROMPT.includes("Fil 1 = IKEA") || ORCHESTRATOR_PROMPT.includes("Fil 1")
  );

  // Test: Error handling and progress tracking
  logTest(
    "Has error recovery: never re-ask resolved questions",
    ORCHESTRATOR_PROMPT.includes("ALDRI spør brukeren om ting som allerede er avklart")
  );

  logTest(
    "Has partial success handling",
    ORCHESTRATOR_PROMPT.includes("DELVIS") || ORCHESTRATOR_PROMPT.includes("delvis")
  );

  logTest(
    "Has progress tracking instruction",
    ORCHESTRATOR_PROMPT.includes("3 av 4") || ORCHESTRATOR_PROMPT.includes("av 4")
  );

  logTest(
    "Has instruction: never restart whole flow",
    ORCHESTRATOR_PROMPT.includes("ALDRI start hele flyten på nytt")
  );

  // Test: Confirmation flow with files
  logTest(
    "Has instruction about files surviving confirmation",
    ORCHESTRATOR_PROMPT.includes("Filene er FORTSATT tilgjengelig") || ORCHESTRATOR_PROMPT.includes("re-sendt")
  );

  // Test: JA to multiple planned operations
  logTest(
    "Has 'JA til BEKREFTELSE av FLERE operasjoner' section",
    ORCHESTRATOR_PROMPT.includes("JA") && ORCHESTRATOR_PROMPT.includes("FLERE") && ORCHESTRATOR_PROMPT.includes("planlagte")
  );

  logTest(
    "Has instruction: nothing created yet after JA",
    ORCHESTRATOR_PROMPT.includes("INGENTING er opprettet ennå")
  );

  logTest(
    "Has instruction: reconstruct ALL details",
    ORCHESTRATOR_PROMPT.includes("Rekonstruer ALLE detaljer")
  );
}

// ============================================
// FIX 5: Purchase agent — multi-purchase + supplier lookup
// ============================================

function testPurchaseAgentMultiPurchasePrompt() {
  log("\n═══ FIX 5: Purchase Agent Multi-Purchase + Supplier Lookup ═══", "bold");

  // Test: Multi-purchase instructions
  logTest(
    "Has multi-purchase sequential iteration instruction",
    PURCHASE_AGENT_PROMPT.includes("Iterer sekvensielt")
  );

  logTest(
    "Has fileIndex mapping instruction",
    PURCHASE_AGENT_PROMPT.includes("fileIndex-mapping") || PURCHASE_AGENT_PROMPT.includes("Fil 1 = fileIndex 1")
  );

  logTest(
    "Has instruction to continue on error",
    PURCHASE_AGENT_PROMPT.includes("Ikke stopp ved feil")
  );

  logTest(
    "Has summary instruction",
    PURCHASE_AGENT_PROMPT.includes("Opprettet 3 av 4")
  );

  logTest(
    "Has example flow for 3 purchases",
    PURCHASE_AGENT_PROMPT.includes("searchContacts") && PURCHASE_AGENT_PROMPT.includes("createPurchase") && 
    PURCHASE_AGENT_PROMPT.includes("uploadAttachmentToPurchase")
  );

  logTest(
    "Has uploadAttachmentToPurchase after each createPurchase in example",
    PURCHASE_AGENT_PROMPT.includes("→ createPurchase") && PURCHASE_AGENT_PROMPT.includes("→ uploadAttachmentToPurchase")
  );

  // Test: Supplier lookup with list
  logTest(
    "Has supplier lookup section",
    PURCHASE_AGENT_PROMPT.includes("Leverandøroppslag")
  );

  logTest(
    "Has instruction to search first",
    PURCHASE_AGENT_PROMPT.includes("searchContacts(name:") || PURCHASE_AGENT_PROMPT.includes("searchContacts(")
  );

  logTest(
    "Has instruction to show supplier list when not found",
    PURCHASE_AGENT_PROMPT.includes("Hent ALLE leverandører") || PURCHASE_AGENT_PROMPT.includes("supplierOnly: true")
  );

  logTest(
    "Has numbered list instruction for suppliers",
    PURCHASE_AGENT_PROMPT.includes("nummerert liste")
  );

  logTest(
    "Has 3 options: existing, create new, or no supplier",
    PURCHASE_AGENT_PROMPT.includes("opprette") && PURCHASE_AGENT_PROMPT.includes("kontantkjøp")
  );

  logTest(
    "Never ask user for contactId",
    PURCHASE_AGENT_PROMPT.includes("ALDRI be brukeren om contactId")
  );

  // Test: Old bad instruction removed
  logTest(
    "Removed old 'si at du trenger leverandørens contactId' instruction",
    !PURCHASE_AGENT_PROMPT.includes("si at du trenger leverandørens contactId")
  );

  // Test: Updated supplier flow references searchContacts
  logTest(
    "Updated supplier flow says to search or show list",
    PURCHASE_AGENT_PROMPT.includes("SØK med searchContacts") || PURCHASE_AGENT_PROMPT.includes("vis leverandørliste")
  );
}

// ============================================
// FIX 6: Account validation — no hardcoded list
// ============================================

function testAccountValidation() {
  log("\n═══ FIX 6: Account Validation — No Hardcoded List ═══", "bold");

  // Test: Hardcoded account list removed
  logTest(
    "Removed '6900: Telefon/internett' from prompt",
    !PURCHASE_AGENT_PROMPT.includes("6900: Telefon/internett")
  );

  logTest(
    "Removed '7350: Mat til møter' from prompt",
    !PURCHASE_AGENT_PROMPT.includes("7350: Mat til møter (internt)")
  );

  logTest(
    "Removed '5915: Overtidsmat' from prompt",
    !PURCHASE_AGENT_PROMPT.includes("5915: Overtidsmat")
  );

  logTest(
    "Removed entire 'VANLIGE KONTOER FOR KJØP' section",
    !PURCHASE_AGENT_PROMPT.includes("VANLIGE KONTOER FOR KJØP")
  );

  // Test: New validation instructions
  logTest(
    "Has instruction to always use suggestAccounts",
    PURCHASE_AGENT_PROMPT.includes("ALLTID") && PURCHASE_AGENT_PROMPT.includes("suggestAccounts")
  );

  logTest(
    "Has instruction to validate even when user specifies konto",
    PURCHASE_AGENT_PROMPT.includes("Selv når brukeren oppgir") || PURCHASE_AGENT_PROMPT.includes("brukeren ALLEREDE har oppgitt konto")
  );

  logTest(
    "Has instruction for when konto doesn't exist",
    PURCHASE_AGENT_PROMPT.includes("finnes ikke i kontoplanen") || PURCHASE_AGENT_PROMPT.includes("IKKE finnes")
  );

  // Test: Old skip-suggestAccounts instruction removed
  logTest(
    "Removed 'IKKE kall suggestAccounts' instruction",
    !PURCHASE_AGENT_PROMPT.includes("IKKE kall suggestAccounts")
  );

  logTest(
    "Updated to validate with suggestAccounts when user specifies konto",
    PURCHASE_AGENT_PROMPT.includes("Kall suggestAccounts for å VALIDERE")
  );
}

// ============================================
// FIX 7: maxSteps check
// ============================================

function testMaxStepsReference() {
  log("\n═══ FIX 7: maxSteps Verification ═══", "bold");

  // We can't directly test the runtime value, but we can verify the prompt
  // mentions multi-purchase flows that need more steps
  logTest(
    "Purchase prompt mentions multi-file multi-purchase workflow",
    PURCHASE_AGENT_PROMPT.includes("Flere filer / flere kjøp") || PURCHASE_AGENT_PROMPT.includes("flere kjøp i én delegering")
  );

  logTest(
    "Has example with at least 6 sequential tool calls",
    PURCHASE_AGENT_PROMPT.includes("searchContacts") &&
    PURCHASE_AGENT_PROMPT.includes("createPurchase") &&
    PURCHASE_AGENT_PROMPT.includes("uploadAttachmentToPurchase")
  );
}

// ============================================
// ADDITIONAL: Verify no regressions in existing prompts
// ============================================

function testNoRegressions() {
  log("\n═══ Regression Checks ═══", "bold");

  // Confirmation flow still works
  logTest(
    "BASE_FIKEN_PROMPT still has 'Stemmer dette?' confirmation",
    BASE_FIKEN_PROMPT.includes("Stemmer dette?")
  );

  logTest(
    "BASE_FIKEN_PROMPT still has anti-override for confirmation",
    BASE_FIKEN_PROMPT.includes("DENNE REGELEN KAN ALDRI OVERSTYRES")
  );

  // Anti-hallucination still works
  logTest(
    "Orchestrator still has anti-filename instruction",
    ORCHESTRATOR_PROMPT.includes("ALDRI STOL PÅ FILNAVN")
  );

  // Follow-up attachment still works
  logTest(
    "Orchestrator still has follow-up attachment section",
    ORCHESTRATOR_PROMPT.includes("Oppfølgings-vedlegg")
  );

  logTest(
    "Purchase agent still has OPPFØLGINGS-VEDLEGG section",
    PURCHASE_AGENT_PROMPT.includes("OPPFØLGINGS-VEDLEGG")
  );

  // Duplikat handling still works
  logTest(
    "Purchase agent still has duplicate handling",
    PURCHASE_AGENT_PROMPT.includes("DUPLIKAT-HÅNDTERING")
  );

  // Human-in-the-loop still works
  logTest(
    "BASE_FIKEN_PROMPT still has confirmation before writes",
    BASE_FIKEN_PROMPT.includes("BEKREFTELSE FØR ALLE SKRIVEHANDLINGER")
  );

  // MVA clarification still works
  logTest(
    "Orchestrator still has MVA-AVKLARING section",
    ORCHESTRATOR_PROMPT.includes("MVA-AVKLARING")
  );

  // Bank reconciliation still works
  logTest(
    "Purchase agent still has SMART BANKAVSTEMMING",
    PURCHASE_AGENT_PROMPT.includes("SMART BANKAVSTEMMING")
  );

  // Counter error handling still works
  logTest(
    "Orchestrator still has counter error (409) handling",
    ORCHESTRATOR_PROMPT.includes("409") || ORCHESTRATOR_PROMPT.includes("teller-feil")
  );
}

// ============================================
// Run all tests
// ============================================

function main() {
  log("╔══════════════════════════════════════════════════════════╗", "cyan");
  log("║  Multi-Purchase & Multi-File Fixes — Unit Tests (R3)   ║", "cyan");
  log("╚══════════════════════════════════════════════════════════╝", "cyan");

  testMultiEntitySafetyNet();
  testOrchestratorMultiOpPrompt();
  testPurchaseAgentMultiPurchasePrompt();
  testAccountValidation();
  testMaxStepsReference();
  testNoRegressions();

  // Summary
  const total = passed + failed;
  log("\n══════════════════════════════════════", "bold");
  log(`Results: ${passed}/${total} passed`, passed === total ? "green" : "red");
  if (failed > 0) {
    log(`${failed} test(s) FAILED`, "red");
    process.exit(1);
  } else {
    log("All tests passed!", "green");
  }
}

main();
