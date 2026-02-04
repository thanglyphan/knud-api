/**
 * Fiken AI Tools
 * Complete tool definitions for AI to interact with Fiken API
 * 
 * IMPORTANT FIKEN API RULES:
 * - All amounts are in ØRE (100 øre = 1 kr, so 50000 = 500 kr)
 * - Purchase kind: "cash_purchase" or "supplier" (NOT "supplier_invoice")
 * - VAT types for SALES: HIGH (25%), MEDIUM (15%), LOW (12%), RAW_FISH (11.11%), NONE, EXEMPT, EXEMPT_IMPORT_EXPORT, EXEMPT_REVERSE, OUTSIDE
 * - VAT types for PURCHASES: HIGH, MEDIUM, LOW, RAW_FISH, NONE, HIGH_DIRECT, HIGH_BASIS, MEDIUM_DIRECT, MEDIUM_BASIS, NONE_IMPORT_BASIS,
 *   HIGH_FOREIGN_SERVICE_DEDUCTIBLE, HIGH_FOREIGN_SERVICE_NONDEDUCTIBLE, LOW_FOREIGN_SERVICE_DEDUCTIBLE, LOW_FOREIGN_SERVICE_NONDEDUCTIBLE,
 *   HIGH_PURCHASE_OF_EMISSIONSTRADING_OR_GOLD_DEDUCTIBLE, HIGH_PURCHASE_OF_EMISSIONSTRADING_OR_GOLD_NONDEDUCTIBLE
 * - CRITICAL: Counters must be initialized before creating invoices/creditnotes/offers/order confirmations for the first time
 * - Invoices CANNOT be deleted - use credit notes to reverse them
 */

import { z } from "zod";
import { tool } from "ai";
import { type FikenClient } from "../client.js";
import { createAccountHelper } from "./accountHelper.js";

// Type for file attachment passed from chat
interface PendingFile {
  name: string;
  type: string;
  data: string; // base64 data URL
}

// Helper to convert base64 data URL to FormData for Fiken API
function createAttachmentFormData(file: PendingFile, options?: { attachToPayment?: boolean; attachToSale?: boolean }): FormData {
  // Extract base64 data from data URL (remove "data:image/png;base64," prefix)
  const base64Data = file.data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const blob = new Blob([buffer], { type: file.type });
  
  const formData = new FormData();
  formData.append("file", blob, file.name);
  formData.append("filename", file.name);
  
  // For purchases, at least one of these must be true
  if (options?.attachToPayment !== undefined) {
    formData.append("attachToPayment", String(options.attachToPayment));
  }
  if (options?.attachToSale !== undefined) {
    formData.append("attachToSale", String(options.attachToSale));
  }
  
  return formData;
}

// Factory function to create tools with a specific Fiken client
export function createFikenTools(client: FikenClient, companySlug: string, pendingFiles?: PendingFile[]) {
  
  // Initialiser account helper med caching
  const accountHelper = createAccountHelper(client, companySlug);
  
  // ============================================
  // COMPANY TOOLS
  // ============================================

  const getCompanyInfo = tool({
    description: "Hent informasjon om selskapet i Fiken, inkludert navn, organisasjonsnummer og adresse.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const company = await client.getCompany();
        return {
          success: true,
          company: {
            name: company.name,
            slug: company.slug,
            organizationNumber: company.organizationNumber,
            email: company.email,
            phoneNumber: company.phoneNumber,
            address: company.address,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente selskapsinformasjon",
        };
      }
    },
  });

  // ============================================
  // CONTACT TOOLS
  // ============================================

  const searchContacts = tool({
    description: "Søk etter kontakter (kunder/leverandører) i Fiken. Bruk dette for å finne kunder før du oppretter fakturaer.",
    parameters: z.object({
      name: z.string().optional().describe("Navn på kontakten (delvis match)"),
      email: z.string().optional().describe("E-postadresse"),
      organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
      customer: z.boolean().optional().describe("Filtrer kun kunder"),
      supplier: z.boolean().optional().describe("Filtrer kun leverandører"),
      inactive: z.boolean().optional().default(false).describe("Inkluder inaktive kontakter"),
    }),
    execute: async ({ name, email, organizationNumber, customer, supplier, inactive }) => {
      try {
        const contacts = await client.getContacts({
          name,
          email,
          organizationNumber,
          customer,
          supplier,
          inactive,
          pageSize: 25,
        });
        return {
          success: true,
          count: contacts.length,
          contacts: contacts.map((c) => ({
            id: c.contactId,
            name: c.name,
            email: c.email,
            organizationNumber: c.organizationNumber,
            phoneNumber: c.phoneNumber,
            customerNumber: c.customerNumber,
            supplierNumber: c.supplierNumber,
            isCustomer: c.customer,
            isSupplier: c.supplier,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter kontakter",
        };
      }
    },
  });

  const getContact = tool({
    description: "Hent detaljert informasjon om en spesifikk kontakt.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID i Fiken"),
    }),
    execute: async ({ contactId }) => {
      try {
        const contact = await client.getContact(contactId);
        return { success: true, contact };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kontakt",
        };
      }
    },
  });

  const createContact = tool({
    description: "Opprett en ny kontakt (kunde eller leverandør) i Fiken.",
    parameters: z.object({
      name: z.string().describe("Navn på kontakten (påkrevd)"),
      email: z.string().optional().describe("E-postadresse"),
      organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
      phoneNumber: z.string().optional().describe("Telefonnummer"),
      customer: z.boolean().optional().default(true).describe("Er dette en kunde?"),
      supplier: z.boolean().optional().default(false).describe("Er dette en leverandør?"),
    }),
    execute: async ({ name, email, organizationNumber, phoneNumber, customer, supplier }) => {
      try {
        const contact = await client.createContact({
          name,
          email,
          organizationNumber,
          phoneNumber,
          customer,
          supplier,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Kontakt opprettet: ${name} (ID: ${contact.contactId})`,
          contact: {
            contactId: contact.contactId,
            name: contact.name,
            customerNumber: contact.customerNumber,
            supplierNumber: contact.supplierNumber,
            isCustomer: contact.customer,
            isSupplier: contact.supplier,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette kontakt",
        };
      }
    },
  });

  const updateContact = tool({
    description: "Oppdater en eksisterende kontakt i Fiken.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID"),
      name: z.string().describe("Navn på kontakten"),
      email: z.string().optional().describe("E-postadresse"),
      phoneNumber: z.string().optional().describe("Telefonnummer"),
      inactive: z.boolean().optional().describe("Sett kontakten som inaktiv"),
    }),
    execute: async ({ contactId, name, email, phoneNumber, inactive }) => {
      try {
        const contact = await client.updateContact(contactId, {
          name,
          email,
          phoneNumber,
          inactive,
        });
        return {
          success: true,
          message: "Kontakt oppdatert: " + name,
          contact,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke oppdatere kontakt",
        };
      }
    },
  });

  const deleteContact = tool({
    description: "Slett en kontakt fra Fiken. Kan kun slettes hvis kontakten ikke er brukt i transaksjoner.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID som skal slettes"),
    }),
    execute: async ({ contactId }) => {
      try {
        await client.deleteContact(contactId);
        return { success: true, message: "Kontakt ble slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette kontakt",
        };
      }
    },
  });

  const getContactPersons = tool({
    description: "Hent kontaktpersoner for en kontakt (firma).",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID"),
    }),
    execute: async ({ contactId }) => {
      try {
        const persons = await client.getContactPersons(contactId);
        return { success: true, count: persons.length, contactPersons: persons };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kontaktpersoner",
        };
      }
    },
  });

  const addContactPerson = tool({
    description: "Legg til en kontaktperson på en kontakt (firma). Både navn og e-post er påkrevd.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID"),
      name: z.string().describe("Navn på kontaktpersonen"),
      email: z.string().describe("E-postadresse (påkrevd)"),
      phoneNumber: z.string().optional().describe("Telefonnummer"),
    }),
    execute: async ({ contactId, name, email, phoneNumber }) => {
      try {
        const person = await client.addContactPerson(contactId, { name, email, phoneNumber });
        return {
          success: true,
          message: "Kontaktperson lagt til: " + name,
          contactPerson: person,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke legge til kontaktperson",
        };
      }
    },
  });

  // ============================================
  // PRODUCT TOOLS
  // ============================================

  const searchProducts = tool({
    description: "Søk etter produkter i Fiken.",
    parameters: z.object({
      name: z.string().optional().describe("Produktnavn (delvis match)"),
      productNumber: z.string().optional().describe("Produktnummer"),
      active: z.boolean().optional().default(true).describe("Kun aktive produkter"),
    }),
    execute: async ({ name, productNumber, active }) => {
      try {
        const products = await client.getProducts({ name, productNumber, active, pageSize: 25 });
        return {
          success: true,
          count: products.length,
          products: products.map((p) => ({
            id: p.productId,
            name: p.name,
            productNumber: p.productNumber,
            unitPrice: p.unitPrice,
            vatType: p.vatType,
            incomeAccount: p.incomeAccount,
            active: p.active,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter produkter",
        };
      }
    },
  });

  const getProduct = tool({
    description: "Hent detaljert informasjon om et spesifikt produkt.",
    parameters: z.object({
      productId: z.number().describe("Produkt-ID i Fiken"),
    }),
    execute: async ({ productId }) => {
      try {
        const product = await client.getProduct(productId);
        return { success: true, product };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente produkt",
        };
      }
    },
  });

  const createProduct = tool({
    description: "Opprett et nytt produkt i Fiken. PÅKREVD: name, incomeAccount, vatType, active.",
    parameters: z.object({
      name: z.string().describe("Produktnavn (påkrevd)"),
      unitPrice: z.number().optional().describe("Enhetspris i øre (100 = 1 kr)"),
      productNumber: z.string().optional().describe("Produktnummer"),
      vatType: z.string().default("HIGH").describe("MVA-type: HIGH (25%), MEDIUM (15%), LOW (12%), NONE, EXEMPT, OUTSIDE"),
      incomeAccount: z.string().default("3000").describe("Inntektskonto (standard: 3000)"),
    }),
    execute: async ({ name, unitPrice, productNumber, vatType, incomeAccount }) => {
      try {
        const product = await client.createProduct({
          name,
          unitPrice,
          productNumber,
          vatType,
          incomeAccount,
          active: true,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Produkt opprettet: ${name} (ID: ${product.productId})`,
          product: {
            productId: product.productId,
            name: product.name,
            productNumber: product.productNumber,
            unitPrice: product.unitPrice,
            vatType: product.vatType,
            incomeAccount: product.incomeAccount,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette produkt",
        };
      }
    },
  });

  const updateProduct = tool({
    description: "Oppdater et eksisterende produkt i Fiken.",
    parameters: z.object({
      productId: z.number().describe("Produkt-ID"),
      name: z.string().describe("Produktnavn (påkrevd)"),
      unitPrice: z.number().optional().describe("Enhetspris i øre"),
      vatType: z.string().describe("MVA-type: HIGH, MEDIUM, LOW, NONE, EXEMPT, OUTSIDE"),
      incomeAccount: z.string().describe("Inntektskonto"),
      active: z.boolean().optional().describe("Er produktet aktivt?"),
    }),
    execute: async ({ productId, name, unitPrice, vatType, incomeAccount, active }) => {
      try {
        const product = await client.updateProduct(productId, {
          name,
          unitPrice,
          vatType,
          incomeAccount,
          active: active ?? true,
        });
        return {
          success: true,
          message: "Produkt oppdatert: " + name,
          product,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke oppdatere produkt",
        };
      }
    },
  });

  const deleteProduct = tool({
    description: "Slett et produkt fra Fiken.",
    parameters: z.object({
      productId: z.number().describe("Produkt-ID som skal slettes"),
    }),
    execute: async ({ productId }) => {
      try {
        await client.deleteProduct(productId);
        return { success: true, message: "Produkt ble slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette produkt",
        };
      }
    },
  });

  // ============================================
  // INVOICE TOOLS
  // ============================================

  const searchInvoices = tool({
    description: "Søk etter fakturaer i Fiken. Kan filtrere på dato, kunde, og betalingsstatus.",
    parameters: z.object({
      issueDateFrom: z.string().optional().describe("Fra utstedelsesdato (YYYY-MM-DD)"),
      issueDateTo: z.string().optional().describe("Til utstedelsesdato (YYYY-MM-DD)"),
      customerId: z.number().optional().describe("Filtrer på kunde-ID"),
      settled: z.boolean().optional().describe("Filtrer på betalt (true) eller ubetalt (false)"),
    }),
    execute: async ({ issueDateFrom, issueDateTo, customerId, settled }) => {
      try {
        const invoices = await client.getInvoices({
          issueDateGe: issueDateFrom,
          issueDateLe: issueDateTo,
          customerId,
          settled,
          pageSize: 50,
        });
        return {
          success: true,
          count: invoices.length,
          invoices: invoices.map((inv) => ({
            id: inv.invoiceId,
            invoiceNumber: inv.invoiceNumber,
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            customerName: inv.customer?.name,
            customerId: inv.customerId,
            gross: inv.gross,
            grossInNok: inv.grossInNok,
            currency: inv.currency,
            paid: inv.paid,
            settled: inv.settled,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter fakturaer",
        };
      }
    },
  });

  const getInvoice = tool({
    description: "Hent detaljert informasjon om en spesifikk faktura.",
    parameters: z.object({
      invoiceId: z.number().describe("Faktura-ID i Fiken"),
    }),
    execute: async ({ invoiceId }) => {
      try {
        const invoice = await client.getInvoice(invoiceId);
        return { success: true, invoice };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente faktura",
        };
      }
    },
  });

  const createInvoice = tool({
    description: "Opprett en ny faktura i Fiken. PÅKREVD: issueDate, dueDate, lines, bankAccountCode, cash, customerId. Alle beløp i ØRE (100 = 1 kr).",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID (bruk searchContacts for å finne denne)"),
      issueDate: z.string().describe("Fakturadato (YYYY-MM-DD)"),
      dueDate: z.string().describe("Forfallsdato (YYYY-MM-DD)"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse av vare/tjeneste"),
        unitPrice: z.number().describe("Enhetspris i øre (100 = 1 kr, 50000 = 500 kr)"),
        quantity: z.number().describe("Antall (påkrevd)"),
        vatType: z.string().optional().default("HIGH").describe("MVA-type: HIGH (25%), MEDIUM (15%), LOW (12%), NONE, EXEMPT, OUTSIDE"),
        incomeAccount: z.string().optional().default("3000").describe("Inntektskonto"),
      })).describe("Fakturalinjer"),
      bankAccountCode: z.string().describe("Bankkonto for betaling (f.eks. '1920')"),
      cash: z.boolean().default(false).describe("Er dette kontantsalg? (true = betalt umiddelbart)"),
      invoiceText: z.string().optional().describe("Tekst på fakturaen"),
      ourReference: z.string().optional().describe("Vår referanse"),
      yourReference: z.string().optional().describe("Deres referanse"),
    }),
    execute: async ({ customerId, issueDate, dueDate, lines, bankAccountCode, cash, invoiceText, ourReference, yourReference }) => {
      try {
        const invoice = await client.createInvoice({
          customerId,
          issueDate,
          dueDate,
          lines: lines.map((line) => ({
            description: line.description,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            vatType: line.vatType || "HIGH",
            incomeAccount: line.incomeAccount || "3000", // Required by Fiken API when no productId
          })),
          bankAccountCode,
          cash,
          invoiceText,
          ourReference,
          yourReference,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Faktura #${invoice.invoiceNumber} ble opprettet (ID: ${invoice.invoiceId})`,
          invoice: {
            invoiceId: invoice.invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            customerName: invoice.customer?.name,
            customerId: invoice.customerId,
            gross: invoice.gross,
            net: invoice.net,
            vat: invoice.vat,
            currency: invoice.currency,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette faktura",
        };
      }
    },
  });

  const sendInvoice = tool({
    description: "Send en faktura til kunden via e-post, EHF eller eFaktura.",
    parameters: z.object({
      invoiceId: z.number().describe("Faktura-ID"),
      method: z.enum(["email", "ehf", "efaktura"]).default("email").describe("Utsendelsesmetode"),
      emailAddress: z.string().optional().describe("Overstyr e-postadresse"),
    }),
    execute: async ({ invoiceId, method, emailAddress }) => {
      try {
        await client.sendInvoice({
          invoiceId,
          method: [method],
          includeDocumentAttachments: true,
          emailAddress,
        });
        return {
          success: true,
          message: "Faktura " + invoiceId + " ble sendt via " + method,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke sende faktura",
        };
      }
    },
  });

  // NOTE: Invoice payments are NOT handled via API endpoint.
  // Invoices have a 'settled' boolean that is updated automatically when payment is received.
  // For cash invoices, set cash=true and paymentAccount when creating the invoice.

  // Invoice Drafts
  const getInvoiceDrafts = tool({
    description: "Hent alle fakturautkast.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const drafts = await client.getInvoiceDrafts();
        return {
          success: true,
          count: drafts.length,
          drafts: drafts.map((d) => ({
            draftId: d.draftId,  // Use this for all operations (integer)
            uuid: d.uuid,       // For reference only - do NOT use for API calls
            customerId: d.customerId,
            issueDate: d.issueDate,
            daysUntilDueDate: d.daysUntilDueDate,
            lines: d.lines,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente fakturautkast",
        };
      }
    },
  });

  const createInvoiceDraft = tool({
    description: "Opprett et fakturautkast som kan redigeres før det blir en faktura.",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID"),
      daysUntilDueDate: z.number().describe("Antall dager til forfall"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse"),
        unitPrice: z.number().describe("Enhetspris i øre"),
        quantity: z.number().describe("Antall"),
        vatType: z.string().optional().default("HIGH"),
        incomeAccount: z.string().optional().default("3000"),
      })).describe("Fakturalinjer"),
      bankAccountCode: z.string().optional().describe("Bankkonto"),
      invoiceText: z.string().optional(),
    }),
    execute: async ({ customerId, daysUntilDueDate, lines, bankAccountCode, invoiceText }) => {
      try {
        const draft = await client.createInvoiceDraft({
          customerId,
          daysUntilDueDate,
          type: "invoice",
          lines: lines.map((l) => ({
            description: l.description,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            vatType: l.vatType || "HIGH",
            incomeAccount: l.incomeAccount || "3000", // Required by Fiken API when no productId
          })),
          bankAccountCode,
          invoiceText,
        });
        return {
          success: true,
          message: "Fakturautkast opprettet",
          draft,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette fakturautkast",
        };
      }
    },
  });

  const createInvoiceFromDraft = tool({
    description: "Opprett en faktura fra et eksisterende utkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getInvoiceDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        // First fetch the draft to check if lines have incomeAccount
        const draft = await client.getInvoiceDraft(draftId);
        
        // Check if any lines are missing incomeAccount or vatType
        const needsUpdate = draft.lines?.some((line) => !line.incomeAccount || !line.vatType);
        
        // Get customerId from draft - might be in customerId or in customer object
        const customerId = draft.customerId || (draft.customer as { contactId?: number })?.contactId;
        const daysUntilDueDate = draft.daysUntilDueDate ?? 14; // Default to 14 days if not set
        
        if (needsUpdate) {
          if (!customerId) {
            return {
              success: false,
              error: "Kunne ikke finne kunde-ID på utkastet. Slett utkastet og opprett et nytt med kunde.",
            };
          }
          
          // Update draft with default incomeAccount/vatType on lines that are missing them
          try {
            await client.updateInvoiceDraft(draftId, {
              customerId,
              daysUntilDueDate,
              type: draft.type === "cash_invoice" ? "cash_invoice" : "invoice",
              lines: draft.lines?.map((line) => ({
                description: line.description,
                unitPrice: line.unitPrice,
                quantity: line.quantity || 1,
                vatType: line.vatType || "HIGH",
                incomeAccount: line.incomeAccount || "3000", // Default if missing
              })),
              bankAccountCode: draft.bankAccountCode,
              invoiceText: draft.invoiceText,
              yourReference: draft.yourReference,
              ourReference: draft.ourReference,
              currency: draft.currency,
              projectId: draft.projectId,
            });
          } catch (updateError) {
            return {
              success: false,
              error: `Kunne ikke oppdatere utkast med manglende kontoinformasjon: ${updateError instanceof Error ? updateError.message : "Ukjent feil"}`,
            };
          }
        }
        
        const invoice = await client.createInvoiceFromDraft(draftId);
        return {
          success: true,
          message: "Faktura #" + invoice.invoiceNumber + " opprettet fra utkast",
          invoice,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette faktura fra utkast",
        };
      }
    },
  });

  const deleteInvoiceDraft = tool({
    description: "Slett et fakturautkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getInvoiceDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        await client.deleteInvoiceDraft(draftId);
        return { success: true, message: "Fakturautkast slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette fakturautkast",
        };
      }
    },
  });

  // ============================================
  // PURCHASE TOOLS
  // ============================================

  const searchPurchases = tool({
    description: "Søk etter kjøp/leverandørfakturaer i Fiken.",
    parameters: z.object({
      dateFrom: z.string().optional().describe("Fra dato (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("Til dato (YYYY-MM-DD)"),
    }),
    execute: async ({ dateFrom, dateTo }) => {
      try {
        const purchases = await client.getPurchases({
          dateGe: dateFrom,
          dateLe: dateTo,
          pageSize: 50,
        });
        return {
          success: true,
          count: purchases.length,
          purchases: purchases.map((p) => ({
            id: p.purchaseId,
            identifier: p.identifier,
            date: p.date,
            dueDate: p.dueDate,
            supplierName: p.supplier?.name,
            supplierId: p.supplierId,
            paid: p.paid,
            currency: p.currency,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter kjøp",
        };
      }
    },
  });

  const getPurchase = tool({
    description: "Hent detaljert informasjon om et spesifikt kjøp.",
    parameters: z.object({
      purchaseId: z.number().describe("Kjøp-ID i Fiken"),
    }),
    execute: async ({ purchaseId }) => {
      try {
        const purchase = await client.getPurchase(purchaseId);
        return { success: true, purchase };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kjøp",
        };
      }
    },
  });

  const createPurchase = tool({
    description: `Registrer et nytt kjøp/leverandørfaktura i Fiken.

VIKTIG: Kall getUnmatchedBankTransactions FØR dette for å sjekke bankmatching!

PÅKREVD: date, kind, paid, lines, currency.
- For kontantkjøp (betalt): kind='cash_purchase', paid=true
- For leverandørfaktura (ubetalt): kind='supplier', paid=false, dueDate

SMART BANKKONTO-LOGIKK:
- Hvis paymentAccount IKKE oppgis og kind='cash_purchase':
  - Henter automatisk bankkontoer
  - Hvis kun 1 bankkonto: bruker den automatisk
  - Hvis flere: returnerer requiresSelection med liste
- Oppgi paymentAccount for å spesifisere bankkonto direkte`,
    parameters: z.object({
      date: z.string().describe("Kjøpsdato (YYYY-MM-DD)"),
      kind: z.enum(["cash_purchase", "supplier"]).describe("Type: 'cash_purchase' (kontantkjøp/betalt) eller 'supplier' (leverandørfaktura/ubetalt)"),
      paid: z.boolean().describe("Er kjøpet betalt? (true for cash_purchase, false for supplier)"),
      currency: z.string().default("NOK").describe("Valuta (standard: NOK)"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse av vare/tjeneste"),
        netPrice: z.number().describe("Nettopris i øre UTEN MVA (100 = 1 kr). For 1000 kr inkl. 25% MVA: netPrice = 80000 (800 kr)"),
        vatType: z.string().describe("MVA-type: HIGH (25%), MEDIUM (15%), LOW (12%), NONE (0%), EXEMPT (fritatt)"),
        account: z.string().optional().describe("Kostnadskonto (f.eks. 6300=leie, 4000=varekjøp, 6540=inventar)"),
      })).describe("Kjøpslinjer"),
      supplierId: z.number().optional().describe("Leverandør-ID (søk med searchContacts supplier=true)"),
      identifier: z.string().optional().describe("Fakturanummer fra leverandør"),
      dueDate: z.string().optional().describe("Forfallsdato (YYYY-MM-DD) - påkrevd for supplier"),
      paymentAccount: z.string().optional().describe("Bankkonto for betaling (f.eks. '1920:10001'). Hvis ikke oppgitt for cash_purchase, velges automatisk eller du får valg."),
      paymentDate: z.string().optional().describe("Betalingsdato hvis betalt"),
      projectId: z.number().optional().describe("Prosjekt-ID for kostnadsføring"),
    }),
    execute: async ({ date, kind, paid, currency, lines, supplierId, identifier, dueDate, paymentAccount, paymentDate, projectId }) => {
      try {
        // SMART BANKKONTO-LOGIKK for kontantkjøp
        let effectivePaymentAccount = paymentAccount;
        
        if (kind === "cash_purchase" && !paymentAccount) {
          // Hent bankkontoer automatisk
          const bankAccounts = await client.getBankAccounts();
          const activeBankAccounts = bankAccounts.filter(a => !a.inactive);
          
          if (activeBankAccounts.length === 0) {
            return {
              success: false,
              error: "Ingen aktive bankkontoer funnet. Opprett en bankkonto først, eller oppgi paymentAccount manuelt.",
            };
          } else if (activeBankAccounts.length === 1) {
            // Kun én bankkonto - bruk den automatisk
            effectivePaymentAccount = activeBankAccounts[0].accountCode;
          } else {
            // Flere bankkontoer - returner liste så AI kan spørre bruker
            return {
              success: false,
              requiresSelection: true,
              selectionType: "bankAccount",
              options: activeBankAccounts.map(a => ({
                accountCode: a.accountCode,
                name: a.name,
                bankAccountNumber: a.bankAccountNumber,
              })),
              message: `Flere bankkontoer funnet (${activeBankAccounts.length} stk). Spør bruker hvilken som ble brukt for denne betalingen, og kall createPurchase igjen med paymentAccount satt til 'accountCode'-verdien fra valgt konto.`,
            };
          }
        }
        
        // Calculate VAT for each line based on vatType
        const vatRates: Record<string, number> = {
          "HIGH": 0.25,
          "MEDIUM": 0.15,
          "LOW": 0.12,
          "RAW_FISH": 0.1111,
          "NONE": 0,
          "EXEMPT": 0,
          "HIGH_DIRECT": 0.25,
          "HIGH_BASIS": 0.25,
          "MEDIUM_DIRECT": 0.15,
          "MEDIUM_BASIS": 0.15,
        };
        
        const linesWithVat = lines.map((l) => {
          const rate = vatRates[l.vatType] ?? 0;
          const vat = Math.round(l.netPrice * rate);
          return {
            description: l.description,
            vatType: l.vatType,
            netPrice: l.netPrice,
            vat: vat,
            account: l.account,
          };
        });
        
        const requestBody = {
          date,
          kind,
          paid,
          currency,
          lines: linesWithVat,
          supplierId,
          dueDate,
          paymentAccount: effectivePaymentAccount,
          // If paid with paymentAccount but no paymentDate, use the purchase date
          paymentDate: paymentDate || (paid && effectivePaymentAccount ? date : undefined),
          kid: identifier,
          projectId,
        };
        
        const purchase = await client.createPurchase(requestBody);
        
        return {
          success: true,
          _operationComplete: true,
          message: `Kjøp registrert (ID: ${purchase.purchaseId})`,
          purchase: {
            purchaseId: purchase.purchaseId,
            transactionId: purchase.transactionId,
            identifier: purchase.identifier,
            date: purchase.date,
            paid: purchase.paid,
            currency: purchase.currency,
          },
          paymentAccount: effectivePaymentAccount,
        };
      } catch (error) {
        console.error("createPurchase ERROR:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke registrere kjøp",
        };
      }
    },
  });

  const deletePurchase = tool({
    description: "Slett et kjøp fra Fiken.",
    parameters: z.object({
      purchaseId: z.number().describe("Kjøp-ID som skal slettes"),
      description: z.string().describe("Begrunnelse for sletting"),
    }),
    execute: async ({ purchaseId, description }) => {
      try {
        await client.deletePurchase(purchaseId, description);
        return { success: true, message: "Kjøp slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette kjøp",
        };
      }
    },
  });

  const addPurchasePayment = tool({
    description: "Registrer betaling på en leverandørfaktura.",
    parameters: z.object({
      purchaseId: z.number().describe("Kjøp-ID"),
      date: z.string().describe("Betalingsdato (YYYY-MM-DD)"),
      amount: z.number().describe("Beløp i øre"),
      account: z.string().describe("Bankkonto (f.eks. '1920')"),
    }),
    execute: async ({ purchaseId, date, amount, account }) => {
      try {
        const payment = await client.addPurchasePayment(purchaseId, { date, amount, account });
        return {
          success: true,
          message: "Betaling på " + (amount / 100) + " kr registrert",
          payment,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke registrere betaling",
        };
      }
    },
  });

  // Purchase Drafts
  const getPurchaseDrafts = tool({
    description: "Hent alle kjøpsutkast.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const drafts = await client.getPurchaseDrafts();
        return { success: true, count: drafts.length, drafts };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kjøpsutkast",
        };
      }
    },
  });

  const createPurchaseDraft = tool({
    description: "Opprett et kjøpsutkast. Krever text, vatType, account, net, gross for hver linje.",
    parameters: z.object({
      cash: z.boolean().describe("Er dette kontantkjøp?"),
      paid: z.boolean().describe("Er det betalt?"),
      lines: z.array(z.object({
        text: z.string().describe("Beskrivelse"),
        vatType: z.string().describe("MVA-type"),
        account: z.string().describe("Kostnadskonto"),
        net: z.number().describe("Netto i øre"),
        gross: z.number().describe("Brutto i øre"),
      })),
      supplierId: z.number().optional(),
      date: z.string().optional(),
      dueDate: z.string().optional(),
    }),
    execute: async ({ cash, paid, lines, supplierId, date, dueDate }) => {
      try {
        const draft = await client.createPurchaseDraft({
          cash,
          paid,
          lines: lines.map((l) => ({
            text: l.text,
            vatType: l.vatType,
            account: l.account,
            net: l.net,
            gross: l.gross,
          })),
          supplierId,
          date,
          dueDate,
        });
        return { success: true, message: "Kjøpsutkast opprettet", draft };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette kjøpsutkast",
        };
      }
    },
  });

  const createPurchaseFromDraft = tool({
    description: "Opprett et kjøp fra et eksisterende utkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getPurchaseDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        const purchase = await client.createPurchaseFromDraft(draftId);
        return { success: true, message: "Kjøp opprettet fra utkast", purchase };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette kjøp fra utkast",
        };
      }
    },
  });

  const deletePurchaseDraft = tool({
    description: "Slett et kjøpsutkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getPurchaseDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        await client.deletePurchaseDraft(draftId);
        return { success: true, message: "Kjøpsutkast slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette kjøpsutkast",
        };
      }
    },
  });

  // ============================================
  // SALES TOOLS (Annet salg)
  // ============================================

  const searchSales = tool({
    description: "Søk etter salg (annet salg, ikke faktura) i Fiken.",
    parameters: z.object({
      dateFrom: z.string().optional().describe("Fra dato (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("Til dato (YYYY-MM-DD)"),
    }),
    execute: async ({ dateFrom, dateTo }) => {
      try {
        const sales = await client.getSales({
          dateGe: dateFrom,
          dateLe: dateTo,
          pageSize: 50,
        });
        return {
          success: true,
          count: sales.length,
          sales: sales.map((s) => ({
            id: s.saleId,
            date: s.date,
            totalPaid: s.totalPaid,
            settled: s.settled,
            grossAmount: s.grossAmount,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter salg",
        };
      }
    },
  });

  const getSale = tool({
    description: "Hent detaljert informasjon om et spesifikt salg.",
    parameters: z.object({
      saleId: z.number().describe("Salg-ID i Fiken"),
    }),
    execute: async ({ saleId }) => {
      try {
        const sale = await client.getSale(saleId);
        return { success: true, sale };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente salg",
        };
      }
    },
  });

  const createSale = tool({
    description: "Opprett et nytt salg (annet salg, ikke faktura). KRITISK: Kall ALLTID suggestAccounts FØRST, vis 3 forslag til brukeren, og VENT på brukerens valg før du registrerer! Bruk dette for kontantsalg uten faktura. PÅKREVD: date, kind, paid, lines, currency.",
    parameters: z.object({
      date: z.string().describe("Salgsdato (YYYY-MM-DD)"),
      kind: z.enum(["cash_sale", "external_invoice"]).default("cash_sale").describe("Type salg"),
      paid: z.boolean().describe("Er salget betalt?"),
      currency: z.string().default("NOK").describe("Valuta"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse"),
        netAmount: z.number().optional().describe("Nettobeløp i øre"),
        grossAmount: z.number().optional().describe("Bruttobeløp i øre"),
        vatType: z.string().default("HIGH").describe("MVA-type: HIGH, MEDIUM, LOW, NONE, EXEMPT, OUTSIDE"),
        incomeAccount: z.string().default("3000").describe("Inntektskonto"),
      })),
      paymentAccount: z.string().optional().describe("Bankkonto for betaling"),
      paymentDate: z.string().optional().describe("Betalingsdato"),
      contactId: z.number().optional().describe("Kunde-ID hvis relevant"),
      projectId: z.number().optional().describe("Prosjekt-ID"),
    }),
    execute: async ({ date, kind, paid, currency, lines, paymentAccount, paymentDate, contactId, projectId }) => {
      try {
        const sale = await client.createSale({
          date,
          kind,
          paid,
          currency,
          lines: lines.map((l) => ({
            description: l.description,
            vatType: l.vatType,
            netAmount: l.netAmount,
            grossAmount: l.grossAmount,
            incomeAccount: l.incomeAccount,
          })),
          paymentAccount,
          paymentDate,
          contactId,
          projectId,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Salg registrert (ID: ${sale.saleId})`,
          sale: {
            saleId: sale.saleId,
            transactionId: sale.transactionId,
            date: sale.date,
            settled: sale.settled,
            totalPaid: sale.totalPaid,
            grossAmount: sale.grossAmount,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke registrere salg",
        };
      }
    },
  });

  const settleSale = tool({
    description: "Marker et salg som oppgjort.",
    parameters: z.object({
      saleId: z.number().describe("Salg-ID"),
      settledDate: z.string().describe("Oppgjørsdato (YYYY-MM-DD)"),
    }),
    execute: async ({ saleId, settledDate }) => {
      try {
        await client.settleSale(saleId, settledDate);
        return { success: true, message: "Salg markert som oppgjort" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke gjøre opp salg",
        };
      }
    },
  });

  const deleteSale = tool({
    description: "Slett et salg fra Fiken.",
    parameters: z.object({
      saleId: z.number().describe("Salg-ID"),
      description: z.string().describe("Begrunnelse for sletting"),
    }),
    execute: async ({ saleId, description }) => {
      try {
        await client.deleteSale(saleId, description);
        return { success: true, message: "Salg slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette salg",
        };
      }
    },
  });

  const addSalePayment = tool({
    description: "Registrer betaling på et salg.",
    parameters: z.object({
      saleId: z.number().describe("Salg-ID"),
      date: z.string().describe("Betalingsdato (YYYY-MM-DD)"),
      amount: z.number().describe("Beløp i øre"),
      account: z.string().describe("Bankkonto"),
    }),
    execute: async ({ saleId, date, amount, account }) => {
      try {
        const payment = await client.addSalePayment(saleId, { date, amount, account });
        return { success: true, message: "Betaling registrert på salg", payment };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke registrere betaling",
        };
      }
    },
  });

  // ============================================
  // OFFER TOOLS (Tilbud)
  // ============================================

  const searchOffers = tool({
    description: "Søk etter tilbud i Fiken.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const offers = await client.getOffers({ pageSize: 50 });
        return {
          success: true,
          count: offers.length,
          offers: offers.map((o) => ({
            id: o.offerId,
            offerNumber: o.offerNumber,
            issueDate: o.issueDate,
            customerName: o.customer?.name,
            gross: o.gross,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter tilbud",
        };
      }
    },
  });

  const getOffer = tool({
    description: "Hent detaljert informasjon om et tilbud.",
    parameters: z.object({
      offerId: z.number().describe("Tilbud-ID"),
    }),
    execute: async ({ offerId }) => {
      try {
        const offer = await client.getOffer(offerId);
        return { success: true, offer };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente tilbud",
        };
      }
    },
  });

  const getOfferDrafts = tool({
    description: "Hent alle tilbudsutkast.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const drafts = await client.getOfferDrafts();
        return { success: true, count: drafts.length, drafts };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente tilbudsutkast",
        };
      }
    },
  });

  const createOfferDraft = tool({
    description: "Opprett et tilbudsutkast. Tilbud -> Ordrebekreftelse -> Faktura er en vanlig arbeidsflyt.",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID"),
      daysUntilDueDate: z.number().default(14).describe("Dager til forfall"),
      lines: z.array(z.object({
        description: z.string(),
        unitPrice: z.number().describe("Enhetspris i øre"),
        quantity: z.number(),
        vatType: z.string().optional().default("HIGH"),
        incomeAccount: z.string().optional().default("3000"),
      })),
      offerText: z.string().optional().describe("Tekst på tilbudet"),
      ourReference: z.string().optional(),
      yourReference: z.string().optional(),
    }),
    execute: async ({ customerId, daysUntilDueDate, lines, offerText, ourReference, yourReference }) => {
      try {
        const draft = await client.createOfferDraft({
          customerId,
          daysUntilDueDate,
          type: "offer",
          lines: lines.map((l) => ({
            description: l.description,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            vatType: l.vatType,
            incomeAccount: l.incomeAccount,
          })),
          offerText,
          ourReference,
          yourReference,
        });
        return { success: true, message: "Tilbudsutkast opprettet", draft };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette tilbudsutkast",
        };
      }
    },
  });

  const createOfferFromDraft = tool({
    description: "Opprett et tilbud fra et utkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOfferDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        const offer = await client.createOfferFromDraft(draftId);
        return {
          success: true,
          message: "Tilbud #" + offer.offerNumber + " opprettet",
          offer,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette tilbud fra utkast",
        };
      }
    },
  });

  const deleteOfferDraft = tool({
    description: "Slett et tilbudsutkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOfferDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        await client.deleteOfferDraft(draftId);
        return { success: true, message: "Tilbudsutkast slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette tilbudsutkast",
        };
      }
    },
  });

  // ============================================
  // ORDER CONFIRMATION TOOLS (Ordrebekreftelser)
  // ============================================

  const searchOrderConfirmations = tool({
    description: "Søk etter ordrebekreftelser i Fiken.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const confirmations = await client.getOrderConfirmations({ pageSize: 50 });
        return {
          success: true,
          count: confirmations.length,
          orderConfirmations: confirmations.map((oc) => ({
            id: oc.confirmationId,
            confirmationNumber: oc.confirmationNumber,
            issueDate: oc.issueDate,
            customerName: oc.customer?.name,
            gross: oc.gross,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter ordrebekreftelser",
        };
      }
    },
  });

  const getOrderConfirmation = tool({
    description: "Hent detaljert informasjon om en ordrebekreftelse.",
    parameters: z.object({
      orderConfirmationId: z.number().describe("Ordrebekreftelse-ID"),
    }),
    execute: async ({ orderConfirmationId }) => {
      try {
        const confirmation = await client.getOrderConfirmation(orderConfirmationId);
        return { success: true, orderConfirmation: confirmation };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente ordrebekreftelse",
        };
      }
    },
  });

  const getOrderConfirmationDrafts = tool({
    description: "Hent alle ordrebekreftelsesutkast.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const drafts = await client.getOrderConfirmationDrafts();
        return { success: true, count: drafts.length, drafts };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente ordrebekreftelsesutkast",
        };
      }
    },
  });

  const createOrderConfirmationDraft = tool({
    description: "Opprett et ordrebekreftelsesutkast.",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID"),
      daysUntilDueDate: z.number().default(14).describe("Dager til forfall"),
      lines: z.array(z.object({
        description: z.string(),
        unitPrice: z.number().describe("Enhetspris i øre"),
        quantity: z.number(),
        vatType: z.string().optional().default("HIGH"),
        incomeAccount: z.string().optional().default("3000"),
      })),
      orderConfirmationText: z.string().optional(),
      ourReference: z.string().optional(),
      yourReference: z.string().optional(),
    }),
    execute: async ({ customerId, daysUntilDueDate, lines, orderConfirmationText, ourReference, yourReference }) => {
      try {
        const draft = await client.createOrderConfirmationDraft({
          customerId,
          daysUntilDueDate,
          type: "order_confirmation",
          lines: lines.map((l) => ({
            description: l.description,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            vatType: l.vatType,
            incomeAccount: l.incomeAccount,
          })),
          orderConfirmationText,
          ourReference,
          yourReference,
        });
        return { success: true, message: "Ordrebekreftelsesutkast opprettet", draft };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette ordrebekreftelsesutkast",
        };
      }
    },
  });

  const createOrderConfirmationFromDraft = tool({
    description: "Opprett en ordrebekreftelse fra et utkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOrderConfirmationDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        const confirmation = await client.createOrderConfirmationFromDraft(draftId);
        return {
          success: true,
          message: "Ordrebekreftelse #" + confirmation.confirmationNumber + " opprettet",
          orderConfirmation: confirmation,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette ordrebekreftelse fra utkast",
        };
      }
    },
  });

  const deleteOrderConfirmationDraft = tool({
    description: "Slett et ordrebekreftelsesutkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOrderConfirmationDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        await client.deleteOrderConfirmationDraft(draftId);
        return { success: true, message: "Ordrebekreftelsesutkast slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette ordrebekreftelsesutkast",
        };
      }
    },
  });

  const createInvoiceFromOrderConfirmation = tool({
    description: "Opprett et fakturautkast fra en ordrebekreftelse. Nyttig arbeidsflyt: Tilbud -> Ordrebekreftelse -> Faktura.",
    parameters: z.object({
      orderConfirmationId: z.number().describe("Ordrebekreftelse-ID"),
    }),
    execute: async ({ orderConfirmationId }) => {
      try {
        const invoiceDraft = await client.createInvoiceDraftFromOrderConfirmation(orderConfirmationId);
        return {
          success: true,
          message: "Fakturautkast opprettet fra ordrebekreftelse",
          invoiceDraft,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette fakturautkast fra ordrebekreftelse",
        };
      }
    },
  });

  // ============================================
  // CREDIT NOTE TOOLS
  // ============================================

  const searchCreditNotes = tool({
    description: "Søk etter kreditnotaer i Fiken.",
    parameters: z.object({
      settled: z.boolean().optional().describe("Filtrer på oppgjort/uoppgjort"),
      customerId: z.number().optional().describe("Filtrer på kunde-ID"),
    }),
    execute: async ({ settled, customerId }) => {
      try {
        const creditNotes = await client.getCreditNotes({ settled, customerId });
        return {
          success: true,
          count: creditNotes.length,
          creditNotes: creditNotes.map((cn) => ({
            id: cn.creditNoteId,
            creditNoteNumber: cn.creditNoteNumber,
            issueDate: cn.issueDate,
            customerName: cn.customer?.name,
            gross: cn.gross,
            settled: cn.settled,
            associatedInvoiceId: cn.associatedInvoiceId,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter kreditnotaer",
        };
      }
    },
  });

  const getCreditNote = tool({
    description: "Hent detaljert informasjon om en kreditnota.",
    parameters: z.object({
      creditNoteId: z.number().describe("Kreditnota-ID"),
    }),
    execute: async ({ creditNoteId }) => {
      try {
        const creditNote = await client.getCreditNote(creditNoteId);
        return { success: true, creditNote };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kreditnota",
        };
      }
    },
  });

  const createFullCreditNote = tool({
    description: "Opprett en full kreditnota for hele fakturabeløpet.",
    parameters: z.object({
      invoiceId: z.number().describe("Faktura-ID som skal krediteres"),
      issueDate: z.string().describe("Utstedelsesdato (YYYY-MM-DD)"),
      creditNoteText: z.string().optional().describe("Tekst på kreditnotaen"),
    }),
    execute: async ({ invoiceId, issueDate, creditNoteText }) => {
      try {
        const creditNote = await client.createFullCreditNote({
          invoiceId,
          issueDate,
          creditNoteText,
        });
        return {
          success: true,
          message: "Full kreditnota #" + creditNote.creditNoteNumber + " opprettet",
          creditNote,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette kreditnota",
        };
      }
    },
  });

  const createPartialCreditNote = tool({
    description: "Opprett en delvis kreditnota for deler av fakturabeløpet.",
    parameters: z.object({
      invoiceId: z.number().optional().describe("Faktura-ID som skal krediteres"),
      customerId: z.number().optional().describe("Kunde-ID hvis ikke knyttet til faktura"),
      issueDate: z.string().describe("Utstedelsesdato (YYYY-MM-DD)"),
      lines: z.array(z.object({
        description: z.string().optional().describe("Beskrivelse av det som krediteres"),
        unitPrice: z.number().describe("Enhetspris i øre (positivt tall)"),
        quantity: z.number().describe("Antall"),
        vatType: z.string().optional().default("HIGH"),
        incomeAccount: z.string().optional().default("3000"),
      })).describe("Linjer som skal krediteres"),
      creditNoteText: z.string().optional(),
    }),
    execute: async ({ invoiceId, customerId, issueDate, lines, creditNoteText }) => {
      try {
        const creditNote = await client.createPartialCreditNote({
          issueDate,
          lines: lines.map((l) => ({
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            description: l.description,
            vatType: l.vatType,
            incomeAccount: l.incomeAccount,
          })),
          creditNoteText,
          invoiceId,
          customerId,
        });
        return {
          success: true,
          message: "Delvis kreditnota #" + creditNote.creditNoteNumber + " opprettet",
          creditNote,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette delvis kreditnota",
        };
      }
    },
  });

  const sendCreditNote = tool({
    description: "Send en kreditnota til kunden.",
    parameters: z.object({
      creditNoteId: z.number().describe("Kreditnota-ID"),
      method: z.enum(["email", "ehf", "efaktura"]).default("email").describe("Utsendelsesmetode"),
      emailAddress: z.string().optional().describe("Overstyr e-postadresse"),
    }),
    execute: async ({ creditNoteId, method, emailAddress }) => {
      try {
        await client.sendCreditNote({
          creditNoteId,
          method: [method],
          includeDocumentAttachments: true,
          emailAddress,
        });
        return { success: true, message: "Kreditnota sendt via " + method };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke sende kreditnota",
        };
      }
    },
  });

  // ============================================
  // COUNTER TOOLS (CRITICAL for new companies)
  // ============================================

  const getInvoiceCounter = tool({
    description: "Hent nåværende fakturateller. Returnerer feil hvis telleren ikke er initialisert.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getInvoiceCounter();
        return {
          success: true,
          counter: counter.value,
          message: "Neste fakturanummer blir " + (counter.value + 1),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Fakturateller ikke funnet - må initialiseres først",
        };
      }
    },
  });

  const initializeInvoiceCounter = tool({
    description: "Initialiser fakturatelleren for selskapet. PÅKREVD før du kan opprette fakturaer. Standard startverdien er 10000, som betyr at første faktura blir 10001.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi for telleren (standard: 10000, første faktura blir 10001)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createInvoiceCounter(startValue);
        return {
          success: true,
          message: "Fakturateller initialisert. Første fakturanummer blir " + (counter.value + 1),
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Kunne ikke initialisere fakturateller";
        // Check if already initialized
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return {
            success: false,
            error: "Fakturateller er allerede initialisert",
          };
        }
        return { success: false, error: errorMsg };
      }
    },
  });

  const getCreditNoteCounter = tool({
    description: "Hent nåværende kreditnotateller. Returnerer feil hvis telleren ikke er initialisert.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getCreditNoteCounter();
        return {
          success: true,
          counter: counter.value,
          message: "Neste kreditnotanummer blir " + (counter.value + 1),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kreditnotateller ikke funnet - må initialiseres først",
        };
      }
    },
  });

  const initializeCreditNoteCounter = tool({
    description: "Initialiser kreditnotatelleren for selskapet. PÅKREVD før du kan opprette kreditnotaer. Standard startverdien er 10000.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi for telleren (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createCreditNoteCounter(startValue);
        return {
          success: true,
          message: "Kreditnotateller initialisert. Første kreditnotanummer blir " + (counter.value + 1),
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Kunne ikke initialisere kreditnotateller";
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return {
            success: false,
            error: "Kreditnotateller er allerede initialisert",
          };
        }
        return { success: false, error: errorMsg };
      }
    },
  });

  const getOfferCounter = tool({
    description: "Hent nåværende tilbudsteller. Returnerer feil hvis telleren ikke er initialisert.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getOfferCounter();
        return {
          success: true,
          counter: counter.value,
          message: "Neste tilbudsnummer blir " + (counter.value + 1),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Tilbudsteller ikke funnet - må initialiseres først",
        };
      }
    },
  });

  const initializeOfferCounter = tool({
    description: "Initialiser tilbudstelleren for selskapet. PÅKREVD før du kan opprette tilbud. Standard startverdien er 10000.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi for telleren (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createOfferCounter(startValue);
        return {
          success: true,
          message: "Tilbudsteller initialisert. Første tilbudsnummer blir " + (counter.value + 1),
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Kunne ikke initialisere tilbudsteller";
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return {
            success: false,
            error: "Tilbudsteller er allerede initialisert",
          };
        }
        return { success: false, error: errorMsg };
      }
    },
  });

  const getOrderConfirmationCounter = tool({
    description: "Hent nåværende ordrebekreftelsesteller. Returnerer feil hvis telleren ikke er initialisert.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getOrderConfirmationCounter();
        return {
          success: true,
          counter: counter.value,
          message: "Neste ordrebekreftelsesnummer blir " + (counter.value + 1),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Ordrebekreftelsesteller ikke funnet - må initialiseres først",
        };
      }
    },
  });

  const initializeOrderConfirmationCounter = tool({
    description: "Initialiser ordrebekreftelsestelleren for selskapet. PÅKREVD før du kan opprette ordrebekreftelser. Standard startverdien er 10000.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi for telleren (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createOrderConfirmationCounter(startValue);
        return {
          success: true,
          message: "Ordrebekreftelsesteller initialisert. Første ordrebekreftelsesnummer blir " + (counter.value + 1),
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Kunne ikke initialisere ordrebekreftelsesteller";
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return {
            success: false,
            error: "Ordrebekreftelsesteller er allerede initialisert",
          };
        }
        return { success: false, error: errorMsg };
      }
    },
  });

  const checkAndInitializeCounters = tool({
    description: "Sjekk og initialiser alle tellere for selskapet. Nyttig for nye selskaper som ikke har opprettet dokumenter før. Returnerer status for alle tellere.",
    parameters: z.object({
      initializeMissing: z.boolean().default(true).describe("Initialiser manglende tellere automatisk"),
    }),
    execute: async ({ initializeMissing }) => {
      const results: Record<string, { initialized: boolean; value?: number; error?: string }> = {};

      // Check invoice counter
      try {
        const counter = await client.getInvoiceCounter();
        results.invoices = { initialized: true, value: counter.value };
      } catch {
        if (initializeMissing) {
          try {
            const counter = await client.createInvoiceCounter(10000);
            results.invoices = { initialized: true, value: counter.value };
          } catch (e) {
            results.invoices = { initialized: false, error: e instanceof Error ? e.message : "Feil" };
          }
        } else {
          results.invoices = { initialized: false };
        }
      }

      // Check credit note counter
      try {
        const counter = await client.getCreditNoteCounter();
        results.creditNotes = { initialized: true, value: counter.value };
      } catch {
        if (initializeMissing) {
          try {
            const counter = await client.createCreditNoteCounter(10000);
            results.creditNotes = { initialized: true, value: counter.value };
          } catch (e) {
            results.creditNotes = { initialized: false, error: e instanceof Error ? e.message : "Feil" };
          }
        } else {
          results.creditNotes = { initialized: false };
        }
      }

      // Check offer counter
      try {
        const counter = await client.getOfferCounter();
        results.offers = { initialized: true, value: counter.value };
      } catch {
        if (initializeMissing) {
          try {
            const counter = await client.createOfferCounter(10000);
            results.offers = { initialized: true, value: counter.value };
          } catch (e) {
            results.offers = { initialized: false, error: e instanceof Error ? e.message : "Feil" };
          }
        } else {
          results.offers = { initialized: false };
        }
      }

      // Check order confirmation counter
      try {
        const counter = await client.getOrderConfirmationCounter();
        results.orderConfirmations = { initialized: true, value: counter.value };
      } catch {
        if (initializeMissing) {
          try {
            const counter = await client.createOrderConfirmationCounter(10000);
            results.orderConfirmations = { initialized: true, value: counter.value };
          } catch (e) {
            results.orderConfirmations = { initialized: false, error: e instanceof Error ? e.message : "Feil" };
          }
        } else {
          results.orderConfirmations = { initialized: false };
        }
      }

      const allInitialized = Object.values(results).every((r) => r.initialized);

      return {
        success: true,
        allInitialized,
        counters: results,
        message: allInitialized
          ? "Alle tellere er initialisert og klare til bruk"
          : "Noen tellere mangler initialisering",
      };
    },
  });

  // ============================================
  // ACCOUNT & BALANCE TOOLS
  // ============================================

  const getAccounts = tool({
    description: "Hent liste over regnskapskontoer fra kontoplanen. For å finne riktig konto basert på beskrivelse, bruk suggestAccounts i stedet. Bruk fromAccount/toAccount for å begrense (f.eks. '6000'/'7999' for driftskostnader).",
    parameters: z.object({
      fromAccount: z.string().optional().describe("Fra kontonummer"),
      toAccount: z.string().optional().describe("Til kontonummer"),
    }),
    execute: async ({ fromAccount, toAccount }) => {
      try {
        const accounts = await client.getAccounts({ fromAccount, toAccount });
        return {
          success: true,
          count: accounts.length,
          accounts: accounts.map((a) => ({ code: a.code, name: a.name })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kontoer",
        };
      }
    },
  });

  const getAccountBalances = tool({
    description: "Hent saldoer for regnskapskontoer på en gitt dato.",
    parameters: z.object({
      date: z.string().describe("Dato for saldoer (YYYY-MM-DD)"),
      fromAccount: z.string().optional().describe("Fra kontonummer"),
      toAccount: z.string().optional().describe("Til kontonummer"),
    }),
    execute: async ({ date, fromAccount, toAccount }) => {
      try {
        const balances = await client.getAccountBalances({ date, fromAccount, toAccount, pageSize: 100 });
        return {
          success: true,
          date,
          count: balances.length,
          balances: balances.map((b) => ({
            code: b.code,
            name: b.name,
            balance: b.balance,
            balanceInNok: b.balanceInNok,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kontosaldoer",
        };
      }
    },
  });

  // ============================================
  // ACCOUNT SUGGESTION TOOL (AI-basert)
  // ============================================

  const suggestAccounts = tool({
    description: `Finn de mest relevante kontoene for en utgift eller inntekt.
Bruker AI til å analysere beskrivelsen og velge fra selskapets kontoplan.

ARBEIDSFLYT:
1. Kall dette verktøyet med beskrivelse av utgift/inntekt
2. VIS de 3 forslagene til brukeren (inkludert reason, MVA-info og vatNote)
3. Hvis vatNote finnes - FØLG instruksjonen (f.eks. spør om innenlands/utenlands)
4. VENT på brukerens valg (1, 2 eller 3) OG svar på eventuelle oppfølgingsspørsmål
5. ⛔ MVA-REGEL - IKKE spør om inkl/ekskl MVA hvis:
   - Brukeren har skrevet "inkl. MVA", "(inkl. 25% MVA)" eller lignende
   - Brukeren har oppgitt MVA-beløp (f.eks. "MVA: 107 kr")
   - Du har lest MVA-info fra kvittering/faktura
   → I disse tilfellene VET DU ALLEREDE SVARET - ikke spør!
   → KUN spør hvis MVA-info er HELT ukjent
6. Registrer med valgt konto og riktig MVA-behandling

Verktøyet returnerer:
- reason: Kort forklaring
- vatDeductible: Om kontoen har MVA-fradrag
- vatNote: VIKTIG veiledning om MVA eller spørsmål som MÅ avklares`,
    parameters: z.object({
      description: z.string().describe("Beskrivelse av utgift/inntekt (f.eks. 'flyreise til Oslo', 'kundemiddag', 'programvare')"),
      accountType: z.enum(["expense", "income"]).describe("'expense' for kostnader (4000-7999), 'income' for inntekter (3000-3999)"),
    }),
    execute: async ({ description, accountType }) => {
      try {
        const result = await accountHelper.suggestAccounts(description, accountType);
        
        if (result.suggestions.length === 0) {
          return {
            success: true,
            suggestions: [],
            noMatch: true,
            message: `Fant ingen passende kontoer for "${description}". Be brukeren beskrive utgiften/inntekten på en annen måte.`,
          };
        }
        
        return {
          success: true,
          suggestions: result.suggestions.map((s, index) => ({
            number: index + 1,
            code: s.code,
            name: s.name,
            reason: s.reason,
            vatDeductible: s.vatDeductible,
            vatNote: s.vatNote,
          })),
          searchDescription: result.searchDescription,
          message: "Vis forslagene til brukeren. Hvis vatNote finnes, FØLG instruksjonen. ⛔ IKKE spør om inkl/ekskl MVA hvis allerede oppgitt! 📌 Etter kontovalg: Bruk getBankAccounts og spør hvilken bankkonto betalingen gikk fra!",
        };
      } catch (error) {
        console.error("suggestAccounts error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke finne kontoer",
        };
      }
    },
  });

  const getMoreAccountSuggestions = tool({
    description: "Hent flere kontoforslag når de første 3 ikke passet. Bruker AI til å finne alternative kontoer.",
    parameters: z.object({
      description: z.string().describe("Samme beskrivelse som ble brukt i suggestAccounts"),
      accountType: z.enum(["expense", "income"]).describe("'expense' for kostnader, 'income' for inntekter"),
      excludeCodes: z.array(z.string()).optional().describe("Kontonumre som allerede er foreslått og skal ekskluderes"),
    }),
    execute: async ({ description, accountType, excludeCodes = [] }) => {
      try {
        const result = await accountHelper.getMoreSuggestions(description, accountType, excludeCodes);
        
        if (result.suggestions.length === 0) {
          return {
            success: true,
            suggestions: [],
            message: "Fant ingen flere passende kontoer. Be brukeren beskrive utgiften/inntekten på en annen måte.",
          };
        }
        
        return {
          success: true,
          suggestions: result.suggestions.map((s, index) => ({
            number: index + 4, // Starter på 4 siden de første 3 allerede er vist
            code: s.code,
            name: s.name,
            reason: s.reason,
            vatDeductible: s.vatDeductible,
            vatNote: s.vatNote,
          })),
          message: "Her er flere alternativer. Vis disse til brukeren og be dem velge. Husk å følge vatNote hvis den finnes.",
        };
      } catch (error) {
        console.error("getMoreAccountSuggestions error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente flere kontoer",
        };
      }
    },
  });

  // ============================================
  // BANK TOOLS
  // ============================================

  const getBankAccounts = tool({
    description: "Hent liste over bankkontoer i Fiken.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const accounts = await client.getBankAccounts();
        return {
          success: true,
          count: accounts.length,
          bankAccounts: accounts.map((a) => ({
            id: a.bankAccountId,
            name: a.name,
            accountCode: a.accountCode,
            bankAccountNumber: a.bankAccountNumber,
            bic: a.bic,
            iban: a.iban,
            inactive: a.inactive,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente bankkontoer",
        };
      }
    },
  });

  const getBankBalances = tool({
    description: "Hent bankbeholdning/saldoer.",
    parameters: z.object({
      date: z.string().optional().describe("Dato (YYYY-MM-DD), standard er i dag"),
    }),
    execute: async ({ date }) => {
      try {
        const balances = await client.getBankBalances({ date });
        const bankAccounts = await client.getBankAccounts();
        
        const result = balances.map((b) => {
          const account = bankAccounts.find((a) => a.bankAccountId === b.bankAccountId);
          return {
            bankAccountId: b.bankAccountId,
            name: account?.name || "Ukjent konto",
            accountCode: b.bankAccountCode,
            balance: b.balance,
            balanceKr: b.balance / 100,
          };
        });

        return {
          success: true,
          date: date || new Date().toISOString().split("T")[0],
          balances: result,
          totalBalanceKr: result.reduce((sum, b) => sum + b.balanceKr, 0),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente banksaldoer",
        };
      }
    },
  });

  const createBankAccount = tool({
    description: "Opprett en ny bankkonto i Fiken.",
    parameters: z.object({
      name: z.string().describe("Navn på kontoen"),
      bankAccountNumber: z.string().describe("Kontonummer (påkrevd)"),
      type: z.enum(["NORMAL", "TAX_DEDUCTION", "FOREIGN", "CREDIT_CARD"]).default("NORMAL").describe("Kontotype"),
      bic: z.string().optional().describe("BIC/SWIFT-kode"),
      iban: z.string().optional().describe("IBAN"),
    }),
    execute: async ({ name, bankAccountNumber, type, bic, iban }) => {
      try {
        const account = await client.createBankAccount({
          name,
          bankAccountNumber,
          type,
          bic,
          iban,
        });
        return {
          success: true,
          message: "Bankkonto opprettet: " + name,
          bankAccount: account,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette bankkonto",
        };
      }
    },
  });

  const getUnmatchedBankTransactions = tool({
    description: `Søk etter banktransaksjoner som kan matche en kvittering/utgift.
Bruk dette FØR du registrerer et kjøp for å finne matchende banktransaksjon.

Søker etter transaksjoner på bankkontoer (1920-serien) innenfor dato-range og beløps-margin.
Returnerer transaksjoner som kan være samme betaling som kvitteringen.`,
    parameters: z.object({
      amount: z.number().describe("Beløp fra kvittering i KR (ikke øre). F.eks. 450 for 450 kr."),
      date: z.string().describe("Dato fra kvittering (YYYY-MM-DD)"),
      daysRange: z.number().optional().default(5).describe("Antall dager før/etter å søke (standard: 5)"),
    }),
    execute: async ({ amount, date, daysRange = 5 }) => {
      try {
        // 1. Beregn dato-range
        const targetDate = new Date(date);
        const dateFrom = new Date(targetDate);
        dateFrom.setDate(dateFrom.getDate() - daysRange);
        const dateTo = new Date(targetDate);
        dateTo.setDate(dateTo.getDate() + daysRange);
        
        const dateFromStr = dateFrom.toISOString().split("T")[0];
        const dateToStr = dateTo.toISOString().split("T")[0];
        
        // 2. Hent bankkontoer
        const bankAccounts = await client.getBankAccounts();
        const activeBankAccounts = bankAccounts.filter(a => !a.inactive);
        
        if (activeBankAccounts.length === 0) {
          return {
            success: false,
            error: "Ingen aktive bankkontoer funnet i Fiken.",
          };
        }
        
        // 3. Hent journal entries (bilag) i perioden
        const journalEntries = await client.getJournalEntries({
          dateGe: dateFromStr,
          dateLe: dateToStr,
          pageSize: 100,
        });
        
        // 4. Konverter beløp til øre og finn margin (5 kr = 500 øre)
        const amountInOre = amount * 100;
        const marginInOre = 500; // 5 kr margin
        
        // 5. Filtrer på entries som har bankkonto og matcher beløpet
        // I Fiken er bankkonto typisk "1920:XXXXX" format
        const matches: Array<{
          journalEntryId: number;
          transactionId?: number;
          date: string;
          amount: number;
          amountKr: number;
          description: string;
          bankAccount: string;
        }> = [];
        
        for (const entry of journalEntries) {
          if (!entry.lines || !entry.journalEntryId) continue;
          
          for (const line of entry.lines) {
            // Sjekk om linjen er på en bankkonto (starter med 19)
            const account = line.debitAccount || line.creditAccount;
            if (!account || !account.startsWith("19")) continue;
            
            // Hent beløp (negativt for kredit/uttak, positivt for debet/innskudd)
            // For utgifter leter vi etter kredit (penger ut av bank)
            const lineAmount = line.amount || 0;
            
            // Sjekk om beløpet matcher (vi leter etter negative beløp = uttak)
            // Eller sammenlign absolutt verdi
            const absAmount = Math.abs(lineAmount);
            if (Math.abs(absAmount - amountInOre) <= marginInOre) {
              matches.push({
                journalEntryId: entry.journalEntryId,
                transactionId: entry.transactionId,
                date: entry.date || date,
                amount: lineAmount,
                amountKr: lineAmount / 100,
                description: entry.description || "Ingen beskrivelse",
                bankAccount: account,
              });
            }
          }
        }
        
        return {
          success: true,
          matchCount: matches.length,
          matches,
          searchCriteria: {
            amount,
            amountInOre,
            targetDate: date,
            dateFrom: dateFromStr,
            dateTo: dateToStr,
            marginKr: 5,
          },
          bankAccounts: activeBankAccounts.map(a => ({
            id: a.bankAccountId,
            name: a.name,
            accountCode: a.accountCode,
            bankAccountNumber: a.bankAccountNumber,
          })),
          hint: matches.length === 0
            ? "Ingen matchende banktransaksjoner funnet. Spør bruker om utgiften er betalt eller ubetalt."
            : matches.length === 1
              ? "Én match funnet. Spør bruker om dette er samme kjøp."
              : `${matches.length} potensielle matcher funnet. Vis liste og la bruker velge.`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter banktransaksjoner",
        };
      }
    },
  });

  // ============================================
  // PROJECT TOOLS
  // ============================================

  const searchProjects = tool({
    description: "Søk etter prosjekter i Fiken.",
    parameters: z.object({
      completed: z.boolean().optional().describe("Filtrer på fullførte prosjekter"),
    }),
    execute: async ({ completed }) => {
      try {
        const projects = await client.getProjects({ completed, pageSize: 50 });
        return {
          success: true,
          count: projects.length,
          projects: projects.map((p) => ({
            id: p.projectId,
            name: p.name,
            number: p.number,
            description: p.description,
            startDate: p.startDate,
            endDate: p.endDate,
            completed: p.completed,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter prosjekter",
        };
      }
    },
  });

  const getProject = tool({
    description: "Hent detaljert informasjon om et prosjekt.",
    parameters: z.object({
      projectId: z.number().describe("Prosjekt-ID"),
    }),
    execute: async ({ projectId }) => {
      try {
        const project = await client.getProject(projectId);
        return { success: true, project };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente prosjekt",
        };
      }
    },
  });

  const createProject = tool({
    description: "Opprett et nytt prosjekt i Fiken. PÅKREVD: name, number, startDate.",
    parameters: z.object({
      name: z.string().describe("Prosjektnavn (påkrevd)"),
      number: z.string().describe("Prosjektnummer (påkrevd)"),
      startDate: z.string().describe("Startdato (YYYY-MM-DD) (påkrevd)"),
      description: z.string().optional().describe("Beskrivelse"),
      endDate: z.string().optional().describe("Sluttdato (YYYY-MM-DD)"),
      contactId: z.number().optional().describe("Kontakt-ID (kunde)"),
    }),
    execute: async ({ name, number, startDate, description, endDate, contactId }) => {
      try {
        const project = await client.createProject({
          name,
          number,
          startDate,
          description,
          endDate,
          contactId,
        });
        return {
          success: true,
          message: "Prosjekt opprettet: " + name,
          project: {
            id: project.projectId,
            name: project.name,
            number: project.number,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette prosjekt",
        };
      }
    },
  });

  const updateProject = tool({
    description: "Oppdater et eksisterende prosjekt.",
    parameters: z.object({
      projectId: z.number().describe("Prosjekt-ID"),
      name: z.string().optional().describe("Prosjektnavn"),
      description: z.string().optional().describe("Beskrivelse"),
      endDate: z.string().optional().describe("Sluttdato"),
      completed: z.boolean().optional().describe("Marker som fullført"),
    }),
    execute: async ({ projectId, name, description, endDate, completed }) => {
      try {
        const project = await client.updateProject(projectId, {
          name,
          description,
          endDate,
          completed,
        });
        return { success: true, message: "Prosjekt oppdatert", project };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke oppdatere prosjekt",
        };
      }
    },
  });

  const deleteProject = tool({
    description: "Slett et prosjekt fra Fiken.",
    parameters: z.object({
      projectId: z.number().describe("Prosjekt-ID som skal slettes"),
    }),
    execute: async ({ projectId }) => {
      try {
        await client.deleteProject(projectId);
        return { success: true, message: "Prosjekt slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette prosjekt",
        };
      }
    },
  });

  // ============================================
  // JOURNAL ENTRY TOOLS
  // ============================================

  const searchJournalEntries = tool({
    description: "Søk etter bilag/posteringer i Fiken.",
    parameters: z.object({
      dateFrom: z.string().optional().describe("Fra dato (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("Til dato (YYYY-MM-DD)"),
    }),
    execute: async ({ dateFrom, dateTo }) => {
      try {
        const entries = await client.getJournalEntries({
          dateGe: dateFrom,
          dateLe: dateTo,
          pageSize: 50,
        });
        return {
          success: true,
          count: entries.length,
          journalEntries: entries.map((e) => ({
            id: e.journalEntryId,
            date: e.date,
            description: e.description,
            lines: e.lines,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter bilag",
        };
      }
    },
  });

  const getJournalEntry = tool({
    description: "Hent detaljert informasjon om et bilag.",
    parameters: z.object({
      journalEntryId: z.number().describe("Bilag-ID"),
    }),
    execute: async ({ journalEntryId }) => {
      try {
        const entry = await client.getJournalEntry(journalEntryId);
        return { success: true, journalEntry: entry };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente bilag",
        };
      }
    },
  });

  const cancelJournalEntry = tool({
    description: "Annuller/slett et bilag (fri postering). Oppretter en motpostering som reverserer alle posteringer. MERK: Bilaget blir ikke fysisk slettet, men markert som annullert.",
    parameters: z.object({
      journalEntryId: z.number().describe("Bilag-ID (journalEntryId) - IKKE transactionId"),
      description: z.string().describe("Begrunnelse for annullering (påkrevd)"),
    }),
    execute: async ({ journalEntryId, description }) => {
      try {
        // 1. Hent journal entry for å få transactionId
        const entry = await client.getJournalEntry(journalEntryId);
        
        if (!entry.transactionId) {
          return { 
            success: false, 
            error: "Bilaget har ingen tilknyttet transaksjon (transactionId mangler)" 
          };
        }
        
        // 2. Sjekk om allerede annullert (offsetTransactionId finnes i API-respons)
        if ((entry as any).offsetTransactionId) {
          return {
            success: false,
            error: `Bilaget er allerede annullert (motpostering-ID: ${(entry as any).offsetTransactionId})`
          };
        }
        
        // 3. Slett/annuller via transaksjonen
        await client.deleteTransaction(entry.transactionId, description);
        
        return { 
          success: true, 
          message: `Bilag ${journalEntryId} er annullert. En motpostering er opprettet for å reversere alle posteringer.`,
          journalEntryId,
          transactionId: entry.transactionId
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke annullere bilag",
        };
      }
    },
  });

  const createJournalEntry = tool({
    description: "Opprett et bilag/fri postering i Fiken. KRITISK: Kall ALLTID suggestAccounts FØRST, vis 3 forslag til brukeren, og VENT på brukerens valg før du registrerer! Hver linje MÅ ha debitAccount og/eller creditAccount. Beløp er alltid positivt. Bankkontoer (1920) krever reskontro-format - bruk getBankAccounts først!",
    parameters: z.object({
      date: z.string().describe("Bilagsdato (YYYY-MM-DD)"),
      description: z.string().describe("Beskrivelse av bilaget (maks 160 tegn)"),
      lines: z.array(z.object({
        amount: z.number().describe("Beløp i øre (alltid POSITIV verdi, f.eks. 50000 = 500 kr)"),
        debitAccount: z.string().optional().describe("Debetkonto (f.eks. '5000' for lønn, '6300' for husleie). IKKE bruk '1920' alene - bruk reskontro-format!"),
        creditAccount: z.string().optional().describe("Kreditkonto (f.eks. '1920:10001' for bank - HENT FRA getBankAccounts!, '2400' for leverandørgjeld)"),
        debitVatCode: z.number().optional().describe("MVA-kode for debet (f.eks. 1 for 25% MVA)"),
        creditVatCode: z.number().optional().describe("MVA-kode for kredit"),
      })).describe("Bilagslinjer - hver linje MÅ ha minst debitAccount eller creditAccount. Bankkontoer MÅ ha reskontro-format (f.eks. '1920:10001')"),
    }),
    execute: async ({ date, description, lines }) => {
      try {
        // Validering: sjekk at hver linje har minst én konto
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.debitAccount && !line.creditAccount) {
            return {
              success: false,
              error: `Linje ${i + 1}: Må ha debitAccount og/eller creditAccount. Bruk debitAccount for utgifter/eiendeler, creditAccount for inntekter/gjeld/bank.`,
            };
          }
          if (line.amount <= 0) {
            return {
              success: false,
              error: `Linje ${i + 1}: Beløp må være positivt (${line.amount} øre). Bruk debitAccount/creditAccount for å angi retning.`,
            };
          }
          
          // KRITISK: Sjekk for bankkontoer uten reskontro-format
          const bankAccountPattern = /^19[0-9]{2}$/; // Matcher 1900-1999 uten kolon
          if (line.debitAccount && bankAccountPattern.test(line.debitAccount)) {
            return {
              success: false,
              error: `Linje ${i + 1}: Bankkonto '${line.debitAccount}' mangler reskontro-format. Du MÅ bruke format som '${line.debitAccount}:XXXXX' (f.eks. '1920:10001'). Kall getBankAccounts først for å finne riktig kode!`,
            };
          }
          if (line.creditAccount && bankAccountPattern.test(line.creditAccount)) {
            return {
              success: false,
              error: `Linje ${i + 1}: Bankkonto '${line.creditAccount}' mangler reskontro-format. Du MÅ bruke format som '${line.creditAccount}:XXXXX' (f.eks. '1920:10001'). Kall getBankAccounts først for å finne riktig kode!`,
            };
          }
        }

        // Beregn total debet og kredit for å sjekke balanse
        let totalDebit = 0;
        let totalCredit = 0;
        for (const line of lines) {
          if (line.debitAccount) totalDebit += line.amount;
          if (line.creditAccount) totalCredit += line.amount;
        }
        
        if (totalDebit !== totalCredit) {
          return {
            success: false,
            error: `Bilag balanserer ikke. Debet: ${totalDebit} øre, Kredit: ${totalCredit} øre. Differanse: ${Math.abs(totalDebit - totalCredit)} øre.`,
          };
        }

        const entry = await client.createGeneralJournalEntry({
          journalEntries: [{
            date,
            description,
            lines: lines.map((l) => ({
              amount: l.amount,
              debitAccount: l.debitAccount,
              creditAccount: l.creditAccount,
              debitVatCode: l.debitVatCode,
              creditVatCode: l.creditVatCode,
            })),
          }],
        });
        return {
          success: true,
          message: "Bilag opprettet",
          journalEntry: entry,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette bilag",
        };
      }
    },
  });

  // ============================================
  // TRANSACTION TOOLS
  // ============================================

  const searchTransactions = tool({
    description: "Søk etter transaksjoner i Fiken.",
    parameters: z.object({
      createdDateFrom: z.string().optional().describe("Fra opprettelsesdato (YYYY-MM-DD)"),
      createdDateTo: z.string().optional().describe("Til opprettelsesdato (YYYY-MM-DD)"),
    }),
    execute: async ({ createdDateFrom, createdDateTo }) => {
      try {
        const transactions = await client.getTransactions({
          createdDateGe: createdDateFrom,
          createdDateLe: createdDateTo,
          pageSize: 50,
        });
        return {
          success: true,
          count: transactions.length,
          transactions: transactions.map((t) => ({
            id: t.transactionId,
            date: t.date,
            description: t.description,
            type: t.type,
            entries: t.entries,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter transaksjoner",
        };
      }
    },
  });

  const getTransaction = tool({
    description: "Hent detaljert informasjon om en transaksjon.",
    parameters: z.object({
      transactionId: z.number().describe("Transaksjon-ID"),
    }),
    execute: async ({ transactionId }) => {
      try {
        const transaction = await client.getTransaction(transactionId);
        return { success: true, transaction };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente transaksjon",
        };
      }
    },
  });

  const deleteTransaction = tool({
    description: "Slett/annuller en transaksjon. Oppretter en motpostering som reverserer alle posteringer. MERK: For bilag (journal entries), bruk heller cancelJournalEntry som håndterer ID-konvertering automatisk.",
    parameters: z.object({
      transactionId: z.number().describe("Transaksjon-ID (IKKE journalEntryId!)"),
      description: z.string().describe("Begrunnelse for sletting"),
    }),
    execute: async ({ transactionId, description }) => {
      try {
        await client.deleteTransaction(transactionId, description);
        return { success: true, message: "Transaksjon slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette transaksjon",
        };
      }
    },
  });

  // ============================================
  // INBOX TOOLS
  // ============================================

  const searchInbox = tool({
    description: "Søk etter dokumenter i innboksen (ubehandlede bilag).",
    parameters: z.object({
      status: z.enum(["unprocessed", "processing", "processed", "failed"]).optional().default("unprocessed").describe("Filtrer på status"),
    }),
    execute: async ({ status }) => {
      try {
        const documents = await client.getInbox({
          status,
          pageSize: 50,
        });
        return {
          success: true,
          count: documents.length,
          documents: documents.map((d) => ({
            id: d.documentId,
            name: d.name,
            filename: d.filename,
            status: d.status,
            createdDate: d.createdDate,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke i innboksen",
        };
      }
    },
  });

  const getInboxDocument = tool({
    description: "Hent detaljert informasjon om et dokument i innboksen.",
    parameters: z.object({
      documentId: z.number().describe("Dokument-ID"),
    }),
    execute: async ({ documentId }) => {
      try {
        const document = await client.getInboxDocument(documentId);
        return { success: true, document };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente dokument",
        };
      }
    },
  });

  // ============================================
  // ATTACHMENT UPLOAD TOOLS
  // These tools upload the files attached to the current chat message
  // All files are uploaded automatically in one operation
  // ============================================

  const uploadAttachmentToPurchase = tool({
    description: "Last opp vedlagte fil(er) til et kjøp. Brukes etter createPurchase for å legge ved dokumentasjon. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig kjøp.",
    parameters: z.object({
      purchaseId: z.number().describe("Kjøps-ID fra createPurchase"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ purchaseId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        // If fileIndex is specified, upload only that specific file
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1; // Convert from 1-based to 0-based
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const formData = createAttachmentFormData(file, { attachToSale: true });
            const attachment = await client.addAttachmentToPurchase(purchaseId, formData);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til kjøp ${purchaseId}`,
              uploadedFiles: [{
                name: file.name,
                identifier: attachment.identifier,
                downloadUrl: attachment.downloadUrl,
              }],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        // No fileIndex specified - upload all files (existing behavior)
        const uploadedFiles: Array<{ name: string; identifier?: string; downloadUrl?: string }> = [];
        const errors: string[] = [];
        
        for (const file of pendingFiles) {
          try {
            const formData = createAttachmentFormData(file, { attachToSale: true });
            const attachment = await client.addAttachmentToPurchase(purchaseId, formData);
            uploadedFiles.push({
              name: file.name,
              identifier: attachment.identifier,
              downloadUrl: attachment.downloadUrl,
            });
          } catch (error) {
            errors.push(`${file.name}: ${error instanceof Error ? error.message : "Ukjent feil"}`);
          }
        }
        
        if (uploadedFiles.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploadedFiles.length,
          totalFiles: pendingFiles.length,
          message: uploadedFiles.length === pendingFiles.length 
            ? `Alle ${uploadedFiles.length} vedlegg lastet opp til kjøp ${purchaseId}`
            : `${uploadedFiles.length} av ${pendingFiles.length} vedlegg lastet opp til kjøp ${purchaseId}`,
          uploadedFiles,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til kjøp",
        };
      }
    },
  });

  const uploadAttachmentToSale = tool({
    description: "Last opp vedlagte fil(er) til et salg. Brukes etter createSale for å legge ved dokumentasjon. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig salg.",
    parameters: z.object({
      saleId: z.number().describe("Salgs-ID fra createSale"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ saleId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        // If fileIndex is specified, upload only that specific file
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1; // Convert from 1-based to 0-based
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const formData = createAttachmentFormData(file);
            const attachment = await client.addAttachmentToSale(saleId, formData);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til salg ${saleId}`,
              uploadedFiles: [{
                name: file.name,
                identifier: attachment.identifier,
                downloadUrl: attachment.downloadUrl,
              }],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        // No fileIndex specified - upload all files (existing behavior)
        const uploadedFiles: Array<{ name: string; identifier?: string; downloadUrl?: string }> = [];
        const errors: string[] = [];
        
        for (const file of pendingFiles) {
          try {
            const formData = createAttachmentFormData(file);
            const attachment = await client.addAttachmentToSale(saleId, formData);
            uploadedFiles.push({
              name: file.name,
              identifier: attachment.identifier,
              downloadUrl: attachment.downloadUrl,
            });
          } catch (error) {
            errors.push(`${file.name}: ${error instanceof Error ? error.message : "Ukjent feil"}`);
          }
        }
        
        if (uploadedFiles.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploadedFiles.length,
          totalFiles: pendingFiles.length,
          message: uploadedFiles.length === pendingFiles.length 
            ? `Alle ${uploadedFiles.length} vedlegg lastet opp til salg ${saleId}`
            : `${uploadedFiles.length} av ${pendingFiles.length} vedlegg lastet opp til salg ${saleId}`,
          uploadedFiles,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til salg",
        };
      }
    },
  });

  const uploadAttachmentToInvoice = tool({
    description: "Last opp vedlagte fil(er) til en faktura. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig faktura.",
    parameters: z.object({
      invoiceId: z.number().describe("Faktura-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ invoiceId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        // If fileIndex is specified, upload only that specific file
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1; // Convert from 1-based to 0-based
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const formData = createAttachmentFormData(file);
            const attachment = await client.addAttachmentToInvoice(invoiceId, formData);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til faktura ${invoiceId}`,
              uploadedFiles: [{
                name: file.name,
                identifier: attachment.identifier,
                downloadUrl: attachment.downloadUrl,
              }],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        // No fileIndex specified - upload all files (existing behavior)
        const uploadedFiles: Array<{ name: string; identifier?: string; downloadUrl?: string }> = [];
        const errors: string[] = [];
        
        for (const file of pendingFiles) {
          try {
            const formData = createAttachmentFormData(file);
            const attachment = await client.addAttachmentToInvoice(invoiceId, formData);
            uploadedFiles.push({
              name: file.name,
              identifier: attachment.identifier,
              downloadUrl: attachment.downloadUrl,
            });
          } catch (error) {
            errors.push(`${file.name}: ${error instanceof Error ? error.message : "Ukjent feil"}`);
          }
        }
        
        if (uploadedFiles.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploadedFiles.length,
          totalFiles: pendingFiles.length,
          message: uploadedFiles.length === pendingFiles.length 
            ? `Alle ${uploadedFiles.length} vedlegg lastet opp til faktura ${invoiceId}`
            : `${uploadedFiles.length} av ${pendingFiles.length} vedlegg lastet opp til faktura ${invoiceId}`,
          uploadedFiles,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til faktura",
        };
      }
    },
  });

  const uploadAttachmentToJournalEntry = tool({
    description: "Last opp vedlagte fil(er) til et bilag/postering. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig bilag.",
    parameters: z.object({
      journalEntryId: z.number().describe("Bilag-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ journalEntryId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        // If fileIndex is specified, upload only that specific file
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1; // Convert from 1-based to 0-based
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const formData = createAttachmentFormData(file);
            const attachment = await client.addAttachmentToJournalEntry(journalEntryId, formData);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til bilag ${journalEntryId}`,
              uploadedFiles: [{
                name: file.name,
                identifier: attachment.identifier,
                downloadUrl: attachment.downloadUrl,
              }],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        // No fileIndex specified - upload all files (existing behavior)
        const uploadedFiles: Array<{ name: string; identifier?: string; downloadUrl?: string }> = [];
        const errors: string[] = [];
        
        for (const file of pendingFiles) {
          try {
            const formData = createAttachmentFormData(file);
            const attachment = await client.addAttachmentToJournalEntry(journalEntryId, formData);
            uploadedFiles.push({
              name: file.name,
              identifier: attachment.identifier,
              downloadUrl: attachment.downloadUrl,
            });
          } catch (error) {
            errors.push(`${file.name}: ${error instanceof Error ? error.message : "Ukjent feil"}`);
          }
        }
        
        if (uploadedFiles.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploadedFiles.length,
          totalFiles: pendingFiles.length,
          message: uploadedFiles.length === pendingFiles.length 
            ? `Alle ${uploadedFiles.length} vedlegg lastet opp til bilag ${journalEntryId}`
            : `${uploadedFiles.length} av ${pendingFiles.length} vedlegg lastet opp til bilag ${journalEntryId}`,
          uploadedFiles,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til bilag",
        };
      }
    },
  });

  // ============================================
  // RETURN ALL TOOLS
  // ============================================

  return {
    // Company
    getCompanyInfo,
    
    // Contacts
    searchContacts,
    getContact,
    createContact,
    updateContact,
    deleteContact,
    getContactPersons,
    addContactPerson,
    
    // Products
    searchProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    
    // Invoices
    searchInvoices,
    getInvoice,
    createInvoice,
    sendInvoice,
    // NOTE: addInvoicePayment removed - endpoint doesn't exist in Fiken API
    // Invoice payments are tracked automatically via 'settled' status
    getInvoiceDrafts,
    createInvoiceDraft,
    createInvoiceFromDraft,
    deleteInvoiceDraft,
    
    // Purchases
    searchPurchases,
    getPurchase,
    createPurchase,
    deletePurchase,
    addPurchasePayment,
    getPurchaseDrafts,
    createPurchaseDraft,
    createPurchaseFromDraft,
    deletePurchaseDraft,
    
    // Sales
    searchSales,
    getSale,
    createSale,
    settleSale,
    deleteSale,
    addSalePayment,
    
    // Offers
    searchOffers,
    getOffer,
    getOfferDrafts,
    createOfferDraft,
    createOfferFromDraft,
    deleteOfferDraft,
    
    // Order Confirmations
    searchOrderConfirmations,
    getOrderConfirmation,
    getOrderConfirmationDrafts,
    createOrderConfirmationDraft,
    createOrderConfirmationFromDraft,
    deleteOrderConfirmationDraft,
    createInvoiceFromOrderConfirmation,
    
    // Credit Notes
    searchCreditNotes,
    getCreditNote,
    createFullCreditNote,
    createPartialCreditNote,
    sendCreditNote,
    
    // Counters (CRITICAL for new companies)
    getInvoiceCounter,
    initializeInvoiceCounter,
    getCreditNoteCounter,
    initializeCreditNoteCounter,
    getOfferCounter,
    initializeOfferCounter,
    getOrderConfirmationCounter,
    initializeOrderConfirmationCounter,
    checkAndInitializeCounters,
    
    // Accounts & Balances
    getAccounts,
    getAccountBalances,
    suggestAccounts,
    getMoreAccountSuggestions,
    
    // Bank
    getBankAccounts,
    getBankBalances,
    createBankAccount,
    getUnmatchedBankTransactions,
    
    // Projects
    searchProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    
    // Journal Entries
    searchJournalEntries,
    getJournalEntry,
    createJournalEntry,
    cancelJournalEntry,
    
    // Transactions
    searchTransactions,
    getTransaction,
    deleteTransaction,
    
    // Inbox
    searchInbox,
    getInboxDocument,
    
    // Attachments (upload file from chat)
    uploadAttachmentToPurchase,
    uploadAttachmentToSale,
    uploadAttachmentToInvoice,
    uploadAttachmentToJournalEntry,
  };
}

// Export type for the tools object
export type FikenTools = ReturnType<typeof createFikenTools>;
