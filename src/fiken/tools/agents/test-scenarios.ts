/**
 * Integration Test - Simulates real user scenarios
 * 
 * Run with: npx tsx src/fiken/tools/agents/test-scenarios.ts
 */

import { 
  createFikenAgentSystem,
  type FikenAgentType,
  type DelegationRequest,
} from "./index.js";

// Mock FikenClient with more realistic responses
const mockClient = {
  // Contacts
  getContacts: async (params?: { name?: string }) => {
    if (params?.name?.toLowerCase().includes("ola")) {
      return [{ contactId: 42, name: "Ola Nordmann AS", email: "ola@nordmann.no", customer: true, customerNumber: 1001 }];
    }
    return [];
  },
  getContact: async (id: number) => ({ contactId: id, name: "Ola Nordmann AS", email: "ola@nordmann.no" }),
  createContact: async (data: any) => ({ contactId: 99, ...data }),
  
  // Invoices
  getInvoices: async () => [],
  createInvoice: async (data: any) => ({ 
    invoiceId: 1, 
    invoiceNumber: 10001, 
    gross: data.lines?.reduce((sum: number, l: any) => sum + (l.unitPrice * l.quantity * 1.25), 0) || 0,
    ...data 
  }),
  getInvoiceCounter: async () => ({ value: 10000 }),
  sendInvoice: async () => {},
  
  // Purchases
  getPurchases: async () => [],
  createPurchase: async (data: any) => ({ purchaseId: 1, transactionId: 100, ...data }),
  addAttachmentToPurchase: async () => ({ identifier: "att-123", downloadUrl: "https://..." }),
  
  // Bank
  getBankAccounts: async () => [
    { bankAccountId: 1, name: "Driftskonto", accountCode: "1920", bankAccountNumber: "12345678901", inactive: false },
  ],
  getBankBalances: async () => [{ bankAccountId: 1, bankAccountCode: "1920", balance: 15000000 }],
  
  // Projects
  getProjects: async () => [{ projectId: 1, name: "Nettside 2024", number: "P001" }],
  createProject: async (data: any) => ({ projectId: 2, ...data }),
  
  // Offers
  getOffers: async () => [],
  createOfferDraft: async (data: any) => ({ draftId: 1, uuid: "uuid-123", ...data }),
  createOfferFromDraft: async () => ({ offerId: 1, offerNumber: 20001 }),
  getOfferCounter: async () => ({ value: 20000 }),
  
  // Order Confirmations
  getOrderConfirmations: async () => [],
  createOrderConfirmationDraft: async (data: any) => ({ draftId: 1, ...data }),
  createOrderConfirmationFromDraft: async () => ({ confirmationId: 1, confirmationNumber: 30001 }),
  createInvoiceDraftFromOrderConfirmation: async () => ({ draftId: 5, customerId: 42 }),
  getOrderConfirmationCounter: async () => ({ value: 30000 }),
  
  // Accounting
  getCompany: async () => ({ name: "Min Bedrift AS", organizationNumber: "999888777" }),
  getAccounts: async () => [
    { code: "3000", name: "Salgsinntekt" },
    { code: "6800", name: "Kontorrekvisita" },
    { code: "7140", name: "Reisekostnad" },
  ],
  getAccountBalances: async () => [],
  getJournalEntries: async () => [],
  createGeneralJournalEntry: async (data: any) => ({ journalEntryId: 1, ...data }),
  
  // Counters
  createInvoiceCounter: async (v: number) => ({ value: v }),
  createCreditNoteCounter: async (v: number) => ({ value: v }),
  createOfferCounter: async (v: number) => ({ value: v }),
  createOrderConfirmationCounter: async (v: number) => ({ value: v }),
  getCreditNoteCounter: async () => ({ value: 10000 }),
  
  // Products
  getProducts: async () => [{ productId: 1, name: "Konsulenttjenester", unitPrice: 150000 }],
} as any;

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

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runScenarios() {
  log("\n" + "=".repeat(60), "bold");
  log("  INTEGRATION TEST - USER SCENARIOS", "bold");
  log("=".repeat(60) + "\n", "bold");
  
  const system = createFikenAgentSystem({ 
    client: mockClient, 
    companySlug: "min-bedrift" 
  });
  
  // Set up delegation handler that simulates agent execution
  system.setDelegationHandler(async (request: DelegationRequest) => {
    log(`  [Delegation] ${request.fromAgent} → ${request.toAgent}: "${request.task}"`, "dim");
    
    // Get the target agent's tools and execute based on task
    const tools = system.agents[request.toAgent].tools;
    
    // Simple task routing based on keywords
    if (request.task.toLowerCase().includes("finn kunde") || request.task.toLowerCase().includes("søk kontakt")) {
      const result = await (tools as any).searchContacts?.execute({ name: request.context?.name || "" });
      return { success: true, result, fromAgent: request.toAgent };
    }
    
    return { 
      success: true, 
      result: { message: `Task "${request.task}" handled by ${request.toAgent}` },
      fromAgent: request.toAgent 
    };
  });
  
  // ============================================
  // Scenario 1: Create and send invoice
  // ============================================
  log("SCENARIO 1: Fakturering av kunde", "cyan");
  log("-".repeat(40), "dim");
  
  const invoiceTools = system.agents.invoice_agent.tools;
  
  // Step 1: Search for customer (would normally delegate to contact_agent)
  log("  → Søker etter kunde 'Ola Nordmann'...", "yellow");
  
  // Step 2: Create invoice
  log("  → Oppretter faktura...", "yellow");
  const invoiceResult = await (invoiceTools.createInvoice as any).execute({
    customerId: 42,
    issueDate: "2024-01-15",
    dueDate: "2024-01-29",
    lines: [
      { description: "Konsulenttjenester januar", unitPrice: 150000, quantity: 40, vatType: "HIGH", incomeAccount: "3000" }
    ],
    bankAccountCode: "1920",
    cash: false,
  });
  
  if (invoiceResult.success) {
    log(`  ✓ Faktura #${invoiceResult.invoice.invoiceNumber} opprettet`, "green");
    log(`    Beløp: ${(invoiceResult.invoice.gross / 100).toLocaleString('nb-NO')} kr`, "dim");
  } else {
    log(`  ✗ Feil: ${invoiceResult.error}`, "red");
  }
  
  // ============================================
  // Scenario 2: Register purchase with receipt
  // ============================================
  log("\nSCENARIO 2: Registrere kvittering", "cyan");
  log("-".repeat(40), "dim");
  
  const purchaseTools = system.agents.purchase_agent.tools;
  
  log("  → Henter bankkontoer...", "yellow");
  const bankResult = await (purchaseTools.getBankAccounts as any).execute({});
  log(`  ✓ Fant ${bankResult.count} bankkontoer`, "green");
  
  log("  → Oppretter kjøp...", "yellow");
  const purchaseResult = await (purchaseTools.createPurchase as any).execute({
    supplierId: 1,
    date: "2024-01-10",
    kind: "cash_purchase",
    lines: [
      { description: "Kontorrekvisita", netAmount: 40000, vatType: "HIGH", account: "6800" }
    ],
    paymentAccount: "1920",
    paymentDate: "2024-01-10",
  });
  
  if (purchaseResult.success) {
    log(`  ✓ Kjøp registrert (ID: ${purchaseResult.purchase.purchaseId})`, "green");
  } else {
    log(`  ✗ Feil: ${purchaseResult.error}`, "red");
  }
  
  // ============================================
  // Scenario 3: Check bank balance
  // ============================================
  log("\nSCENARIO 3: Sjekke banksaldo", "cyan");
  log("-".repeat(40), "dim");
  
  const bankTools = system.agents.bank_agent.tools;
  
  log("  → Henter banksaldoer...", "yellow");
  const balanceResult = await (bankTools.getBankBalances as any).execute({});
  
  if (balanceResult.success) {
    log(`  ✓ ${balanceResult.summary}`, "green");
    for (const b of balanceResult.balances) {
      log(`    ${b.name}: ${b.balanceKr.toLocaleString('nb-NO')} kr`, "dim");
    }
  }
  
  // ============================================
  // Scenario 4: Create offer -> OC -> Invoice workflow
  // ============================================
  log("\nSCENARIO 4: Tilbud → Ordrebekreftelse → Faktura", "cyan");
  log("-".repeat(40), "dim");
  
  const offerTools = system.agents.offer_agent.tools;
  
  // Step 1: Create offer draft
  log("  → Oppretter tilbudsutkast...", "yellow");
  const offerDraftResult = await (offerTools.createOfferDraft as any).execute({
    customerId: 42,
    daysUntilDueDate: 30,
    lines: [
      { description: "Webdesign", unitPrice: 5000000, quantity: 1, vatType: "HIGH", incomeAccount: "3000" },
      { description: "Utvikling", unitPrice: 150000, quantity: 80, vatType: "HIGH", incomeAccount: "3000" },
    ],
    offerText: "Tilbud på nettsideutvikling",
  });
  
  if (offerDraftResult.success) {
    log(`  ✓ Tilbudsutkast opprettet (ID: ${offerDraftResult.draft.draftId})`, "green");
    
    // Step 2: Create offer from draft
    log("  → Oppretter tilbud fra utkast...", "yellow");
    const offerResult = await (offerTools.createOfferFromDraft as any).execute({
      draftId: offerDraftResult.draft.draftId,
    });
    
    if (offerResult.success) {
      log(`  ✓ Tilbud #${offerResult.offer.offerNumber} opprettet`, "green");
    }
  }
  
  // ============================================
  // Scenario 5: Initialize counters
  // ============================================
  log("\nSCENARIO 5: Initialisere tellere", "cyan");
  log("-".repeat(40), "dim");
  
  const accountingTools = system.agents.accounting_agent.tools;
  
  log("  → Sjekker og initialiserer tellere...", "yellow");
  const counterResult = await (accountingTools.checkAndInitializeCounters as any).execute({
    startValue: 10000,
  });
  
  if (counterResult.success) {
    log("  ✓ Alle tellere er klare:", "green");
    for (const [key, value] of Object.entries(counterResult.counters)) {
      const counter = value as { success: boolean; message: string };
      log(`    ${key}: ${counter.message}`, "dim");
    }
  }
  
  // ============================================
  // Scenario 6: Verify no delegation tools on sub-agents (Bug 10 fix)
  // ============================================
  log("\nSCENARIO 6: Ingen delegeringsverktøy på sub-agenter (Bug 10 fiks)", "cyan");
  log("-".repeat(40), "dim");
  
  log("  → Sjekker at invoice agent IKKE har delegeringsverktøy...", "yellow");
  const hasContactDelegation = 'delegateToContactAgent' in invoiceTools;
  const hasPurchaseDelegation = 'delegateToPurchaseAgent' in invoiceTools;
  
  if (!hasContactDelegation && !hasPurchaseDelegation) {
    log("  ✓ Sub-agenter har ingen delegeringsverktøy (Bug 10 fikset)", "green");
  } else {
    log("  ✗ Sub-agenter har fortsatt delegeringsverktøy (Bug 10 IKKE fikset)", "red");
  }
  
  // ============================================
  // Scenario 7: Duplicate purchase detection (Bug 12 fix)
  // ============================================
  log("\nSCENARIO 7: Duplikat-deteksjon for kjøp (Bug 12 fiks)", "cyan");
  log("-".repeat(40), "dim");
  
  // Create a mock client that returns an existing purchase on same date with same amount
  const dupMockClient = {
    ...mockClient,
    getPurchases: async () => [
      { 
        purchaseId: 42, 
        date: "2026-02-07",
        supplier: { name: "IKEA AS" },
        supplierId: 10,
        lines: [
          { description: "Møbler og tilbehør", netPrice: 851181, vat: 212795, grossPrice: 1063976 }
        ],
        attachments: [{ identifier: "att-1" }],
        paid: true,
      }
    ],
    createPurchase: async (data: any) => ({ purchaseId: 99, ...data }),
    getBankAccounts: async () => [
      { bankAccountId: 1, name: "Demo-konto", accountCode: "1920:10001", bankAccountNumber: "12345678901", inactive: false },
    ],
  } as any;
  
  const dupSystem = createFikenAgentSystem({ client: dupMockClient, companySlug: "test" });
  const dupPurchaseTools = dupSystem.agents.purchase_agent.tools;
  
  // Try to create the same purchase (same date, same net amount, same supplier)
  log("  → Prøver å opprette duplikat-kjøp (IKEA, 10639.76 kr, 2026-02-07)...", "yellow");
  const dupResult = await (dupPurchaseTools.createPurchase as any).execute({
    date: "2026-02-07",
    kind: "cash_purchase",
    paid: true,
    currency: "NOK",
    lines: [
      { description: "Møbler og tilbehør", netPrice: 851181, vatType: "HIGH", account: "4000" }
    ],
    supplierId: 10,
    paymentAccount: "1920:10001",
  });
  
  if (dupResult.duplicateFound) {
    log(`  ✓ Duplikat oppdaget! Eksisterende kjøp-ID: ${dupResult.existingPurchase.purchaseId}`, "green");
    log(`    Melding: ${dupResult.message.split('\n')[0]}`, "dim");
  } else if (dupResult.success) {
    log("  ✗ Duplikat ble IKKE oppdaget - kjøp ble opprettet på nytt!", "red");
  } else {
    log(`  ✗ Uventet feil: ${dupResult.error}`, "red");
  }
  
  // Also test that a genuinely new purchase goes through
  log("  → Oppretter unikt kjøp (annet beløp)...", "yellow");
  const uniqueResult = await (dupPurchaseTools.createPurchase as any).execute({
    date: "2026-02-07",
    kind: "cash_purchase",
    paid: true,
    currency: "NOK",
    lines: [
      { description: "Noe helt annet", netPrice: 50000, vatType: "HIGH", account: "6800" }
    ],
    paymentAccount: "1920:10001",
  });
  
  if (uniqueResult.success && !uniqueResult.duplicateFound) {
    log(`  ✓ Unikt kjøp opprettet (ID: ${uniqueResult.purchase.purchaseId})`, "green");
  } else if (uniqueResult.duplicateFound) {
    log("  ✗ Unikt kjøp ble feilaktig flagget som duplikat!", "red");
  } else {
    log(`  ✗ Feil: ${uniqueResult.error}`, "red");
  }
  
  // ============================================
  // Summary
  // ============================================
  log("\n" + "=".repeat(60), "bold");
  log("  ALLE SCENARIOER FULLFØRT", "green");
  log("=".repeat(60) + "\n", "bold");
}

runScenarios().catch(console.error);
