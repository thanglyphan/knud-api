/**
 * Fiken Multi-Agent System
 * 
 * Exports all specialized agents and the orchestrator.
 */

// Individual agents
export { createInvoiceAgentTools, INVOICE_AGENT_PROMPT, type InvoiceAgentTools } from "./invoiceAgent.js";
export { createPurchaseAgentTools, PURCHASE_AGENT_PROMPT, type PurchaseAgentTools } from "./purchaseAgent.js";
export { createContactAgentTools, CONTACT_AGENT_PROMPT, type ContactAgentTools } from "./contactAgent.js";
export { createOfferAgentTools, OFFER_AGENT_PROMPT, type OfferAgentTools } from "./offerAgent.js";
export { createBankAgentTools, BANK_AGENT_PROMPT, type BankAgentTools } from "./bankAgent.js";
export { createAccountingAgentTools, ACCOUNTING_AGENT_PROMPT, type AccountingAgentTools } from "./accountingAgent.js";

// Orchestrator
export {
  createOrchestratorTools,
  createFikenAgentSystem,
  createAgentConfigs,
  getAgentTools,
  getAgentPrompt,
  ORCHESTRATOR_PROMPT,
  type OrchestratorConfig,
  type AgentConfig,
  type FikenAgentType,
  type DelegationHandler,
  type DelegationRequest,
  type DelegationResponse,
} from "./orchestrator.js";
