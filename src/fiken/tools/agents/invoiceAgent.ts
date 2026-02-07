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
  type PendingFile,
} from "../shared/index.js";

/**
 * Creates the invoice agent tools
 */
export function createInvoiceAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
) {
  
  // ============================================
  // INVOICE SEARCH & GET
  // ============================================

  const searchInvoices = tool({
    description: "Søk etter fakturaer i Fiken. Kan filtrere på dato, kunde, og betalingsstatus.",
    parameters: z.object({
      issueDateFrom: z.string().optional().describe("Fra utstedelsesdato (YYYY-MM-DD)"),
      issueDateTo: z.string().optional().describe("Til utstedelsesdato (YYYY-MM-DD)"),
      customerId: z.number().nullable().optional().describe("Filtrer på kunde-ID"),
      settled: z.boolean().optional().describe("Filtrer på betalt (true) eller ubetalt (false)"),
    }),
    execute: async ({ issueDateFrom, issueDateTo, customerId, settled }) => {
      try {
        const invoices = await client.getInvoices({
          issueDateGe: issueDateFrom,
          issueDateLe: issueDateTo,
          customerId: customerId ?? undefined,
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
    description: "Opprett en ny faktura i Fiken. PÅKREVD: issueDate, dueDate, lines, bankAccountCode, cash, customerId. Bruk searchContacts for å finne kundens contactId.",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID (contactId fra searchContacts)"),
      issueDate: z.string().describe("Fakturadato (YYYY-MM-DD)"),
      dueDate: z.string().describe("Forfallsdato (YYYY-MM-DD)"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse av vare/tjeneste"),
        grossAmountKr: z.number().describe("Enhetspris i KRONER INKL. MVA. Bruker sier '5000 kr' → grossAmountKr = 5000. ALDRI konverter til øre!"),
        quantity: z.number().describe("Antall (påkrevd)"),
        vatType: z.string().optional().default("HIGH").describe("MVA-type: HIGH (25%), MEDIUM (15%), LOW (12%), NONE, EXEMPT, OUTSIDE"),
        incomeAccount: z.string().optional().default("3000").describe("Inntektskonto"),
      })).describe("Fakturalinjer"),
      bankAccountCode: z.string().optional().default("1920").describe("Bankkontokode for betaling (standard: '1920'). System henter fullstendig kode automatisk."),
      cash: z.boolean().default(false).describe("Er dette kontantsalg? (true = betalt umiddelbart)"),
      invoiceText: z.string().optional().describe("Tekst på fakturaen"),
      ourReference: z.string().optional().describe("Vår referanse"),
      yourReference: z.string().optional().describe("Deres referanse"),
    }),
    execute: async ({ customerId, issueDate, dueDate, lines, bankAccountCode, cash, invoiceText, ourReference, yourReference }) => {
      try {
        const vatRates: Record<string, number> = {
          HIGH: 0.25, MEDIUM: 0.15, LOW: 0.12, RAW_FISH: 0.1111, NONE: 0, EXEMPT: 0, OUTSIDE: 0,
        };
        // Auto-resolve bankAccountCode: if user says "1920", find full code like "1920:10001"
        let resolvedBankAccountCode = bankAccountCode || "1920";
        if (resolvedBankAccountCode && !resolvedBankAccountCode.includes(":")) {
          try {
            const bankAccounts = await client.getBankAccounts();
            const match = bankAccounts.find((ba: any) => ba.accountCode?.startsWith(resolvedBankAccountCode));
            if (match?.accountCode) {
              resolvedBankAccountCode = match.accountCode;
            }
          } catch { /* fallback to provided code */ }
        }
        const invoice = await client.createInvoice({
          customerId,
          issueDate,
          dueDate,
          lines: lines.map((line) => {
            const rate = vatRates[line.vatType || "HIGH"] ?? 0.25;
            const netKr = line.grossAmountKr / (1 + rate);
            return {
              description: line.description,
              unitPrice: Math.round(netKr * 100), // Convert net kr to øre
              quantity: line.quantity,
              vatType: line.vatType || "HIGH",
              incomeAccount: line.incomeAccount || "3000",
            };
          }),
          bankAccountCode: resolvedBankAccountCode,
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
      customerId: z.number().describe("Kunde-ID (contactId)"),
      daysUntilDueDate: z.number().describe("Antall dager til forfall"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse"),
        grossAmountKr: z.number().describe("Enhetspris i KRONER INKL. MVA. Bruker sier '5000 kr' → grossAmountKr = 5000. ALDRI konverter til øre!"),
        quantity: z.number().describe("Antall"),
        vatType: z.string().optional().default("HIGH"),
        incomeAccount: z.string().optional().default("3000"),
      })).describe("Fakturalinjer"),
      bankAccountCode: z.string().optional().describe("Bankkonto"),
      invoiceText: z.string().optional(),
    }),
    execute: async ({ customerId, daysUntilDueDate, lines, bankAccountCode, invoiceText }) => {
      try {
        const vatRates: Record<string, number> = {
          HIGH: 0.25, MEDIUM: 0.15, LOW: 0.12, RAW_FISH: 0.1111, NONE: 0, EXEMPT: 0, OUTSIDE: 0,
        };
        const draft = await client.createInvoiceDraft({
          customerId,
          daysUntilDueDate,
          type: "invoice",
          lines: lines.map((l) => {
            const rate = vatRates[l.vatType || "HIGH"] ?? 0.25;
            const netKr = l.grossAmountKr / (1 + rate);
            return {
              description: l.description,
              unitPrice: Math.round(netKr * 100), // Convert net kr to øre
              quantity: l.quantity,
              vatType: l.vatType || "HIGH",
              incomeAccount: l.incomeAccount || "3000",
            };
          }),
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
    description: "Opprett en faktura fra et eksisterende utkast. BRUK ALLTID DETTE VERKTØYET når bruker ber om å lage faktura fra utkast. Verktøyet håndterer alt automatisk: henter utkastet, fyller inn manglende bankkonto/kontoinfo, og oppretter fakturaen. Du trenger IKKE hente utkastet først.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getInvoiceDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        const draft = await client.getInvoiceDraft(draftId);
        
        // Auto-resolve bank account number from first available bank account
        let bankAccountNumber = (draft as any).bankAccountNumber;
        if (!bankAccountNumber) {
          try {
            const bankAccounts = await client.getBankAccounts();
            if (bankAccounts.length > 0) {
              bankAccountNumber = (bankAccounts[0] as any).bankAccountNumber;
            }
          } catch { /* ignore, will fail later if truly needed */ }
        }
        
        const customerId = draft.customerId || (draft.customer as { contactId?: number })?.contactId || 
                          ((draft as any).customers as { contactId?: number }[])?.[0]?.contactId;
        const daysUntilDueDate = draft.daysUntilDueDate ?? 14;
        
        // Always update draft to ensure all fields are present
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
            bankAccountNumber,
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
        grossAmountKr: z.number().describe("Enhetspris i KRONER INKL. MVA (positivt tall). ALDRI konverter til øre!"),
        quantity: z.number().describe("Antall"),
        vatType: z.string().optional().default("HIGH"),
        incomeAccount: z.string().optional().default("3000"),
      })).describe("Linjer som skal krediteres"),
      creditNoteText: z.string().optional(),
    }),
    execute: async ({ invoiceId, customerId, issueDate, lines, creditNoteText }) => {
      try {
        const vatRates: Record<string, number> = {
          HIGH: 0.25, MEDIUM: 0.15, LOW: 0.12, RAW_FISH: 0.1111, NONE: 0, EXEMPT: 0, OUTSIDE: 0,
        };
        const creditNote = await client.createPartialCreditNote({
          issueDate,
          lines: lines.map((l) => {
            const rate = vatRates[l.vatType || "HIGH"] ?? 0.25;
            const netKr = l.grossAmountKr / (1 + rate);
            return {
              quantity: l.quantity,
              unitPrice: Math.round(netKr * 100), // Convert net kr to øre
              description: l.description,
              vatType: l.vatType,
              incomeAccount: l.incomeAccount,
            };
          }),
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
        grossAmountKr: z.number().describe("Bruttobeløp i KRONER inkl. MVA. Bruker sier '500 kr' → grossAmountKr = 500. ALDRI konverter til øre!"),
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
        // Convert kr to øre and calculate net from gross
        const vatRates: Record<string, number> = {
          "HIGH": 0.25, "MEDIUM": 0.15, "LOW": 0.12, "NONE": 0, "EXEMPT": 0, "OUTSIDE": 0,
        };
        const sale = await client.createSale({
          date,
          kind,
          paid,
          currency,
          lines: lines.map((l) => {
            const grossOre = Math.round(l.grossAmountKr * 100);
            const rate = vatRates[l.vatType] ?? 0;
            const netOre = Math.round(grossOre / (1 + rate));
            return {
              description: l.description,
              vatType: l.vatType,
              netAmount: netOre,
              grossAmount: grossOre,
              incomeAccount: l.incomeAccount,
            };
          }),
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
      amountKr: z.number().describe("Beløp i KRONER. Eksempel: betaling på 500 kr → amountKr = 500. ALDRI konverter til øre!"),
      account: z.string().optional().describe("Bankkonto-kode (f.eks. '1920:10001'). Standard: auto-hentes fra bankkonto."),
    }),
    execute: async ({ saleId, date, amountKr, account }) => {
      try {
        const amountOre = Math.round(amountKr * 100);
        // Auto-resolve bank account code if not provided or missing reskontro suffix
        let resolvedAccount = account || "1920";
        if (!resolvedAccount.includes(":")) {
          try {
            const bankAccounts = await client.getBankAccounts();
            const match = bankAccounts.find((ba: any) => ba.accountCode?.startsWith(resolvedAccount + ":"));
            if (match) {
              resolvedAccount = match.accountCode;
            }
          } catch (e) {
            // Fall back to provided account
          }
        }
        const payment = await client.addSalePayment(saleId, { date, amount: amountOre, account: resolvedAccount });
        return { success: true, message: `Betaling på ${amountKr} kr registrert på salg`, payment };
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
  // CONTACT SEARCH (needed for invoice/sale creation)
  // ============================================

  const searchContacts = tool({
    description: "Søk etter kunder/kontakter i Fiken. Bruk dette for å finne contactId når du skal opprette faktura eller salg.",
    parameters: z.object({
      name: z.string().optional().describe("Søk etter navn (delvis match)"),
      customerNumber: z.number().optional().describe("Søk etter kundenummer"),
    }),
    execute: async ({ name, customerNumber }) => {
      try {
        const params: any = { pageSize: 20 };
        if (name) params.name = name;
        if (customerNumber) params.customerNumber = customerNumber;
        const contacts = await client.getContacts(params);
        const customers = contacts.filter((c) => c.customer);
        return {
          success: true,
          count: customers.length,
          contacts: customers.map((c) => ({
            contactId: c.contactId,
            name: c.name,
            email: c.email,
            customerNumber: c.customerNumber,
            organizationNumber: c.organizationNumber,
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

  // ============================================
  // ATTACHMENT TOOLS (from shared module)
  // ============================================
  
  const attachmentTools = createAttachmentTools(client, pendingFiles);

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
    
    // Contact search (for finding customer IDs)
    searchContacts,
    
    // Attachments
    uploadAttachmentToInvoice: attachmentTools.uploadAttachmentToInvoice,
    uploadAttachmentToSale: attachmentTools.uploadAttachmentToSale,
    uploadAttachmentToInvoiceDraft: attachmentTools.uploadAttachmentToInvoiceDraft,
    uploadAttachmentToCreditNoteDraft: attachmentTools.uploadAttachmentToCreditNoteDraft,
  };
}

// Export the agent prompt
export { INVOICE_AGENT_PROMPT };

// Type for the invoice agent tools
export type InvoiceAgentTools = ReturnType<typeof createInvoiceAgentTools>;
