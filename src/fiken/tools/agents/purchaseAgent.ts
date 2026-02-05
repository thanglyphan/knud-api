/**
 * Fiken Purchase Agent
 * 
 * Spesialisert agent for kjøp- og utgiftsrelaterte operasjoner:
 * - Kjøp/leverandørfakturaer
 * - Kvitteringshåndtering
 * - Kjøpsutkast
 * - Betalinger på kjøp
 * - Kontoforslag (suggestAccounts)
 */

import { z } from "zod";
import { tool } from "ai";
import type { FikenClient } from "../../client.js";
import { 
  PURCHASE_AGENT_PROMPT,
  createAttachmentTools,
  createDelegationToolsForAgent,
  createAccountHelper,
  type PendingFile,
  type DelegationHandler,
} from "../shared/index.js";

/**
 * Creates the purchase agent tools
 */
export function createPurchaseAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
  onDelegate?: DelegationHandler
) {
  
  // Initialize account helper for smart account suggestions
  const accountHelper = createAccountHelper(client, companySlug);
  
  // ============================================
  // ACCOUNT SUGGESTION TOOLS
  // ============================================

  const suggestAccounts = tool({
    description: `Finn de mest relevante kontoene for en utgift eller inntekt.
Bruker AI til å analysere beskrivelsen og velge fra selskapets kontoplan.

ARBEIDSFLYT:
1. Kall dette verktøyet med beskrivelse av utgift/inntekt
2. VIS de 3 forslagene til brukeren (inkludert reason, MVA-info og vatNote)
3. Hvis vatNote finnes - FØLG instruksjonen (f.eks. spør om innenlands/utenlands)
4. VENT på brukerens valg (1, 2 eller 3) OG svar på eventuelle oppfølgingsspørsmål
5. Registrer med valgt konto og riktig MVA-behandling`,
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
          message: "Vis forslagene til brukeren. Hvis vatNote finnes, FØLG instruksjonen.",
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
    description: "Hent flere kontoforslag når de første 3 ikke passet.",
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
            message: "Fant ingen flere passende kontoer. Be brukeren beskrive utgiften på en annen måte.",
          };
        }
        
        return {
          success: true,
          suggestions: result.suggestions.map((s, index) => ({
            number: index + 4,
            code: s.code,
            name: s.name,
            reason: s.reason,
            vatDeductible: s.vatDeductible,
            vatNote: s.vatNote,
          })),
          message: "Her er flere alternativer.",
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente flere kontoer",
        };
      }
    },
  });

  // ============================================
  // PURCHASE SEARCH & GET
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

  // ============================================
  // CREATE PURCHASE
  // ============================================

  const createPurchase = tool({
    description: `Registrer et nytt kjøp/leverandørfaktura i Fiken.

VIKTIG: Bruk suggestAccounts FØRST for å finne riktig konto!

PÅKREVD: date, kind, paid, lines, currency.
- For kontantkjøp (betalt): kind='cash_purchase', paid=true
- For leverandørfaktura (ubetalt): kind='supplier', paid=false, dueDate

SMART BANKKONTO-LOGIKK:
- Hvis paymentAccount IKKE oppgis og kind='cash_purchase':
  - Henter automatisk bankkontoer
  - Hvis kun 1 bankkonto: bruker den automatisk
  - Hvis flere: returnerer requiresSelection med liste`,
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
      supplierId: z.number().optional().describe("Leverandør-ID (bruk delegateToContactAgent for å finne denne)"),
      identifier: z.string().optional().describe("Fakturanummer fra leverandør"),
      dueDate: z.string().optional().describe("Forfallsdato (YYYY-MM-DD) - påkrevd for supplier"),
      paymentAccount: z.string().optional().describe("Bankkonto for betaling (f.eks. '1920:10001')"),
      paymentDate: z.string().optional().describe("Betalingsdato hvis betalt"),
      projectId: z.number().optional().describe("Prosjekt-ID for kostnadsføring"),
    }),
    execute: async ({ date, kind, paid, currency, lines, supplierId, identifier, dueDate, paymentAccount, paymentDate, projectId }) => {
      try {
        // SMART BANKKONTO-LOGIKK for kontantkjøp
        let effectivePaymentAccount = paymentAccount;
        
        if (kind === "cash_purchase" && !paymentAccount) {
          const bankAccounts = await client.getBankAccounts();
          const activeBankAccounts = bankAccounts.filter(a => !a.inactive);
          
          if (activeBankAccounts.length === 0) {
            return {
              success: false,
              error: "Ingen aktive bankkontoer funnet. Opprett en bankkonto først.",
            };
          } else if (activeBankAccounts.length === 1) {
            effectivePaymentAccount = activeBankAccounts[0].accountCode;
          } else {
            return {
              success: false,
              requiresSelection: true,
              selectionType: "bankAccount",
              options: activeBankAccounts.map(a => ({
                accountCode: a.accountCode,
                name: a.name,
                bankAccountNumber: a.bankAccountNumber,
              })),
              message: `Flere bankkontoer funnet. Spør bruker hvilken som ble brukt for denne betalingen.`,
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

  // ============================================
  // PURCHASE PAYMENTS
  // ============================================

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
          _operationComplete: true,
          message: `Betaling på ${amount / 100} kr registrert`,
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

  // ============================================
  // PURCHASE DRAFTS
  // ============================================

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
    description: "Opprett et kjøpsutkast.",
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
        return { 
          success: true, 
          _operationComplete: true,
          message: "Kjøp opprettet fra utkast", 
          purchase 
        };
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
  // BANK ACCOUNTS (for payment selection)
  // ============================================

  const getBankAccounts = tool({
    description: "Hent liste over bankkontoer for å velge betalingskonto.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const accounts = await client.getBankAccounts();
        return {
          success: true,
          count: accounts.length,
          accounts: accounts.filter(a => !a.inactive).map((a) => ({
            accountCode: a.accountCode,
            name: a.name,
            bankAccountNumber: a.bankAccountNumber,
            type: a.type,
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

  // ============================================
  // ATTACHMENT TOOLS
  // ============================================
  
  const attachmentTools = createAttachmentTools(client, pendingFiles);

  // ============================================
  // DELEGATION TOOLS
  // ============================================
  
  const delegationTools = onDelegate 
    ? createDelegationToolsForAgent('purchase_agent', onDelegate)
    : {};

  // ============================================
  // RETURN ALL TOOLS
  // ============================================

  return {
    // Account suggestions
    suggestAccounts,
    getMoreAccountSuggestions,
    
    // Purchase tools
    searchPurchases,
    getPurchase,
    createPurchase,
    deletePurchase,
    
    // Payments
    addPurchasePayment,
    
    // Purchase drafts
    getPurchaseDrafts,
    createPurchaseDraft,
    createPurchaseFromDraft,
    deletePurchaseDraft,
    
    // Bank accounts
    getBankAccounts,
    
    // Attachments
    uploadAttachmentToPurchase: attachmentTools.uploadAttachmentToPurchase,
    uploadAttachmentToPurchaseDraft: attachmentTools.uploadAttachmentToPurchaseDraft,
    
    // Delegation
    ...delegationTools,
  };
}

// Export the agent prompt
export { PURCHASE_AGENT_PROMPT };

// Type for the purchase agent tools
export type PurchaseAgentTools = ReturnType<typeof createPurchaseAgentTools>;
