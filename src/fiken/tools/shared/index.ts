/**
 * Fiken Shared Modules Index
 * 
 * Eksporterer alle delte moduler for bruk i agenter.
 */

// Prompts
export {
  BASE_FIKEN_PROMPT,
  INVOICE_AGENT_PROMPT,
  PURCHASE_AGENT_PROMPT,
  CONTACT_AGENT_PROMPT,
  OFFER_AGENT_PROMPT,
  BANK_AGENT_PROMPT,
  ACCOUNTING_AGENT_PROMPT,
  ORCHESTRATOR_PROMPT,
} from "./prompts.js";

// Attachments
export {
  createAttachmentTools,
  createAttachmentFormData,
  getPendingFilesInfo,
  type PendingFile,
  type AttachmentTools,
  type AttachmentTarget,
} from "./attachments.js";

// Delegation
export {
  createDelegationTools,
  createDelegationToolsForAgent,
  AGENT_DESCRIPTIONS,
  type FikenAgentType,
  type DelegationRequest,
  type DelegationResponse,
  type DelegationHandler,
  type DelegationTools,
} from "./delegation.js";

// Helpers
export {
  success,
  error,
  withErrorHandling,
  kronerToOere,
  oereToKroner,
  formatAmount,
  parseDate,
  today,
  daysFromNow,
  truncate,
  summarize,
  SALES_VAT_TYPES,
  PURCHASE_VAT_TYPES,
  PURCHASE_KINDS,
  BANK_ACCOUNT_TYPES,
  ACCOUNT_RANGES,
  isValidSalesVatType,
  isValidPurchaseVatType,
  isAccountInRange,
  getAccountType,
  createAccountHelper,
  type SuccessResponse,
  type ErrorResponse,
  type ToolResponse,
  type SalesVatType,
  type PurchaseVatType,
  type PurchaseKind,
  type BankAccountType,
  type AccountHelper,
  type AccountSuggestion,
  type SuggestAccountsResult,
} from "./helpers.js";
