/**
 * Fiken API TypeScript Types
 * Complete type definitions based on Fiken API v2 OpenAPI specification
 * 
 * IMPORTANT NOTES:
 * - All amounts are in ØRE (100 øre = 1 NOK, so 50000 = 500 kr)
 * - Dates are strings in format YYYY-MM-DD
 * - Account codes are strings like "3000" or "1920:10001"
 */

// ============================================
// COMMON TYPES
// ============================================

export interface FikenResponse<T> {
  data: T;
}

export interface FikenListResponse<T> {
  data: T[];
}

/**
 * Address - if provided, 'country' is REQUIRED by Fiken API
 */
export interface Address {
  streetAddress?: string;
  streetAddressLine2?: string;
  city?: string;
  postCode?: string;
  country?: string; // REQUIRED if address object is provided (e.g., "Norway")
}

/**
 * Attachment returned from Fiken
 */
export interface Attachment {
  identifier?: string;
  downloadUrl?: string;
  downloadUrlWithFikenNormalUserCredentials?: string;
  comment?: string;
  type?: string;
}

/**
 * Payment record
 */
export interface Payment {
  paymentId?: number;
  date?: string;
  account?: string;
  amount?: number; // in øre
  amountInNok?: number;
  currency?: string;
  fee?: number;
}

/**
 * Payment request - all fields required
 */
export interface PaymentRequest {
  date: string; // REQUIRED - YYYY-MM-DD
  account: string; // REQUIRED - e.g., "1920"
  amount: number; // REQUIRED - in øre
  currency?: string;
}

/**
 * Counter for document numbers
 */
export interface Counter {
  value: number;
}

export interface CounterRequest {
  value?: number; // Optional - system generates if not provided
}

// ============================================
// USER & COMPANY
// ============================================

export interface FikenUser {
  name: string;
  email: string;
}

export interface Company {
  name: string;
  slug: string;
  organizationNumber?: string;
  vatType?: "NO" | "OUTSIDE" | "FOREIGN";
  address?: Address;
  phoneNumber?: string;
  email?: string;
  creationDate?: string;
  hasApiAccess?: boolean;
  testCompany?: boolean;
}

// ============================================
// CONTACTS (Customers & Suppliers)
// ============================================

export interface Contact {
  contactId?: number;
  name: string;
  email?: string;
  organizationNumber?: string;
  phoneNumber?: string;
  memberNumber?: number;
  memberNumberString?: string;
  customerNumber?: number;
  customerAccountCode?: string;
  supplierNumber?: number;
  supplierAccountCode?: string;
  customer?: boolean;
  supplier?: boolean;
  contactPerson?: ContactPerson[];
  currency?: string;
  language?: string;
  inactive?: boolean;
  daysUntilInvoicingDueDate?: number;
  address?: Address;
  groups?: string[];
  notes?: string;
  createdDate?: string;
  lastModified?: string;
}

/**
 * Contact request for create/update
 * Only 'name' is required. If address is provided, address.country is required.
 */
export interface ContactRequest {
  name: string; // REQUIRED
  email?: string;
  organizationNumber?: string;
  phoneNumber?: string;
  memberNumber?: number;
  customer?: boolean;
  supplier?: boolean;
  currency?: string;
  language?: string;
  inactive?: boolean;
  daysUntilInvoicingDueDate?: number;
  address?: Address; // If provided, country is required
  groups?: string[];
  notes?: string;
}

export interface ContactPerson {
  contactPersonId?: number;
  name: string;
  email?: string;
  phoneNumber?: string;
  address?: Address;
}

/**
 * Contact person request - name and email are required
 */
export interface ContactPersonRequest {
  name: string; // REQUIRED
  email: string; // REQUIRED
  phoneNumber?: string;
  address?: Address;
}

// ============================================
// GROUPS
// ============================================

// Groups are returned as string[] from the API

// ============================================
// PRODUCTS
// ============================================

export interface Product {
  productId?: number;
  name: string;
  unitPrice?: number; // in øre
  incomeAccount?: string;
  vatType?: string;
  active?: boolean;
  productNumber?: string;
  stock?: number;
  note?: string;
  createdDate?: string;
  lastModified?: string;
}

/**
 * Product request - name, incomeAccount, vatType, active are REQUIRED
 */
export interface ProductRequest {
  name: string; // REQUIRED
  incomeAccount: string; // REQUIRED - e.g., "3000"
  vatType: string; // REQUIRED - HIGH, MEDIUM, LOW, NONE, etc.
  active: boolean; // REQUIRED
  unitPrice?: number; // in øre
  productNumber?: string;
  stock?: number;
  note?: string;
}

/**
 * Product sales report request
 */
export interface ProductSalesReportRequest {
  from: string; // REQUIRED - YYYY-MM-DD
  to: string; // REQUIRED - YYYY-MM-DD
}

// ============================================
// INVOICES
// ============================================

export interface InvoiceLine {
  invoiceLineId?: number;
  netAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
  netAmountInNok?: number;
  vatAmountInNok?: number;
  grossAmountInNok?: number;
  description?: string;
  productId?: number;
  productName?: string;
  quantity?: number;
  unitPrice?: number; // in øre
  discount?: number;
  vatType?: string;
  incomeAccount?: string;
  comment?: string;
  projectId?: number;
}

/**
 * Invoice line request - quantity is required
 */
export interface InvoiceLineRequest {
  quantity: number; // REQUIRED
  productId?: number;
  unitPrice?: number; // in øre
  discount?: number;
  description?: string;
  comment?: string;
  incomeAccount?: string;
  vatType?: string;
  projectId?: number;
}

export interface Invoice {
  invoiceId?: number;
  invoiceNumber?: number;
  uuid?: string;
  issueDate?: string;
  dueDate?: string;
  invoiceText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  customer?: Contact;
  customerId?: number;
  net?: number;
  vat?: number;
  gross?: number;
  netInNok?: number;
  vatInNok?: number;
  grossInNok?: number;
  cash?: boolean;
  currency?: string;
  invoiceDraftUuid?: string;
  paid?: boolean;
  settled?: boolean;
  sentManually?: boolean;
  attachments?: Attachment[];
  lines?: InvoiceLine[];
  kid?: string;
  bankAccountNumber?: string;
  bankAccountCode?: string;
  createdDate?: string;
  lastModified?: string;
  payments?: Payment[];
  projectId?: number;
}

/**
 * Invoice request - REQUIRED: issueDate, dueDate, lines, bankAccountCode, cash, customerId
 */
export interface InvoiceRequest {
  issueDate: string; // REQUIRED - YYYY-MM-DD
  dueDate: string; // REQUIRED - YYYY-MM-DD
  lines: InvoiceLineRequest[]; // REQUIRED
  bankAccountCode: string; // REQUIRED - e.g., "1920:10001" or "1920"
  cash: boolean; // REQUIRED - true for cash sale, false for invoice
  customerId: number; // REQUIRED
  invoiceText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  currency?: string;
  paymentAccount?: string;
  projectId?: number;
}

/**
 * Invoice update request (PATCH)
 */
export interface InvoiceUpdateRequest {
  dueDate?: string;
  sentManually?: boolean;
}

/**
 * Send invoice request
 */
export interface SendInvoiceRequest {
  invoiceId: number; // REQUIRED
  method: ("email" | "ehf" | "efaktura" | "sms")[]; // REQUIRED
  includeDocumentAttachments: boolean; // REQUIRED
  emailAddress?: string;
  message?: string;
}

// ============================================
// INVOICE DRAFTS
// ============================================

export interface InvoiceDraft {
  draftId?: number;  // Integer ID - use this for all API operations
  uuid?: string;     // UUID - for reference only, do NOT use for API calls
  type?: "invoice" | "cash_invoice" | "offer" | "order_confirmation" | "credit_note";
  daysUntilDueDate?: number;
  issueDate?: string;
  invoiceText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  customerId?: number;
  customer?: Contact;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  createdFromInvoiceId?: number;
  cash?: boolean;
  attachments?: Attachment[];
  net?: number;
  vat?: number;
  gross?: number;
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

/**
 * Invoice draft request - customerId, daysUntilDueDate, type are REQUIRED
 */
export interface InvoiceDraftRequest {
  customerId: number; // REQUIRED
  daysUntilDueDate: number; // REQUIRED
  type: "invoice" | "cash_invoice"; // REQUIRED
  issueDate?: string;
  invoiceText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  bankAccountNumber?: string; // Actual bank account number (e.g. "12345678903") - needed for creating invoice from draft
  cash?: boolean;
  projectId?: number;
}

// ============================================
// CREDIT NOTES
// ============================================

export interface CreditNote {
  creditNoteId?: number;
  creditNoteNumber?: number;
  uuid?: string;
  issueDate?: string;
  net?: number;
  vat?: number;
  gross?: number;
  netInNok?: number;
  vatInNok?: number;
  grossInNok?: number;
  currency?: string;
  customerId?: number;
  customer?: Contact;
  creditNoteText?: string;
  settled?: boolean;
  associatedInvoiceId?: number;
  lines?: InvoiceLine[];
  attachments?: Attachment[];
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

/**
 * Full credit note request - credits entire invoice
 */
export interface FullCreditNoteRequest {
  issueDate: string; // REQUIRED - YYYY-MM-DD
  invoiceId: number; // REQUIRED - the invoice to credit
  creditNoteText?: string;
}

/**
 * Partial credit note request - credits specific lines
 */
export interface PartialCreditNoteRequest {
  issueDate: string; // REQUIRED - YYYY-MM-DD
  lines: CreditNoteLineRequest[]; // REQUIRED
  creditNoteText?: string;
  invoiceId?: number;
  customerId?: number;
  ourReference?: string;
  yourReference?: string;
  orderReference?: string;
  projectId?: number;
}

export interface CreditNoteLineRequest {
  quantity: number; // REQUIRED
  unitPrice: number; // REQUIRED - in øre
  description?: string;
  vatType?: string;
  incomeAccount?: string;
  productId?: number;
  projectId?: number;
}

/**
 * Send credit note request
 */
export interface SendCreditNoteRequest {
  creditNoteId: number; // REQUIRED
  method: ("email" | "ehf" | "efaktura")[]; // REQUIRED
  includeDocumentAttachments: boolean; // REQUIRED
  emailAddress?: string;
  message?: string;
}

// ============================================
// CREDIT NOTE DRAFTS
// ============================================

export interface CreditNoteDraft {
  draftId?: number;  // Integer ID - use this for all API operations
  uuid?: string;     // UUID - for reference only, do NOT use for API calls
  type?: "credit_note";
  daysUntilDueDate?: number;
  issueDate?: string;
  creditNoteText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  customerId?: number;
  customer?: Contact;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  cash?: boolean;
  attachments?: Attachment[];
  net?: number;
  vat?: number;
  gross?: number;
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface CreditNoteDraftRequest {
  customerId: number; // REQUIRED
  daysUntilDueDate: number; // REQUIRED
  type: "credit_note"; // REQUIRED
  issueDate?: string;
  creditNoteText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  cash?: boolean;
  projectId?: number;
}

// ============================================
// OFFERS (Tilbud)
// ============================================

export interface Offer {
  offerId?: number;
  offerNumber?: number;
  uuid?: string;
  issueDate?: string;
  net?: number;
  vat?: number;
  gross?: number;
  netInNok?: number;
  vatInNok?: number;
  grossInNok?: number;
  currency?: string;
  customerId?: number;
  customer?: Contact;
  offerText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  lines?: InvoiceLine[];
  attachments?: Attachment[];
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface OfferDraft {
  draftId?: number;  // Integer ID - use this for all API operations
  uuid?: string;     // UUID - for reference only, do NOT use for API calls
  type?: "offer";
  daysUntilDueDate?: number;
  issueDate?: string;
  offerText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  customerId?: number;
  customer?: Contact;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  attachments?: Attachment[];
  net?: number;
  vat?: number;
  gross?: number;
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface OfferDraftRequest {
  customerId: number; // REQUIRED
  daysUntilDueDate: number; // REQUIRED
  type: "offer"; // REQUIRED
  issueDate?: string;
  offerText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  projectId?: number;
}

// ============================================
// ORDER CONFIRMATIONS (Ordrebekreftelser)
// ============================================

export interface OrderConfirmation {
  confirmationId?: number;
  confirmationNumber?: number;
  uuid?: string;
  issueDate?: string;
  net?: number;
  vat?: number;
  gross?: number;
  netInNok?: number;
  vatInNok?: number;
  grossInNok?: number;
  currency?: string;
  customerId?: number;
  customer?: Contact;
  orderConfirmationText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  lines?: InvoiceLine[];
  attachments?: Attachment[];
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface OrderConfirmationDraft {
  draftId?: number;  // Integer ID - use this for all API operations
  uuid?: string;     // UUID - for reference only, do NOT use for API calls
  type?: "order_confirmation";
  daysUntilDueDate?: number;
  issueDate?: string;
  orderConfirmationText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  customerId?: number;
  customer?: Contact;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  attachments?: Attachment[];
  net?: number;
  vat?: number;
  gross?: number;
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface OrderConfirmationDraftRequest {
  customerId: number; // REQUIRED
  daysUntilDueDate: number; // REQUIRED
  type: "order_confirmation"; // REQUIRED
  issueDate?: string;
  orderConfirmationText?: string;
  yourReference?: string;
  ourReference?: string;
  orderReference?: string;
  currency?: string;
  lines?: InvoiceLineRequest[];
  bankAccountCode?: string;
  projectId?: number;
}

// ============================================
// PURCHASES (Leverandørfakturaer / Kjøp)
// ============================================

export interface PurchaseLine {
  description?: string;
  netPrice?: number; // in øre
  vat?: number;
  grossPrice?: number;
  netPriceInNok?: number;
  vatInNok?: number;
  grossPriceInNok?: number;
  vatType?: string;
  account?: string;
  projectId?: number;
}

/**
 * Purchase line request - REQUIRED: vatType, description
 */
export interface PurchaseLineRequest {
  description: string; // REQUIRED
  vatType: string; // REQUIRED - HIGH, MEDIUM, LOW, NONE, HIGH_DIRECT, etc.
  netPrice?: number; // in øre
  vat?: number;
  account?: string; // e.g., "4000", "6300"
  projectId?: number;
}

export interface Purchase {
  purchaseId?: number;
  transactionId?: number;
  identifier?: string;
  date?: string;
  dueDate?: string;
  supplier?: Contact;
  supplierId?: number;
  currency?: string;
  kid?: string;
  paid?: boolean;
  paymentDate?: string;
  paymentAccount?: string;
  lines?: PurchaseLine[];
  attachments?: Attachment[];
  payments?: Payment[];
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

/**
 * Purchase request
 * REQUIRED: date, kind, paid, lines, currency
 * For kind="supplier": supplierId and dueDate are required
 * For kind="cash_purchase": paymentAccount is required
 */
export interface PurchaseRequest {
  date: string; // REQUIRED - YYYY-MM-DD
  kind: "cash_purchase" | "supplier"; // REQUIRED - NOT "supplier_invoice"!
  paid: boolean; // REQUIRED
  lines: PurchaseLineRequest[]; // REQUIRED
  currency: string; // REQUIRED - e.g., "NOK"
  supplierId?: number; // Required for kind="supplier"
  dueDate?: string; // Required for kind="supplier"
  paymentAccount?: string; // Required for kind="cash_purchase" (e.g., "1920")
  paymentDate?: string;
  kid?: string;
  projectId?: number;
}

// ============================================
// PURCHASE DRAFTS
// ============================================

export interface PurchaseDraft {
  draftId?: number;  // Integer ID - use this for all API operations
  uuid?: string;     // UUID - for reference only, do NOT use for API calls
  cash?: boolean;
  date?: string;
  dueDate?: string;
  supplierId?: number;
  supplier?: Contact;
  lines?: PurchaseDraftLineRequest[];
  currency?: string;
  kid?: string;
  paid?: boolean;
  attachments?: Attachment[];
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface PurchaseDraftLineRequest {
  text: string; // REQUIRED
  vatType: string; // REQUIRED
  incomeAccount: string; // REQUIRED - Fiken uses incomeAccount for draft lines (not "account")
  account?: string; // For compatibility
  net: number; // REQUIRED - in øre
  gross: number; // REQUIRED - in øre
}

export interface PurchaseDraftRequest {
  cash: boolean; // REQUIRED
  lines: PurchaseDraftLineRequest[]; // REQUIRED
  paid: boolean; // REQUIRED
  supplierId?: number;
  date?: string;
  dueDate?: string;
  currency?: string;
  kid?: string;
  projectId?: number;
}

// ============================================
// SALES (Annet salg - different from invoices)
// ============================================

export interface Sale {
  saleId?: number;
  transactionId?: number;
  saleNumber?: string;
  date?: string;
  contactId?: number;
  contact?: Contact;
  currency?: string;
  dueDate?: string;
  kid?: string;
  kind?: "cash_sale" | "invoice" | "external_invoice";
  paid?: boolean;
  paymentDate?: string;
  paymentAccount?: string;
  totalPaid?: number;
  totalPaidInNok?: number;
  netAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
  netAmountInNok?: number;
  vatAmountInNok?: number;
  grossAmountInNok?: number;
  outstandingBalance?: number;
  settled?: boolean;
  writeOff?: boolean;
  lines?: SaleLine[];
  attachments?: Attachment[];
  payments?: Payment[];
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface SaleLine {
  description?: string;
  netAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
  netAmountInNok?: number;
  vatAmountInNok?: number;
  grossAmountInNok?: number;
  vatType?: string;
  incomeAccount?: string;
  projectId?: number;
}

/**
 * Sale line request - REQUIRED: vatType, description
 */
export interface SaleLineRequest {
  description: string; // REQUIRED
  vatType: string; // REQUIRED - HIGH, MEDIUM, LOW, NONE, EXEMPT, etc.
  netPrice?: number; // in øre (Fiken API requires netPrice, NOT netAmount)
  vat?: number; // in øre — REQUIRED when vatType is HIGH/MEDIUM/LOW (Fiken won't calculate it)
  grossAmount?: number; // in øre
  incomeAccount?: string; // e.g., "3000"
  projectId?: number;
}

/**
 * Sale request
 * REQUIRED: date, kind, paid, lines, currency
 */
export interface SaleRequest {
  date: string; // REQUIRED - YYYY-MM-DD
  kind: "cash_sale" | "invoice" | "external_invoice"; // REQUIRED
  paid: boolean; // REQUIRED
  lines: SaleLineRequest[]; // REQUIRED
  currency: string; // REQUIRED - e.g., "NOK"
  totalPaid?: number; // in øre - REQUIRED when paid=true for NOK
  contactId?: number;
  dueDate?: string;
  paymentAccount?: string;
  paymentDate?: string;
  kid?: string;
  projectId?: number;
}

// ============================================
// SALE DRAFTS
// ============================================

export interface SaleDraft {
  draftId?: number;  // Integer ID - use this for all API operations
  uuid?: string;     // UUID - for reference only, do NOT use for API calls
  date?: string;
  contactId?: number;
  contact?: Contact;
  lines?: SaleDraftLineRequest[];
  currency?: string;
  cash?: boolean;
  paid?: boolean;
  attachments?: Attachment[];
  createdDate?: string;
  lastModified?: string;
  projectId?: number;
}

export interface SaleDraftLineRequest {
  text: string; // REQUIRED
  vatType: string; // REQUIRED
  incomeAccount: string; // REQUIRED
  net: number; // REQUIRED - in øre
  gross: number; // REQUIRED - in øre
}

export interface SaleDraftRequest {
  cash: boolean; // REQUIRED
  lines: SaleDraftLineRequest[]; // REQUIRED
  paid: boolean; // REQUIRED
  contactId?: number;
  date?: string;
  currency?: string;
  projectId?: number;
}

// ============================================
// ACCOUNTS & BALANCES
// ============================================

export interface Account {
  code: string;
  name: string;
}

export interface AccountBalance {
  code: string;
  name: string;
  balance: number; // in øre
  balanceInNok?: number;
}

// ============================================
// FINANCIAL SUMMARY
// ============================================

export interface FinancialSummary {
  period: {
    from: string;  // "2025-01-01"
    to: string;    // "2025-01-30"
  };
  income: number;   // i øre (positive tall)
  expenses: number; // i øre (positive tall)
  result: number;   // income - expenses (kan være negativ)
}

// ============================================
// BANK ACCOUNTS
// ============================================

export interface BankAccount {
  bankAccountId?: number;
  name: string;
  accountCode: string;
  bankAccountNumber?: string;
  iban?: string;
  bic?: string;
  foreignService?: string;
  type: "NORMAL" | "TAX_DEDUCTION" | "FOREIGN" | "CREDIT_CARD";
  reconciledBalance?: number; // in øre — last reconciled balance from Fiken API
  reconciledDate?: string; // YYYY-MM-DD — last reconciliation date
  inactive?: boolean;
}

/**
 * Bank account request - REQUIRED: name, bankAccountNumber, type
 */
export interface BankAccountRequest {
  name: string; // REQUIRED
  bankAccountNumber: string; // REQUIRED
  type: "NORMAL" | "TAX_DEDUCTION" | "FOREIGN" | "CREDIT_CARD"; // REQUIRED
  iban?: string;
  bic?: string;
  foreignService?: string; // Only for type FOREIGN
}

export interface BankBalance {
  bankAccountId: number;
  bankAccountCode: string;
  balance: number; // in øre
  balanceInNok?: number;
}

// ============================================
// JOURNAL ENTRIES (Bilag / Posteringer)
// ============================================

export interface JournalEntryLine {
  amount: number; // in øre
  account?: string;
  vatCode?: string;
  debitAccount?: string;
  debitVatCode?: number;
  creditAccount?: string;
  creditVatCode?: number;
  projectId?: number;
}

export interface JournalEntry {
  journalEntryId?: number;
  transactionId?: number;
  date?: string;
  description?: string;
  lines?: JournalEntryLine[];
  attachments?: Attachment[];
  createdDate?: string;
  lastModified?: string;
}

/**
 * Single journal entry in a general journal entry request
 */
export interface GeneralJournalEntryLineRequest {
  amount: number; // REQUIRED - in øre (positive = debit, negative = credit for balance)
  account?: string;
  vatCode?: string;
  debitAccount?: string;
  debitVatCode?: number;
  creditAccount?: string;
  creditVatCode?: number;
  projectId?: number;
}

export interface GeneralJournalEntryItem {
  description: string; // REQUIRED
  date: string; // REQUIRED - YYYY-MM-DD
  lines: GeneralJournalEntryLineRequest[]; // REQUIRED - must balance (sum to 0)
}

/**
 * General journal entry request (fri postering)
 * POST to /companies/{slug}/generalJournalEntries
 */
export interface GeneralJournalEntryRequest {
  journalEntries: GeneralJournalEntryItem[]; // REQUIRED
}

// Legacy single entry request (for backward compatibility)
export interface JournalEntryRequest {
  date: string;
  description: string;
  lines: JournalEntryLine[];
}

// ============================================
// PROJECTS
// ============================================

export interface Project {
  projectId?: number;
  name: string;
  number?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  contact?: Contact;
  contactId?: number;
  completed?: boolean;
  createdDate?: string;
  lastModified?: string;
}

/**
 * Project request - REQUIRED: startDate, number, name
 */
export interface ProjectRequest {
  name: string; // REQUIRED
  number: string; // REQUIRED
  startDate: string; // REQUIRED - YYYY-MM-DD
  description?: string;
  endDate?: string;
  contactId?: number;
  completed?: boolean;
}

/**
 * Project update request (PATCH) - all optional
 */
export interface ProjectUpdateRequest {
  name?: string;
  number?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  contactId?: number;
  completed?: boolean;
}

// ============================================
// TRANSACTIONS
// ============================================

export interface TransactionEntry {
  account?: string;
  amount?: number; // in øre
  amountInNok?: number;
  vatCode?: string;
  projectId?: number;
}

export interface Transaction {
  transactionId?: number;
  date?: string;
  description?: string;
  type?: string;
  entries?: TransactionEntry[];
  createdDate?: string;
  lastModified?: string;
}

// ============================================
// INBOX (Documents waiting to be processed)
// ============================================

export interface InboxDocument {
  documentId?: number;
  name?: string;
  description?: string;
  filename?: string;
  status?: "unprocessed" | "processing" | "processed" | "failed";
  createdDate?: string;
}

// Inbox document is created via multipart/form-data

// ============================================
// API QUERY PARAMETERS
// ============================================

export interface PaginationParams {
  page?: number;
  pageSize?: number; // max 100
}

export interface ContactQueryParams extends PaginationParams {
  supplierNumber?: number;
  customerNumber?: number;
  memberNumber?: number;
  memberNumberString?: string;
  name?: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  customer?: boolean;
  supplier?: boolean;
  inactive?: boolean;
  group?: string;
  lastModified?: string;
  lastModifiedLe?: string;
  lastModifiedLt?: string;
  lastModifiedGe?: string;
  lastModifiedGt?: string;
  createdDate?: string;
  createdDateLe?: string;
  createdDateLt?: string;
  createdDateGe?: string;
  createdDateGt?: string;
  sortBy?: "lastModified asc" | "lastModified desc" | "createdDate asc" | "createdDate desc";
}

export interface InvoiceQueryParams extends PaginationParams {
  issueDate?: string;
  issueDateLe?: string;
  issueDateLt?: string;
  issueDateGe?: string;
  issueDateGt?: string;
  lastModified?: string;
  lastModifiedLe?: string;
  lastModifiedLt?: string;
  lastModifiedGe?: string;
  lastModifiedGt?: string;
  dueDate?: string;
  dueDateLe?: string;
  dueDateLt?: string;
  dueDateGe?: string;
  dueDateGt?: string;
  settled?: boolean;
  customerId?: number;
  orderReference?: string;
  invoiceDraftUuid?: string;
}

export interface CreditNoteQueryParams extends PaginationParams {
  issueDate?: string;
  issueDateLe?: string;
  issueDateLt?: string;
  issueDateGe?: string;
  issueDateGt?: string;
  lastModified?: string;
  lastModifiedLe?: string;
  lastModifiedLt?: string;
  lastModifiedGe?: string;
  lastModifiedGt?: string;
  settled?: boolean;
  customerId?: number;
}

export interface PurchaseQueryParams extends PaginationParams {
  date?: string;
  dateLe?: string;
  dateLt?: string;
  dateGe?: string;
  dateGt?: string;
  sortBy?: "createdDate asc" | "createdDate desc";
}

export interface SaleQueryParams extends PaginationParams {
  saleNumber?: string;
  lastModified?: string;
  lastModifiedLe?: string;
  lastModifiedLt?: string;
  lastModifiedGe?: string;
  lastModifiedGt?: string;
  date?: string;
  dateLe?: string;
  dateLt?: string;
  dateGe?: string;
  dateGt?: string;
  contactId?: number;
  settled?: boolean;
}

export interface ProductQueryParams extends PaginationParams {
  name?: string;
  productNumber?: string;
  active?: boolean;
  createdDate?: string;
  createdDateLe?: string;
  createdDateLt?: string;
  createdDateGe?: string;
  createdDateGt?: string;
  lastModified?: string;
  lastModifiedLe?: string;
  lastModifiedLt?: string;
  lastModifiedGe?: string;
  lastModifiedGt?: string;
}

export interface AccountQueryParams extends PaginationParams {
  fromAccount?: string;
  toAccount?: string;
  range?: string; // Comma-separated list like "1000-1500, 2000"
}

export interface AccountBalanceQueryParams extends PaginationParams {
  date: string; // REQUIRED - YYYY-MM-DD
  fromAccount?: string;
  toAccount?: string;
}

export interface BankAccountQueryParams extends PaginationParams {
  inactive?: boolean;
}

export interface BankBalanceQueryParams extends PaginationParams {
  date?: string;
}

export interface JournalEntryQueryParams extends PaginationParams {
  date?: string;
  dateLe?: string;
  dateLt?: string;
  dateGe?: string;
  dateGt?: string;
}

export interface TransactionQueryParams extends PaginationParams {
  createdDate?: string;
  createdDateLe?: string;
  createdDateLt?: string;
  createdDateGe?: string;
  createdDateGt?: string;
  lastModified?: string;
  lastModifiedLe?: string;
  lastModifiedLt?: string;
  lastModifiedGe?: string;
  lastModifiedGt?: string;
}

export interface ProjectQueryParams extends PaginationParams {
  completed?: boolean;
}

export interface InboxQueryParams extends PaginationParams {
  status?: "unprocessed" | "processing" | "processed" | "failed";
  name?: string;
  sortBy?: "createdDate asc" | "createdDate desc" | "name asc" | "name desc";
}

export interface OfferQueryParams extends PaginationParams {
  // Offers endpoint doesn't have filtering in the API
}

export interface OrderConfirmationQueryParams extends PaginationParams {
  // Order confirmations endpoint doesn't have filtering in the API
}
