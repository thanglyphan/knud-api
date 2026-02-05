/**
 * Test script for Fiken Multi-Agent System
 * 
 * Run with: npx tsx src/fiken/tools/agents/test-agents.ts
 */

import { 
  createFikenAgentSystem,
  createInvoiceAgentTools,
  createPurchaseAgentTools,
  createContactAgentTools,
  createOfferAgentTools,
  createBankAgentTools,
  createAccountingAgentTools,
  INVOICE_AGENT_PROMPT,
  PURCHASE_AGENT_PROMPT,
  CONTACT_AGENT_PROMPT,
  OFFER_AGENT_PROMPT,
  BANK_AGENT_PROMPT,
  ACCOUNTING_AGENT_PROMPT,
  ORCHESTRATOR_PROMPT,
  type FikenAgentType,
  type DelegationRequest,
} from "./index.js";

// Mock FikenClient for testing
const mockClient = {
  // Invoice methods
  getInvoices: async () => [{ invoiceId: 1, invoiceNumber: 10001, customer: { name: "Test AS" }, gross: 125000 }],
  getInvoice: async (id: number) => ({ invoiceId: id, invoiceNumber: 10001 }),
  createInvoice: async (data: any) => ({ invoiceId: 1, invoiceNumber: 10001, ...data }),
  getInvoiceDrafts: async () => [],
  getCreditNotes: async () => [],
  getSales: async () => [],
  getInvoiceCounter: async () => ({ value: 10000 }),
  getCreditNoteCounter: async () => ({ value: 10000 }),
  
  // Purchase methods
  getPurchases: async () => [{ purchaseId: 1, supplier: { name: "Leverandør AS" }, gross: 50000 }],
  getPurchase: async (id: number) => ({ purchaseId: id }),
  createPurchase: async (data: any) => ({ purchaseId: 1, ...data }),
  getPurchaseDrafts: async () => [],
  getBankAccounts: async () => [
    { bankAccountId: 1, name: "Driftskonto", accountCode: "1920", bankAccountNumber: "12345678901" },
    { bankAccountId: 2, name: "Skattetrekk", accountCode: "1950", bankAccountNumber: "12345678902" },
  ],
  
  // Contact methods
  getContacts: async () => [{ contactId: 1, name: "Test Kunde AS", customer: true }],
  getContact: async (id: number) => ({ contactId: id, name: "Test Kunde AS" }),
  createContact: async (data: any) => ({ contactId: 1, ...data }),
  getProducts: async () => [],
  
  // Offer methods
  getOffers: async () => [{ offerId: 1, offerNumber: 20001, customer: { name: "Kunde AS" } }],
  getOffer: async (id: number) => ({ offerId: id }),
  getOfferDrafts: async () => [],
  createOfferDraft: async (data: any) => ({ draftId: 1, ...data }),
  createOfferFromDraft: async (id: number) => ({ offerId: 1, offerNumber: 20001 }),
  getOrderConfirmations: async () => [],
  getOrderConfirmationDrafts: async () => [],
  getOfferCounter: async () => ({ value: 20000 }),
  createOfferCounter: async (value: number) => ({ value }),
  getOrderConfirmationCounter: async () => ({ value: 30000 }),
  createOrderConfirmationCounter: async (value: number) => ({ value }),
  
  // Bank methods
  getBankAccount: async (id: number) => ({ bankAccountId: id, name: "Driftskonto" }),
  createBankAccount: async (data: any) => ({ bankAccountId: 1, ...data }),
  getBankBalances: async () => [{ bankAccountId: 1, bankAccountCode: "1920", balance: 10000000 }],
  getTransactions: async () => [],
  getTransaction: async (id: number) => ({ transactionId: id }),
  getJournalEntries: async () => [],
  getInbox: async () => [],
  getInboxDocument: async (id: number) => ({ documentId: id }),
  
  // Accounting methods
  getCompany: async () => ({ name: "Test Selskap AS", organizationNumber: "123456789", slug: "test-selskap" }),
  getAccounts: async () => [
    { code: "3000", name: "Salgsinntekt, avgiftspliktig" },
    { code: "6300", name: "Leie av lokale" },
    { code: "6800", name: "Kontorrekvisita" },
  ],
  getAccountBalances: async () => [
    { code: "3000", name: "Salgsinntekt", balance: -500000 },
    { code: "6300", name: "Leie", balance: 120000 },
  ],
  getJournalEntry: async (id: number) => ({ journalEntryId: id, transactionId: 100 }),
  createGeneralJournalEntry: async (data: any) => ({ journalEntryId: 1, ...data }),
  deleteTransaction: async () => {},
  getProjects: async () => [{ projectId: 1, name: "Webprosjekt", number: "P001" }],
  getProject: async (id: number) => ({ projectId: id, name: "Webprosjekt" }),
  createProject: async (data: any) => ({ projectId: 1, ...data }),
  updateProject: async (id: number, data: any) => ({ projectId: id, ...data }),
  deleteProject: async () => {},
  createInvoiceCounter: async (value: number) => ({ value }),
  createCreditNoteCounter: async (value: number) => ({ value }),
} as any;

const companySlug = "test-selskap";

// Colors for console output
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name: string, passed: boolean, details?: string) {
  const status = passed ? `${colors.green}✓ PASS${colors.reset}` : `${colors.red}✗ FAIL${colors.reset}`;
  console.log(`  ${status} ${name}${details ? ` - ${details}` : ""}`);
}

async function testAgentTools() {
  log("\n========================================", "bold");
  log("  FIKEN MULTI-AGENT SYSTEM TESTS", "bold");
  log("========================================\n", "bold");
  
  let passed = 0;
  let failed = 0;
  
  // ============================================
  // Test 1: Agent Creation
  // ============================================
  log("1. Testing Agent Creation", "blue");
  
  try {
    const invoiceTools = createInvoiceAgentTools(mockClient, companySlug);
    const toolCount = Object.keys(invoiceTools).length;
    logTest("Invoice Agent created", toolCount > 0, `${toolCount} tools`);
    passed++;
  } catch (e) {
    logTest("Invoice Agent created", false, String(e));
    failed++;
  }
  
  try {
    const purchaseTools = createPurchaseAgentTools(mockClient, companySlug);
    const toolCount = Object.keys(purchaseTools).length;
    logTest("Purchase Agent created", toolCount > 0, `${toolCount} tools`);
    passed++;
  } catch (e) {
    logTest("Purchase Agent created", false, String(e));
    failed++;
  }
  
  try {
    const contactTools = createContactAgentTools(mockClient, companySlug);
    const toolCount = Object.keys(contactTools).length;
    logTest("Contact Agent created", toolCount > 0, `${toolCount} tools`);
    passed++;
  } catch (e) {
    logTest("Contact Agent created", false, String(e));
    failed++;
  }
  
  try {
    const offerTools = createOfferAgentTools(mockClient, companySlug);
    const toolCount = Object.keys(offerTools).length;
    logTest("Offer Agent created", toolCount > 0, `${toolCount} tools`);
    passed++;
  } catch (e) {
    logTest("Offer Agent created", false, String(e));
    failed++;
  }
  
  try {
    const bankTools = createBankAgentTools(mockClient, companySlug);
    const toolCount = Object.keys(bankTools).length;
    logTest("Bank Agent created", toolCount > 0, `${toolCount} tools`);
    passed++;
  } catch (e) {
    logTest("Bank Agent created", false, String(e));
    failed++;
  }
  
  try {
    const accountingTools = createAccountingAgentTools(mockClient, companySlug);
    const toolCount = Object.keys(accountingTools).length;
    logTest("Accounting Agent created", toolCount > 0, `${toolCount} tools`);
    passed++;
  } catch (e) {
    logTest("Accounting Agent created", false, String(e));
    failed++;
  }
  
  // ============================================
  // Test 2: Full Agent System
  // ============================================
  log("\n2. Testing Full Agent System", "blue");
  
  try {
    const system = createFikenAgentSystem({ client: mockClient, companySlug });
    
    // Check orchestrator
    const hasOrchestrator = system.orchestrator && Object.keys(system.orchestrator.tools).length > 0;
    logTest("Orchestrator created", hasOrchestrator, `${Object.keys(system.orchestrator.tools).length} delegation tools`);
    passed++;
    
    // Check all agents exist
    const agentTypes: FikenAgentType[] = ['invoice_agent', 'purchase_agent', 'contact_agent', 'offer_agent', 'bank_agent', 'accounting_agent'];
    for (const agentType of agentTypes) {
      const hasAgent = system.agents[agentType] && Object.keys(system.agents[agentType].tools).length > 0;
      logTest(`Agent ${agentType} in system`, hasAgent);
      if (hasAgent) passed++; else failed++;
    }
  } catch (e) {
    logTest("Full Agent System", false, String(e));
    failed++;
  }
  
  // ============================================
  // Test 3: Tool Execution - Invoice Agent
  // ============================================
  log("\n3. Testing Invoice Agent Tools", "blue");
  
  try {
    const tools = createInvoiceAgentTools(mockClient, companySlug);
    
    // Test searchInvoices
    const searchResult = await (tools.searchInvoices as any).execute({});
    logTest("searchInvoices", searchResult.success === true, `Found ${searchResult.count} invoices`);
    if (searchResult.success) passed++; else failed++;
    
    // Test getInvoice
    const getResult = await (tools.getInvoice as any).execute({ invoiceId: 1 });
    logTest("getInvoice", getResult.success === true);
    if (getResult.success) passed++; else failed++;
    
    // Test getInvoiceCounter
    const counterResult = await (tools.getInvoiceCounter as any).execute({});
    logTest("getInvoiceCounter", counterResult.success === true, `Counter: ${counterResult.counter}`);
    if (counterResult.success) passed++; else failed++;
  } catch (e) {
    logTest("Invoice Agent Tools", false, String(e));
    failed++;
  }
  
  // ============================================
  // Test 4: Tool Execution - Offer Agent
  // ============================================
  log("\n4. Testing Offer Agent Tools", "blue");
  
  try {
    const tools = createOfferAgentTools(mockClient, companySlug);
    
    // Test searchOffers
    const searchResult = await (tools.searchOffers as any).execute({});
    logTest("searchOffers", searchResult.success === true, `Found ${searchResult.count} offers`);
    if (searchResult.success) passed++; else failed++;
    
    // Test getOfferCounter
    const counterResult = await (tools.getOfferCounter as any).execute({});
    logTest("getOfferCounter", counterResult.success === true, `Counter: ${counterResult.counter}`);
    if (counterResult.success) passed++; else failed++;
    
    // Test createOfferDraft
    const draftResult = await (tools.createOfferDraft as any).execute({
      customerId: 1,
      daysUntilDueDate: 14,
      lines: [{ description: "Konsulenttjenester", unitPrice: 150000, quantity: 10 }],
    });
    logTest("createOfferDraft", draftResult.success === true);
    if (draftResult.success) passed++; else failed++;
  } catch (e) {
    logTest("Offer Agent Tools", false, String(e));
    failed++;
  }
  
  // ============================================
  // Test 5: Tool Execution - Bank Agent
  // ============================================
  log("\n5. Testing Bank Agent Tools", "blue");
  
  try {
    const tools = createBankAgentTools(mockClient, companySlug);
    
    // Test getBankAccounts
    const accountsResult = await (tools.getBankAccounts as any).execute({});
    logTest("getBankAccounts", accountsResult.success === true, `Found ${accountsResult.count} accounts`);
    if (accountsResult.success) passed++; else failed++;
    
    // Test getBankBalances
    const balancesResult = await (tools.getBankBalances as any).execute({});
    logTest("getBankBalances", balancesResult.success === true, `Total: ${balancesResult.totalBalanceKr} kr`);
    if (balancesResult.success) passed++; else failed++;
    
    // Test searchInbox
    const inboxResult = await (tools.searchInbox as any).execute({ status: "unprocessed" });
    logTest("searchInbox", inboxResult.success === true);
    if (inboxResult.success) passed++; else failed++;
  } catch (e) {
    logTest("Bank Agent Tools", false, String(e));
    failed++;
  }
  
  // ============================================
  // Test 6: Tool Execution - Accounting Agent
  // ============================================
  log("\n6. Testing Accounting Agent Tools", "blue");
  
  try {
    const tools = createAccountingAgentTools(mockClient, companySlug);
    
    // Test getCompanyInfo
    const companyResult = await (tools.getCompanyInfo as any).execute({});
    logTest("getCompanyInfo", companyResult.success === true, companyResult.company?.name);
    if (companyResult.success) passed++; else failed++;
    
    // Test getAccounts
    const accountsResult = await (tools.getAccounts as any).execute({});
    logTest("getAccounts", accountsResult.success === true, `Found ${accountsResult.count} accounts`);
    if (accountsResult.success) passed++; else failed++;
    
    // Test searchProjects
    const projectsResult = await (tools.searchProjects as any).execute({});
    logTest("searchProjects", projectsResult.success === true, `Found ${projectsResult.count} projects`);
    if (projectsResult.success) passed++; else failed++;
    
    // Test checkAndInitializeCounters
    const countersResult = await (tools.checkAndInitializeCounters as any).execute({ startValue: 10000 });
    logTest("checkAndInitializeCounters", countersResult.success === true);
    if (countersResult.success) passed++; else failed++;
  } catch (e) {
    logTest("Accounting Agent Tools", false, String(e));
    failed++;
  }
  
  // ============================================
  // Test 7: Delegation Tools
  // ============================================
  log("\n7. Testing Delegation Tools", "blue");
  
  try {
    const delegationHandler = async (request: DelegationRequest) => {
      return {
        success: true,
        result: { delegatedTo: request.toAgent, task: request.task },
        fromAgent: request.toAgent,
      };
    };
    
    const invoiceTools = createInvoiceAgentTools(mockClient, companySlug, undefined, delegationHandler);
    
    // Invoice agent should NOT have delegateToInvoiceAgent (can't delegate to self)
    const hasSelfDelegation = 'delegateToInvoiceAgent' in invoiceTools;
    logTest("No self-delegation", !hasSelfDelegation, hasSelfDelegation ? "Has self-delegation (BAD)" : "Correctly excluded");
    if (!hasSelfDelegation) passed++; else failed++;
    
    // Invoice agent SHOULD have delegation to other agents
    const hasPurchaseDelegation = 'delegateToPurchaseAgent' in invoiceTools;
    logTest("Has cross-agent delegation", hasPurchaseDelegation);
    if (hasPurchaseDelegation) passed++; else failed++;
    
    // Test actual delegation
    if (hasPurchaseDelegation) {
      const delegateResult = await (invoiceTools.delegateToPurchaseAgent as any).execute({
        task: "Finn leverandør med navn 'Test'",
        context: { query: "Test" },
      });
      logTest("Delegation execution", delegateResult.success === true);
      if (delegateResult.success) passed++; else failed++;
    }
  } catch (e) {
    logTest("Delegation Tools", false, String(e));
    failed++;
  }
  
  // ============================================
  // Test 8: Prompts Exist
  // ============================================
  log("\n8. Testing Agent Prompts", "blue");
  
  const prompts = [
    { name: "INVOICE_AGENT_PROMPT", prompt: INVOICE_AGENT_PROMPT },
    { name: "PURCHASE_AGENT_PROMPT", prompt: PURCHASE_AGENT_PROMPT },
    { name: "CONTACT_AGENT_PROMPT", prompt: CONTACT_AGENT_PROMPT },
    { name: "OFFER_AGENT_PROMPT", prompt: OFFER_AGENT_PROMPT },
    { name: "BANK_AGENT_PROMPT", prompt: BANK_AGENT_PROMPT },
    { name: "ACCOUNTING_AGENT_PROMPT", prompt: ACCOUNTING_AGENT_PROMPT },
    { name: "ORCHESTRATOR_PROMPT", prompt: ORCHESTRATOR_PROMPT },
  ];
  
  for (const { name, prompt } of prompts) {
    const hasContent = !!(prompt && prompt.length > 100);
    logTest(name, hasContent, `${prompt?.length || 0} chars`);
    if (hasContent) passed++; else failed++;
  }
  
  // ============================================
  // Summary
  // ============================================
  log("\n========================================", "bold");
  log("  TEST SUMMARY", "bold");
  log("========================================", "bold");
  log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
  log(`  ${colors.red}Failed: ${failed}${colors.reset}`);
  log(`  Total:  ${passed + failed}`);
  log("========================================\n", "bold");
  
  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
testAgentTools().catch(console.error);
