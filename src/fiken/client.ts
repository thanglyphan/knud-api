/**
 * Fiken API Client
 * Complete client for Fiken API v2 with all endpoints
 * 
 * Based on Fiken OpenAPI specification
 * https://api.fiken.no/api/v2/docs/swagger.yaml
 */

import type {
  // User & Company
  FikenUser,
  Company,
  // Contacts
  Contact,
  ContactRequest,
  ContactQueryParams,
  ContactPerson,
  ContactPersonRequest,
  // Products
  Product,
  ProductRequest,
  ProductQueryParams,
  // Invoices
  Invoice,
  InvoiceRequest,
  InvoiceUpdateRequest,
  InvoiceQueryParams,
  InvoiceDraft,
  InvoiceDraftRequest,
  SendInvoiceRequest,
  // Credit Notes
  CreditNote,
  CreditNoteQueryParams,
  CreditNoteDraft,
  CreditNoteDraftRequest,
  FullCreditNoteRequest,
  PartialCreditNoteRequest,
  SendCreditNoteRequest,
  // Offers
  Offer,
  OfferQueryParams,
  OfferDraft,
  OfferDraftRequest,
  // Order Confirmations
  OrderConfirmation,
  OrderConfirmationQueryParams,
  OrderConfirmationDraft,
  OrderConfirmationDraftRequest,
  // Purchases
  Purchase,
  PurchaseRequest,
  PurchaseQueryParams,
  PurchaseDraft,
  PurchaseDraftRequest,
  // Sales
  Sale,
  SaleRequest,
  SaleQueryParams,
  SaleDraft,
  SaleDraftRequest,
  // Accounts & Balances
  Account,
  AccountQueryParams,
  AccountBalance,
  AccountBalanceQueryParams,
  FinancialSummary,
  // Bank
  BankAccount,
  BankAccountRequest,
  BankAccountQueryParams,
  BankBalance,
  BankBalanceQueryParams,
  // Journal Entries
  JournalEntry,
  JournalEntryQueryParams,
  GeneralJournalEntryRequest,
  // Projects
  Project,
  ProjectRequest,
  ProjectUpdateRequest,
  ProjectQueryParams,
  // Transactions
  Transaction,
  TransactionQueryParams,
  // Inbox
  InboxDocument,
  InboxQueryParams,
  // Payments
  Payment,
  PaymentRequest,
  // Attachments
  Attachment,
  // Counter
  Counter,
  CounterRequest,
} from "./types.js";

const FIKEN_API_BASE = "https://api.fiken.no/api/v2";

// ============================================
// CORE REQUEST HANDLER
// ============================================

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

interface FikenApiError {
  status: number;
  message?: string;
  error?: string;
  error_description?: string;
  errors?: Array<{ field: string; message: string }>;
}

/**
 * Strip HTML tags from error messages returned by Fiken API
 * Fiken sometimes returns HTML-formatted errors like:
 * "Ugyldig dato: '2026-02-29'<br><br><small>Feilreferanse: abc123</small>"
 */
function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')           // Replace <br> with space
    .replace(/<[^>]*>/g, '')                 // Remove all HTML tags
    .replace(/\s+/g, ' ')                    // Collapse multiple spaces
    .trim();
}

/**
 * Create a Fiken API client for a specific user's access token
 */
export function createFikenClient(accessToken: string, companySlug: string) {
  
  /**
   * Make a JSON request to the Fiken API
   */
  async function fikenRequest<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { method = "GET", params, body } = options;

    // Build URL with query params
    const url = new URL(`${FIKEN_API_BASE}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    // Handle rate limiting
    if (response.status === 429) {
      throw new Error("Fiken API rate limit nådd. Vennligst vent litt før du prøver igjen.");
    }

    if (!response.ok) {
      let errorData: FikenApiError | FikenApiError[];
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          message: response.statusText,
        };
      }

      console.error("Fiken API error:", JSON.stringify(errorData, null, 2));

      // Build detailed error message in Norwegian (strip HTML from Fiken responses)
      let errorMessage = "";
      
      // Handle array of errors (Fiken sometimes returns an array directly)
      if (Array.isArray(errorData)) {
        errorMessage = errorData.map((e) => stripHtml(e.message || JSON.stringify(e))).join("; ");
      } else {
        // Try different error formats for object responses
        if (errorData.error_description) {
          errorMessage = stripHtml(errorData.error_description);
        } else if (errorData.message) {
          errorMessage = stripHtml(errorData.message);
        } else if (errorData.error) {
          errorMessage = stripHtml(errorData.error);
        } else {
          errorMessage = "Ukjent feil fra Fiken API";
        }
        
        // Include field-level errors if present
        if (errorData.errors && errorData.errors.length > 0) {
          const details = errorData.errors.map((e) => `'${e.field}': ${stripHtml(e.message)}`).join("; ");
          errorMessage += `. Feltfeil: ${details}`;
        }
      }

      // Throw with full context so AI can understand and help the user
      throw new Error(`Fiken API feil (${response.status}): ${errorMessage}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Handle 201 Created - fetch the created resource from Location header
    if (response.status === 201) {
      const location = response.headers.get("Location");
      const text = await response.text();
      
      // If we got a body with content, try to parse it
      if (text && text.trim()) {
        try {
          const parsed = JSON.parse(text);
          // If parsed object has meaningful data (not just empty), return it
          if (Object.keys(parsed).length > 0) {
            return parsed;
          }
        } catch {
          // JSON parse failed, continue to fetch from location
        }
      }
      
      // Fetch the created resource from Location header
      if (location) {
        // Build full URL - location can be relative or absolute
        const resourceUrl = location.startsWith("http") 
          ? location 
          : `${FIKEN_API_BASE}${location}`;
        
        try {
          const getResponse = await fetch(resourceUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          });
          
          if (getResponse.ok) {
            const resource = await getResponse.json();
            return resource;
          }
        } catch {
          // Error fetching created resource, will return location below
        }
      }
      
      // Fallback: return what we have with a flag indicating creation succeeded
      return { location, _created: true } as T;
    }

    // Handle empty response bodies (common for PUT/PATCH that return 200 with no body)
    const responseText = await response.text();
    if (!responseText || !responseText.trim()) {
      return {} as T;
    }

    try {
      return JSON.parse(responseText);
    } catch {
      // If JSON parsing fails on a successful response, return empty object
      return {} as T;
    }
  }

  /**
   * Make a multipart/form-data request to the Fiken API (for file uploads)
   */
  async function fikenMultipartRequest<T>(
    endpoint: string,
    formData: FormData
  ): Promise<T> {
    const url = new URL(`${FIKEN_API_BASE}${endpoint}`);
    
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Don't set Content-Type - fetch sets it automatically with boundary for FormData
      },
      body: formData,
    });

    if (response.status === 429) {
      throw new Error("Fiken API rate limit nådd. Vennligst vent litt før du prøver igjen.");
    }

    if (!response.ok) {
      let errorData: FikenApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          status: response.status,
          message: response.statusText,
        };
      }

      console.error("Fiken API multipart error:", JSON.stringify(errorData, null, 2));

      let errorMessage = stripHtml(errorData.error_description || errorData.message || "Ukjent feil ved filopplasting");
      if (errorData.errors && errorData.errors.length > 0) {
        const details = errorData.errors.map((e) => `'${e.field}': ${stripHtml(e.message)}`).join("; ");
        errorMessage += `. Feltfeil: ${details}`;
      }

      throw new Error(`Fiken API feil (${response.status}): ${errorMessage}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    if (response.status === 201) {
      const location = response.headers.get("Location");
      const text = await response.text();
      if (text) {
        try {
          return JSON.parse(text);
        } catch {
          return { location } as T;
        }
      }
      return { location } as T;
    }

    return response.json();
  }

  // Helper to build company endpoint
  const companyEndpoint = (path: string) => `/companies/${companySlug}${path}`;

  // ============================================
  // USER
  // ============================================

  async function getUser(): Promise<FikenUser> {
    return fikenRequest<FikenUser>("/user");
  }

  // ============================================
  // COMPANY
  // ============================================

  async function getCompany(): Promise<Company> {
    return fikenRequest<Company>(`/companies/${companySlug}`);
  }

  async function getCompanies(): Promise<Company[]> {
    return fikenRequest<Company[]>("/companies");
  }

  // ============================================
  // CONTACTS
  // ============================================

  async function getContacts(params?: ContactQueryParams): Promise<Contact[]> {
    return fikenRequest<Contact[]>(companyEndpoint("/contacts"), { params: params as any });
  }

  async function getContact(contactId: number): Promise<Contact> {
    return fikenRequest<Contact>(companyEndpoint(`/contacts/${contactId}`));
  }

  async function createContact(contact: ContactRequest): Promise<Contact> {
    return fikenRequest<Contact>(companyEndpoint("/contacts"), {
      method: "POST",
      body: contact,
    });
  }

  async function updateContact(contactId: number, contact: ContactRequest): Promise<Contact> {
    return fikenRequest<Contact>(companyEndpoint(`/contacts/${contactId}`), {
      method: "PUT",
      body: contact,
    });
  }

  async function deleteContact(contactId: number): Promise<Contact | void> {
    return fikenRequest<Contact | void>(companyEndpoint(`/contacts/${contactId}`), {
      method: "DELETE",
    });
  }

  // Contact Attachments
  async function addAttachmentToContact(contactId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/contacts/${contactId}/attachments`), formData);
  }

  // Contact Persons
  async function getContactPersons(contactId: number): Promise<ContactPerson[]> {
    return fikenRequest<ContactPerson[]>(companyEndpoint(`/contacts/${contactId}/contactPerson`));
  }

  async function getContactPerson(contactId: number, contactPersonId: number): Promise<ContactPerson> {
    return fikenRequest<ContactPerson>(companyEndpoint(`/contacts/${contactId}/contactPerson/${contactPersonId}`));
  }

  async function addContactPerson(contactId: number, person: ContactPersonRequest): Promise<ContactPerson> {
    return fikenRequest<ContactPerson>(companyEndpoint(`/contacts/${contactId}/contactPerson`), {
      method: "POST",
      body: person,
    });
  }

  async function updateContactPerson(contactId: number, contactPersonId: number, person: ContactPersonRequest): Promise<ContactPerson> {
    return fikenRequest<ContactPerson>(companyEndpoint(`/contacts/${contactId}/contactPerson/${contactPersonId}`), {
      method: "PUT",
      body: person,
    });
  }

  async function deleteContactPerson(contactId: number, contactPersonId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/contacts/${contactId}/contactPerson/${contactPersonId}`), {
      method: "DELETE",
    });
  }

  // ============================================
  // GROUPS
  // ============================================

  async function getGroups(): Promise<string[]> {
    return fikenRequest<string[]>(companyEndpoint("/groups"));
  }

  // ============================================
  // PRODUCTS
  // ============================================

  async function getProducts(params?: ProductQueryParams): Promise<Product[]> {
    return fikenRequest<Product[]>(companyEndpoint("/products"), { params: params as any });
  }

  async function getProduct(productId: number): Promise<Product> {
    return fikenRequest<Product>(companyEndpoint(`/products/${productId}`));
  }

  async function createProduct(product: ProductRequest): Promise<Product> {
    return fikenRequest<Product>(companyEndpoint("/products"), {
      method: "POST",
      body: product,
    });
  }

  async function updateProduct(productId: number, product: ProductRequest): Promise<Product> {
    return fikenRequest<Product>(companyEndpoint(`/products/${productId}`), {
      method: "PUT",
      body: product,
    });
  }

  async function deleteProduct(productId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/products/${productId}`), {
      method: "DELETE",
    });
  }

  async function createProductSalesReport(from: string, to: string): Promise<any> {
    return fikenRequest<any>(companyEndpoint("/products/salesReport"), {
      method: "POST",
      body: { from, to },
    });
  }

  // ============================================
  // INVOICES
  // ============================================

  async function getInvoices(params?: InvoiceQueryParams): Promise<Invoice[]> {
    return fikenRequest<Invoice[]>(companyEndpoint("/invoices"), { params: params as any });
  }

  async function getInvoice(invoiceId: number): Promise<Invoice> {
    return fikenRequest<Invoice>(companyEndpoint(`/invoices/${invoiceId}`));
  }

  async function createInvoice(invoice: InvoiceRequest): Promise<Invoice> {
    return fikenRequest<Invoice>(companyEndpoint("/invoices"), {
      method: "POST",
      body: invoice,
    });
  }

  async function updateInvoice(invoiceId: number, update: InvoiceUpdateRequest): Promise<Invoice> {
    return fikenRequest<Invoice>(companyEndpoint(`/invoices/${invoiceId}`), {
      method: "PATCH",
      body: update,
    });
  }

  async function sendInvoice(request: SendInvoiceRequest): Promise<void> {
    await fikenRequest<void>(companyEndpoint("/invoices/send"), {
      method: "POST",
      body: request,
    });
  }

  // Legacy sendInvoice for backward compatibility
  async function sendInvoiceLegacy(invoiceId: number, method: "email" | "ehf" | "efaktura" | "sms" = "email", emailAddress?: string): Promise<void> {
    await sendInvoice({
      invoiceId,
      method: [method],
      includeDocumentAttachments: true,
      emailAddress,
    });
  }

  // Invoice Attachments
  async function getInvoiceAttachments(invoiceId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/invoices/${invoiceId}/attachments`));
  }

  async function addAttachmentToInvoice(invoiceId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/invoices/${invoiceId}/attachments`), formData);
  }

  // Invoice Counter
  async function getInvoiceCounter(): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/invoices/counter"));
  }

  async function createInvoiceCounter(value?: number): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/invoices/counter"), {
      method: "POST",
      body: value !== undefined ? { value } : {},
    });
  }

  // Invoice Drafts
  async function getInvoiceDrafts(): Promise<InvoiceDraft[]> {
    return fikenRequest<InvoiceDraft[]>(companyEndpoint("/invoices/drafts"));
  }

  async function getInvoiceDraft(draftId: number): Promise<InvoiceDraft> {
    return fikenRequest<InvoiceDraft>(companyEndpoint(`/invoices/drafts/${draftId}`));
  }

  async function createInvoiceDraft(draft: InvoiceDraftRequest): Promise<InvoiceDraft> {
    return fikenRequest<InvoiceDraft>(companyEndpoint("/invoices/drafts"), {
      method: "POST",
      body: draft,
    });
  }

  async function updateInvoiceDraft(draftId: number, draft: InvoiceDraftRequest): Promise<InvoiceDraft> {
    return fikenRequest<InvoiceDraft>(companyEndpoint(`/invoices/drafts/${draftId}`), {
      method: "PUT",
      body: draft,
    });
  }

  async function deleteInvoiceDraft(draftId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/invoices/drafts/${draftId}`), {
      method: "DELETE",
    });
  }

  async function getInvoiceDraftAttachments(draftId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/invoices/drafts/${draftId}/attachments`));
  }

  async function addAttachmentToInvoiceDraft(draftId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/invoices/drafts/${draftId}/attachments`), formData);
  }

  async function createInvoiceFromDraft(draftId: number): Promise<Invoice> {
    return fikenRequest<Invoice>(companyEndpoint(`/invoices/drafts/${draftId}/createInvoice`), {
      method: "POST",
    });
  }

  // NOTE: Invoice Payments - The /invoices/{invoiceId}/payments endpoint does NOT exist in Fiken API
  // Invoice payment status is tracked via the 'settled' boolean on the invoice object.
  // Payment happens automatically when Fiken detects payment through bank integration.
  // For cash invoices, set cash=true and paymentAccount when creating.

  // ============================================
  // CREDIT NOTES
  // ============================================

  async function getCreditNotes(params?: CreditNoteQueryParams): Promise<CreditNote[]> {
    return fikenRequest<CreditNote[]>(companyEndpoint("/creditNotes"), { params: params as any });
  }

  async function getCreditNote(creditNoteId: number): Promise<CreditNote> {
    return fikenRequest<CreditNote>(companyEndpoint(`/creditNotes/${creditNoteId}`));
  }

  async function createFullCreditNote(request: FullCreditNoteRequest): Promise<CreditNote> {
    return fikenRequest<CreditNote>(companyEndpoint("/creditNotes/full"), {
      method: "POST",
      body: request,
    });
  }

  async function createPartialCreditNote(request: PartialCreditNoteRequest): Promise<CreditNote> {
    return fikenRequest<CreditNote>(companyEndpoint("/creditNotes/partial"), {
      method: "POST",
      body: request,
    });
  }

  async function sendCreditNote(request: SendCreditNoteRequest): Promise<void> {
    await fikenRequest<void>(companyEndpoint("/creditNotes/send"), {
      method: "POST",
      body: request,
    });
  }

  // Credit Note Counter
  async function getCreditNoteCounter(): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/creditNotes/counter"));
  }

  async function createCreditNoteCounter(value?: number): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/creditNotes/counter"), {
      method: "POST",
      body: value !== undefined ? { value } : {},
    });
  }

  // Credit Note Drafts
  async function getCreditNoteDrafts(): Promise<CreditNoteDraft[]> {
    return fikenRequest<CreditNoteDraft[]>(companyEndpoint("/creditNotes/drafts"));
  }

  async function getCreditNoteDraft(draftId: number): Promise<CreditNoteDraft> {
    return fikenRequest<CreditNoteDraft>(companyEndpoint(`/creditNotes/drafts/${draftId}`));
  }

  async function createCreditNoteDraft(draft: CreditNoteDraftRequest): Promise<CreditNoteDraft> {
    return fikenRequest<CreditNoteDraft>(companyEndpoint("/creditNotes/drafts"), {
      method: "POST",
      body: draft,
    });
  }

  async function updateCreditNoteDraft(draftId: number, draft: CreditNoteDraftRequest): Promise<CreditNoteDraft> {
    return fikenRequest<CreditNoteDraft>(companyEndpoint(`/creditNotes/drafts/${draftId}`), {
      method: "PUT",
      body: draft,
    });
  }

  async function deleteCreditNoteDraft(draftId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/creditNotes/drafts/${draftId}`), {
      method: "DELETE",
    });
  }

  async function getCreditNoteDraftAttachments(draftId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/creditNotes/drafts/${draftId}/attachments`));
  }

  async function addAttachmentToCreditNoteDraft(draftId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/creditNotes/drafts/${draftId}/attachments`), formData);
  }

  async function createCreditNoteFromDraft(draftId: number): Promise<CreditNote> {
    return fikenRequest<CreditNote>(companyEndpoint(`/creditNotes/drafts/${draftId}/createCreditNote`), {
      method: "POST",
    });
  }

  // ============================================
  // OFFERS (Tilbud)
  // ============================================

  async function getOffers(params?: OfferQueryParams): Promise<Offer[]> {
    return fikenRequest<Offer[]>(companyEndpoint("/offers"), { params: params as any });
  }

  async function getOffer(offerId: number): Promise<Offer> {
    return fikenRequest<Offer>(companyEndpoint(`/offers/${offerId}`));
  }

  // Offer Counter
  async function getOfferCounter(): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/offers/counter"));
  }

  async function createOfferCounter(value?: number): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/offers/counter"), {
      method: "POST",
      body: value !== undefined ? { value } : {},
    });
  }

  // Offer Drafts
  async function getOfferDrafts(): Promise<OfferDraft[]> {
    return fikenRequest<OfferDraft[]>(companyEndpoint("/offers/drafts"));
  }

  async function getOfferDraft(draftId: number): Promise<OfferDraft> {
    return fikenRequest<OfferDraft>(companyEndpoint(`/offers/drafts/${draftId}`));
  }

  async function createOfferDraft(draft: OfferDraftRequest): Promise<OfferDraft> {
    return fikenRequest<OfferDraft>(companyEndpoint("/offers/drafts"), {
      method: "POST",
      body: draft,
    });
  }

  async function updateOfferDraft(draftId: number, draft: OfferDraftRequest): Promise<OfferDraft> {
    return fikenRequest<OfferDraft>(companyEndpoint(`/offers/drafts/${draftId}`), {
      method: "PUT",
      body: draft,
    });
  }

  async function deleteOfferDraft(draftId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/offers/drafts/${draftId}`), {
      method: "DELETE",
    });
  }

  async function getOfferDraftAttachments(draftId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/offers/drafts/${draftId}/attachments`));
  }

  async function addAttachmentToOfferDraft(draftId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/offers/drafts/${draftId}/attachments`), formData);
  }

  async function createOfferFromDraft(draftId: number): Promise<Offer> {
    return fikenRequest<Offer>(companyEndpoint(`/offers/drafts/${draftId}/createOffer`), {
      method: "POST",
    });
  }

  // ============================================
  // ORDER CONFIRMATIONS (Ordrebekreftelser)
  // ============================================

  async function getOrderConfirmations(params?: OrderConfirmationQueryParams): Promise<OrderConfirmation[]> {
    return fikenRequest<OrderConfirmation[]>(companyEndpoint("/orderConfirmations"), { params: params as any });
  }

  async function getOrderConfirmation(confirmationId: number): Promise<OrderConfirmation> {
    return fikenRequest<OrderConfirmation>(companyEndpoint(`/orderConfirmations/${confirmationId}`));
  }

  // Order Confirmation Counter
  async function getOrderConfirmationCounter(): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/orderConfirmations/counter"));
  }

  async function createOrderConfirmationCounter(value?: number): Promise<Counter> {
    return fikenRequest<Counter>(companyEndpoint("/orderConfirmations/counter"), {
      method: "POST",
      body: value !== undefined ? { value } : {},
    });
  }

  // Create invoice draft from order confirmation
  async function createInvoiceDraftFromOrderConfirmation(confirmationId: number): Promise<InvoiceDraft> {
    return fikenRequest<InvoiceDraft>(companyEndpoint(`/orderConfirmations/${confirmationId}/createInvoiceDraft`), {
      method: "POST",
    });
  }

  // Order Confirmation Drafts
  async function getOrderConfirmationDrafts(): Promise<OrderConfirmationDraft[]> {
    return fikenRequest<OrderConfirmationDraft[]>(companyEndpoint("/orderConfirmations/drafts"));
  }

  async function getOrderConfirmationDraft(draftId: number): Promise<OrderConfirmationDraft> {
    return fikenRequest<OrderConfirmationDraft>(companyEndpoint(`/orderConfirmations/drafts/${draftId}`));
  }

  async function createOrderConfirmationDraft(draft: OrderConfirmationDraftRequest): Promise<OrderConfirmationDraft> {
    return fikenRequest<OrderConfirmationDraft>(companyEndpoint("/orderConfirmations/drafts"), {
      method: "POST",
      body: draft,
    });
  }

  async function updateOrderConfirmationDraft(draftId: number, draft: OrderConfirmationDraftRequest): Promise<OrderConfirmationDraft> {
    return fikenRequest<OrderConfirmationDraft>(companyEndpoint(`/orderConfirmations/drafts/${draftId}`), {
      method: "PUT",
      body: draft,
    });
  }

  async function deleteOrderConfirmationDraft(draftId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/orderConfirmations/drafts/${draftId}`), {
      method: "DELETE",
    });
  }

  async function getOrderConfirmationDraftAttachments(draftId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/orderConfirmations/drafts/${draftId}/attachments`));
  }

  async function addAttachmentToOrderConfirmationDraft(draftId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/orderConfirmations/drafts/${draftId}/attachments`), formData);
  }

  async function createOrderConfirmationFromDraft(draftId: number): Promise<OrderConfirmation> {
    return fikenRequest<OrderConfirmation>(companyEndpoint(`/orderConfirmations/drafts/${draftId}/createOrderConfirmation`), {
      method: "POST",
    });
  }

  // ============================================
  // PURCHASES (Leverandørfakturaer / Kjøp)
  // ============================================

  async function getPurchases(params?: PurchaseQueryParams): Promise<Purchase[]> {
    return fikenRequest<Purchase[]>(companyEndpoint("/purchases"), { params: params as any });
  }

  async function getPurchase(purchaseId: number): Promise<Purchase> {
    return fikenRequest<Purchase>(companyEndpoint(`/purchases/${purchaseId}`));
  }

  async function createPurchase(purchase: PurchaseRequest): Promise<Purchase> {
    const result = await fikenRequest<Purchase & { location?: string }>(companyEndpoint("/purchases"), {
      method: "POST",
      body: purchase,
    });
    
    // If we got a location header but no purchaseId, extract ID from location and fetch the purchase
    if (result.location && !result.purchaseId) {
      // Location format: /companies/{slug}/purchases/{purchaseId}
      const match = result.location.match(/\/purchases\/(\d+)/);
      if (match) {
        const purchaseId = parseInt(match[1], 10);
        return getPurchase(purchaseId);
      }
    }
    
    return result;
  }

  async function deletePurchase(purchaseId: number, description: string): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/purchases/${purchaseId}/delete`), {
      method: "PATCH",
      params: { description },
    });
  }

  // Purchase Attachments
  async function getPurchaseAttachments(purchaseId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/purchases/${purchaseId}/attachments`));
  }

  async function addAttachmentToPurchase(purchaseId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/purchases/${purchaseId}/attachments`), formData);
  }

  // Purchase Payments
  async function getPurchasePayments(purchaseId: number): Promise<Payment[]> {
    const purchase = await getPurchase(purchaseId);
    return purchase.payments || [];
  }

  async function addPurchasePayment(purchaseId: number, payment: PaymentRequest): Promise<Payment> {
    return fikenRequest<Payment>(companyEndpoint(`/purchases/${purchaseId}/payments`), {
      method: "POST",
      body: payment,
    });
  }

  // Purchase Drafts
  async function getPurchaseDrafts(): Promise<PurchaseDraft[]> {
    return fikenRequest<PurchaseDraft[]>(companyEndpoint("/purchases/drafts"));
  }

  async function getPurchaseDraft(draftId: number): Promise<PurchaseDraft> {
    return fikenRequest<PurchaseDraft>(companyEndpoint(`/purchases/drafts/${draftId}`));
  }

  async function createPurchaseDraft(draft: PurchaseDraftRequest): Promise<PurchaseDraft> {
    return fikenRequest<PurchaseDraft>(companyEndpoint("/purchases/drafts"), {
      method: "POST",
      body: draft,
    });
  }

  async function updatePurchaseDraft(draftId: number, draft: PurchaseDraftRequest): Promise<PurchaseDraft> {
    return fikenRequest<PurchaseDraft>(companyEndpoint(`/purchases/drafts/${draftId}`), {
      method: "PUT",
      body: draft,
    });
  }

  async function deletePurchaseDraft(draftId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/purchases/drafts/${draftId}`), {
      method: "DELETE",
    });
  }

  async function getPurchaseDraftAttachments(draftId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/purchases/drafts/${draftId}/attachments`));
  }

  async function addAttachmentToPurchaseDraft(draftId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/purchases/drafts/${draftId}/attachments`), formData);
  }

  async function createPurchaseFromDraft(draftId: number): Promise<Purchase> {
    return fikenRequest<Purchase>(companyEndpoint(`/purchases/drafts/${draftId}/createPurchase`), {
      method: "POST",
    });
  }

  // ============================================
  // SALES (Annet salg)
  // ============================================

  async function getSales(params?: SaleQueryParams): Promise<Sale[]> {
    return fikenRequest<Sale[]>(companyEndpoint("/sales"), { params: params as any });
  }

  async function getSale(saleId: number): Promise<Sale> {
    return fikenRequest<Sale>(companyEndpoint(`/sales/${saleId}`));
  }

  async function createSale(sale: SaleRequest): Promise<Sale> {
    return fikenRequest<Sale>(companyEndpoint("/sales"), {
      method: "POST",
      body: sale,
    });
  }

  async function settleSale(saleId: number, settledDate: string): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/sales/${saleId}/settled`), {
      method: "PATCH",
      params: { settledDate },
    });
  }

  async function deleteSale(saleId: number, description: string): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/sales/${saleId}/delete`), {
      method: "PATCH",
      params: { description },
    });
  }

  // Sale Attachments
  async function getSaleAttachments(saleId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/sales/${saleId}/attachments`));
  }

  async function addAttachmentToSale(saleId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/sales/${saleId}/attachments`), formData);
  }

  // Sale Payments
  async function getSalePayments(saleId: number): Promise<Payment[]> {
    return fikenRequest<Payment[]>(companyEndpoint(`/sales/${saleId}/payments`));
  }

  async function getSalePayment(saleId: number, paymentId: number): Promise<Payment> {
    return fikenRequest<Payment>(companyEndpoint(`/sales/${saleId}/payments/${paymentId}`));
  }

  async function addSalePayment(saleId: number, payment: PaymentRequest): Promise<Payment> {
    return fikenRequest<Payment>(companyEndpoint(`/sales/${saleId}/payments`), {
      method: "POST",
      body: payment,
    });
  }

  // Sale Drafts
  async function getSaleDrafts(): Promise<SaleDraft[]> {
    return fikenRequest<SaleDraft[]>(companyEndpoint("/sales/drafts"));
  }

  async function getSaleDraft(draftId: number): Promise<SaleDraft> {
    return fikenRequest<SaleDraft>(companyEndpoint(`/sales/drafts/${draftId}`));
  }

  async function createSaleDraft(draft: SaleDraftRequest): Promise<SaleDraft> {
    return fikenRequest<SaleDraft>(companyEndpoint("/sales/drafts"), {
      method: "POST",
      body: draft,
    });
  }

  async function updateSaleDraft(draftId: number, draft: SaleDraftRequest): Promise<SaleDraft> {
    return fikenRequest<SaleDraft>(companyEndpoint(`/sales/drafts/${draftId}`), {
      method: "PUT",
      body: draft,
    });
  }

  async function deleteSaleDraft(draftId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/sales/drafts/${draftId}`), {
      method: "DELETE",
    });
  }

  async function getSaleDraftAttachments(draftId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/sales/drafts/${draftId}/attachments`));
  }

  async function addAttachmentToSaleDraft(draftId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/sales/drafts/${draftId}/attachments`), formData);
  }

  async function createSaleFromDraft(draftId: number): Promise<Sale> {
    return fikenRequest<Sale>(companyEndpoint(`/sales/drafts/${draftId}/createSale`), {
      method: "POST",
    });
  }

  // ============================================
  // ACCOUNTS & BALANCES
  // ============================================

  async function getAccounts(params?: AccountQueryParams): Promise<Account[]> {
    return fikenRequest<Account[]>(companyEndpoint("/accounts"), { params: params as any });
  }

  async function getAccount(accountCode: string): Promise<Account> {
    return fikenRequest<Account>(companyEndpoint(`/accounts/${accountCode}`));
  }

  async function getAccountBalances(params: AccountBalanceQueryParams): Promise<AccountBalance[]> {
    return fikenRequest<AccountBalance[]>(companyEndpoint("/accountBalances"), { params: params as any });
  }

  async function getAccountBalance(accountCode: string, date: string): Promise<AccountBalance> {
    return fikenRequest<AccountBalance>(companyEndpoint(`/accountBalances/${accountCode}`), {
      params: { date },
    });
  }

  /**
   * Get financial summary (income, expenses, result) for a period
   * Calculates from account balances:
   * - Income: accounts 3000-3999 (negative balance = income)
   * - Expenses: accounts 4000-7999 (positive balance = expense)
   */
  async function getFinancialSummary(fromDate: string, toDate: string): Promise<FinancialSummary> {
    // Fetch all account balances for the end date
    // Use pagination to get all accounts
    const allBalances: AccountBalance[] = [];
    let page = 0;
    let hasMore = true;
    
    while (hasMore) {
      const balances = await getAccountBalances({ 
        date: toDate, 
        pageSize: 100,
        page 
      });
      allBalances.push(...balances);
      
      if (balances.length < 100) {
        hasMore = false;
      } else {
        page++;
        if (page > 50) hasMore = false; // Safety limit
      }
    }
    
    let income = 0;
    let expenses = 0;
    
    for (const account of allBalances) {
      const code = parseInt(account.code);
      
      // Income accounts 3000-3999 (negative balance = income in accounting)
      if (code >= 3000 && code <= 3999) {
        income += Math.abs(account.balance);
      }
      // Expense accounts 4000-7999 (positive balance = expense)
      else if (code >= 4000 && code <= 7999) {
        expenses += Math.abs(account.balance);
      }
    }
    
    return {
      period: { from: fromDate, to: toDate },
      income,
      expenses,
      result: income - expenses,
    };
  }

  // ============================================
  // BANK ACCOUNTS & BALANCES
  // ============================================

  async function getBankAccounts(params?: BankAccountQueryParams): Promise<BankAccount[]> {
    return fikenRequest<BankAccount[]>(companyEndpoint("/bankAccounts"), { params: params as any });
  }

  async function getBankAccount(bankAccountId: number): Promise<BankAccount> {
    return fikenRequest<BankAccount>(companyEndpoint(`/bankAccounts/${bankAccountId}`));
  }

  async function createBankAccount(bankAccount: BankAccountRequest): Promise<BankAccount> {
    return fikenRequest<BankAccount>(companyEndpoint("/bankAccounts"), {
      method: "POST",
      body: bankAccount,
    });
  }

  async function getBankBalances(params?: BankBalanceQueryParams): Promise<BankBalance[]> {
    return fikenRequest<BankBalance[]>(companyEndpoint("/bankBalances"), { params: params as any });
  }

  // ============================================
  // JOURNAL ENTRIES
  // ============================================

  async function getJournalEntries(params?: JournalEntryQueryParams): Promise<JournalEntry[]> {
    return fikenRequest<JournalEntry[]>(companyEndpoint("/journalEntries"), { params: params as any });
  }

  async function getJournalEntry(journalEntryId: number): Promise<JournalEntry> {
    return fikenRequest<JournalEntry>(companyEndpoint(`/journalEntries/${journalEntryId}`));
  }

  async function createGeneralJournalEntry(request: GeneralJournalEntryRequest): Promise<JournalEntry> {
    return fikenRequest<JournalEntry>(companyEndpoint("/generalJournalEntries"), {
      method: "POST",
      body: request,
    });
  }

  // Journal Entry Attachments
  async function getJournalEntryAttachments(journalEntryId: number): Promise<Attachment[]> {
    return fikenRequest<Attachment[]>(companyEndpoint(`/journalEntries/${journalEntryId}/attachments`));
  }

  async function addAttachmentToJournalEntry(journalEntryId: number, formData: FormData): Promise<Attachment> {
    return fikenMultipartRequest<Attachment>(companyEndpoint(`/journalEntries/${journalEntryId}/attachments`), formData);
  }

  // ============================================
  // TRANSACTIONS
  // ============================================

  async function getTransactions(params?: TransactionQueryParams): Promise<Transaction[]> {
    return fikenRequest<Transaction[]>(companyEndpoint("/transactions"), { params: params as any });
  }

  async function getTransaction(transactionId: number): Promise<Transaction> {
    return fikenRequest<Transaction>(companyEndpoint(`/transactions/${transactionId}`));
  }

  async function deleteTransaction(transactionId: number, description: string): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/transactions/${transactionId}/delete`), {
      method: "PATCH",
      params: { description },
    });
  }

  // ============================================
  // PROJECTS
  // ============================================

  async function getProjects(params?: ProjectQueryParams): Promise<Project[]> {
    return fikenRequest<Project[]>(companyEndpoint("/projects"), { params: params as any });
  }

  async function getProject(projectId: number): Promise<Project> {
    return fikenRequest<Project>(companyEndpoint(`/projects/${projectId}`));
  }

  async function createProject(project: ProjectRequest): Promise<Project> {
    return fikenRequest<Project>(companyEndpoint("/projects"), {
      method: "POST",
      body: project,
    });
  }

  async function updateProject(projectId: number, project: ProjectUpdateRequest): Promise<Project> {
    return fikenRequest<Project>(companyEndpoint(`/projects/${projectId}`), {
      method: "PATCH",
      body: project,
    });
  }

  async function deleteProject(projectId: number): Promise<void> {
    await fikenRequest<void>(companyEndpoint(`/projects/${projectId}`), {
      method: "DELETE",
    });
  }

  // ============================================
  // INBOX
  // ============================================

  async function getInbox(params?: InboxQueryParams): Promise<InboxDocument[]> {
    return fikenRequest<InboxDocument[]>(companyEndpoint("/inbox"), { params: params as any });
  }

  async function getInboxDocument(documentId: number): Promise<InboxDocument> {
    return fikenRequest<InboxDocument>(companyEndpoint(`/inbox/${documentId}`));
  }

  async function createInboxDocument(formData: FormData): Promise<InboxDocument> {
    return fikenMultipartRequest<InboxDocument>(companyEndpoint("/inbox"), formData);
  }

  // ============================================
  // RETURN ALL FUNCTIONS
  // ============================================

  return {
    // User
    getUser,
    
    // Company
    getCompany,
    getCompanies,
    
    // Contacts
    getContacts,
    getContact,
    createContact,
    updateContact,
    deleteContact,
    addAttachmentToContact,
    getContactPersons,
    getContactPerson,
    addContactPerson,
    updateContactPerson,
    deleteContactPerson,
    
    // Groups
    getGroups,
    
    // Products
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    createProductSalesReport,
    
    // Invoices
    getInvoices,
    getInvoice,
    createInvoice,
    updateInvoice,
    sendInvoice,
    sendInvoiceLegacy,
    getInvoiceAttachments,
    addAttachmentToInvoice,
    getInvoiceCounter,
    createInvoiceCounter,
    getInvoiceDrafts,
    getInvoiceDraft,
    createInvoiceDraft,
    updateInvoiceDraft,
    deleteInvoiceDraft,
    getInvoiceDraftAttachments,
    addAttachmentToInvoiceDraft,
    createInvoiceFromDraft,
    // NOTE: getInvoicePayments and addInvoicePayment removed - endpoint doesn't exist in Fiken API
    
    // Credit Notes
    getCreditNotes,
    getCreditNote,
    createFullCreditNote,
    createPartialCreditNote,
    sendCreditNote,
    getCreditNoteCounter,
    createCreditNoteCounter,
    getCreditNoteDrafts,
    getCreditNoteDraft,
    createCreditNoteDraft,
    updateCreditNoteDraft,
    deleteCreditNoteDraft,
    getCreditNoteDraftAttachments,
    addAttachmentToCreditNoteDraft,
    createCreditNoteFromDraft,
    
    // Offers
    getOffers,
    getOffer,
    getOfferCounter,
    createOfferCounter,
    getOfferDrafts,
    getOfferDraft,
    createOfferDraft,
    updateOfferDraft,
    deleteOfferDraft,
    getOfferDraftAttachments,
    addAttachmentToOfferDraft,
    createOfferFromDraft,
    
    // Order Confirmations
    getOrderConfirmations,
    getOrderConfirmation,
    getOrderConfirmationCounter,
    createOrderConfirmationCounter,
    createInvoiceDraftFromOrderConfirmation,
    getOrderConfirmationDrafts,
    getOrderConfirmationDraft,
    createOrderConfirmationDraft,
    updateOrderConfirmationDraft,
    deleteOrderConfirmationDraft,
    getOrderConfirmationDraftAttachments,
    addAttachmentToOrderConfirmationDraft,
    createOrderConfirmationFromDraft,
    
    // Purchases
    getPurchases,
    getPurchase,
    createPurchase,
    deletePurchase,
    getPurchaseAttachments,
    addAttachmentToPurchase,
    getPurchasePayments,
    addPurchasePayment,
    getPurchaseDrafts,
    getPurchaseDraft,
    createPurchaseDraft,
    updatePurchaseDraft,
    deletePurchaseDraft,
    getPurchaseDraftAttachments,
    addAttachmentToPurchaseDraft,
    createPurchaseFromDraft,
    
    // Sales
    getSales,
    getSale,
    createSale,
    settleSale,
    deleteSale,
    getSaleAttachments,
    addAttachmentToSale,
    getSalePayments,
    getSalePayment,
    addSalePayment,
    getSaleDrafts,
    getSaleDraft,
    createSaleDraft,
    updateSaleDraft,
    deleteSaleDraft,
    getSaleDraftAttachments,
    addAttachmentToSaleDraft,
    createSaleFromDraft,
    
    // Accounts
    getAccounts,
    getAccount,
    getAccountBalances,
    getAccountBalance,
    getFinancialSummary,
    
    // Bank
    getBankAccounts,
    getBankAccount,
    createBankAccount,
    getBankBalances,
    
    // Journal Entries
    getJournalEntries,
    getJournalEntry,
    createGeneralJournalEntry,
    getJournalEntryAttachments,
    addAttachmentToJournalEntry,
    
    // Transactions
    getTransactions,
    getTransaction,
    deleteTransaction,
    
    // Projects
    getProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    
    // Inbox
    getInbox,
    getInboxDocument,
    createInboxDocument,
  };
}

export type FikenClient = ReturnType<typeof createFikenClient>;
