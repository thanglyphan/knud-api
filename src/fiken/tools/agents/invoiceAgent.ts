/**
 * Fiken Invoice Agent
 * 
 * Spesialisert agent for faktura- og salgsrelaterte operasjoner:
 * - Fakturaer (opprett, søk, hent, send)
 * - Fakturautkast
 * - Kreditnotaer (full og delvis)
 * - Salg (annet salg - kontantsalg, kortsalg, etc.)
 * - Faktura/kreditnota-tellere
 */

import { z } from "zod";
import { tool } from "ai";
import type { FikenClient } from "../../client.js";
import { 
  INVOICE_AGENT_PROMPT,
  createAttachmentTools,
  createDelegationToolsForAgent,
  type PendingFile,
  type DelegationHandler,
} from "../shared/index.js";

/**
 * Creates the invoice agent tools
 */
export function createInvoiceAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
  onDelegate?: DelegationHandler
) {
  
  // ============================================
  // INVOICE SEARCH & GET
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

  // ============================================
  // CREATE & SEND INVOICE
  // ============================================

  const createInvoice = tool({
    description: "Opprett en ny faktura i Fiken. PÅKREVD: issueDate, dueDate, lines, bankAccountCode, cash, customerId. Alle beløp i ØRE (100 = 1 kr). Hvis kunden ikke finnes, deleger til contact_agent.",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID (bruk delegateToContactAgent for å finne denne)"),
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
            incomeAccount: line.incomeAccount || "3000",
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
          _operationComplete: true,
          message: `Faktura ${invoiceId} ble sendt via ${method}`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke sende faktura",
        };
      }
    },
  });

  // ============================================
  // INVOICE DRAFTS
  // ============================================

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
            draftId: d.draftId,
            uuid: d.uuid,
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
            incomeAccount: l.incomeAccount || "3000",
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
        const draft = await client.getInvoiceDraft(draftId);
        const needsUpdate = draft.lines?.some((line) => !line.incomeAccount || !line.vatType);
        const customerId = draft.customerId || (draft.customer as { contactId?: number })?.contactId;
        const daysUntilDueDate = draft.daysUntilDueDate ?? 14;
        
        if (needsUpdate) {
          if (!customerId) {
            return {
              success: false,
              error: "Kunne ikke finne kunde-ID på utkastet. Slett utkastet og opprett et nytt med kunde.",
            };
          }
          
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
                incomeAccount: line.incomeAccount || "3000",
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
              error: `Kunne ikke oppdatere utkast: ${updateError instanceof Error ? updateError.message : "Ukjent feil"}`,
            };
          }
        }
        
        const invoice = await client.createInvoiceFromDraft(draftId);
        return {
          success: true,
          _operationComplete: true,
          message: `Faktura #${invoice.invoiceNumber} opprettet fra utkast`,
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
  // CREDIT NOTES
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
    description: "Opprett en full kreditnota for hele fakturabeløpet. VIKTIG: Fakturaer kan IKKE slettes - bruk denne for å reversere.",
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
          _operationComplete: true,
          message: `Full kreditnota #${creditNote.creditNoteNumber} opprettet`,
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
          _operationComplete: true,
          message: `Delvis kreditnota #${creditNote.creditNoteNumber} opprettet`,
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
        return { 
          success: true, 
          _operationComplete: true,
          message: `Kreditnota sendt via ${method}` 
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke sende kreditnota",
        };
      }
    },
  });

  // ============================================
  // SALES (Annet salg)
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
    description: "Opprett et nytt salg (annet salg, ikke faktura). Bruk for kontantsalg, Vipps, kort, etc.",
    parameters: z.object({
      date: z.string().describe("Salgsdato (YYYY-MM-DD)"),
      kind: z.enum(["cash_sale", "external_invoice"]).default("cash_sale").describe("Type salg"),
      paid: z.boolean().describe("Er salget betalt?"),
      currency: z.string().default("NOK").describe("Valuta"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse"),
        netAmount: z.number().optional().describe("Nettobeløp i øre"),
        grossAmount: z.number().optional().describe("Bruttobeløp i øre"),
        vatType: z.string().default("HIGH").describe("MVA-type"),
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
  // COUNTERS
  // ============================================

  const getInvoiceCounter = tool({
    description: "Hent nåværende fakturateller.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getInvoiceCounter();
        return {
          success: true,
          counter: counter.value,
          message: `Neste fakturanummer blir ${counter.value + 1}`,
        };
      } catch (error) {
        return {
          success: false,
          error: "Fakturateller ikke initialisert. Bruk initializeInvoiceCounter først.",
        };
      }
    },
  });

  const initializeInvoiceCounter = tool({
    description: "Initialiser fakturatelleren. PÅKREVD før første faktura kan opprettes.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createInvoiceCounter(startValue);
        return {
          success: true,
          message: `Fakturateller initialisert. Første fakturanummer blir ${counter.value + 1}`,
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return { success: false, error: "Fakturateller er allerede initialisert" };
        }
        return { success: false, error: errorMsg || "Kunne ikke initialisere fakturateller" };
      }
    },
  });

  const getCreditNoteCounter = tool({
    description: "Hent nåværende kreditnotateller.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getCreditNoteCounter();
        return {
          success: true,
          counter: counter.value,
          message: `Neste kreditnotanummer blir ${counter.value + 1}`,
        };
      } catch (error) {
        return {
          success: false,
          error: "Kreditnotateller ikke initialisert. Bruk initializeCreditNoteCounter først.",
        };
      }
    },
  });

  const initializeCreditNoteCounter = tool({
    description: "Initialiser kreditnotatelleren. PÅKREVD før første kreditnota kan opprettes.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createCreditNoteCounter(startValue);
        return {
          success: true,
          message: `Kreditnotateller initialisert. Første kreditnotanummer blir ${counter.value + 1}`,
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return { success: false, error: "Kreditnotateller er allerede initialisert" };
        }
        return { success: false, error: errorMsg || "Kunne ikke initialisere kreditnotateller" };
      }
    },
  });

  // ============================================
  // ATTACHMENT TOOLS (from shared module)
  // ============================================
  
  const attachmentTools = createAttachmentTools(client, pendingFiles);

  // ============================================
  // DELEGATION TOOLS (to other agents)
  // ============================================
  
  const delegationTools = onDelegate 
    ? createDelegationToolsForAgent('invoice_agent', onDelegate)
    : {};

  // ============================================
  // RETURN ALL TOOLS
  // ============================================

  return {
    // Invoice tools
    searchInvoices,
    getInvoice,
    createInvoice,
    sendInvoice,
    
    // Invoice drafts
    getInvoiceDrafts,
    createInvoiceDraft,
    createInvoiceFromDraft,
    deleteInvoiceDraft,
    
    // Credit notes
    searchCreditNotes,
    getCreditNote,
    createFullCreditNote,
    createPartialCreditNote,
    sendCreditNote,
    
    // Sales
    searchSales,
    getSale,
    createSale,
    settleSale,
    deleteSale,
    addSalePayment,
    
    // Counters
    getInvoiceCounter,
    initializeInvoiceCounter,
    getCreditNoteCounter,
    initializeCreditNoteCounter,
    
    // Attachments
    uploadAttachmentToInvoice: attachmentTools.uploadAttachmentToInvoice,
    uploadAttachmentToSale: attachmentTools.uploadAttachmentToSale,
    uploadAttachmentToInvoiceDraft: attachmentTools.uploadAttachmentToInvoiceDraft,
    uploadAttachmentToCreditNoteDraft: attachmentTools.uploadAttachmentToCreditNoteDraft,
    
    // Delegation
    ...delegationTools,
  };
}

// Export the agent prompt
export { INVOICE_AGENT_PROMPT };

// Type for the invoice agent tools
export type InvoiceAgentTools = ReturnType<typeof createInvoiceAgentTools>;
