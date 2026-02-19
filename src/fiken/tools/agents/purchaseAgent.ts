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
  createAccountHelper,
  type PendingFile,
} from "../shared/index.js";

/**
 * Creates the purchase agent tools
 */
export function createPurchaseAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
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
          purchases: purchases.map((p) => {
            // Calculate total gross amount from lines
            const totalGross = p.lines?.reduce((sum, l) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
            return {
              id: p.purchaseId,
              identifier: p.identifier,
              date: p.date,
              dueDate: p.dueDate,
              supplierName: p.supplier?.name,
              supplierId: p.supplierId,
              paid: p.paid,
              currency: p.currency,
              kind: (p as any).kind,
              totalGrossOre: totalGross,
              totalGrossKr: totalGross / 100,
              description: p.lines?.[0]?.description,
              hasAttachments: (p.attachments?.length || 0) > 0,
            };
          }),
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
    description: "Hent detaljert informasjon om et spesifikt kjøp. Beløp returneres i KRONER.",
    parameters: z.object({
      purchaseId: z.number().describe("Kjøp-ID i Fiken"),
    }),
    execute: async ({ purchaseId }) => {
      try {
        const purchase = await client.getPurchase(purchaseId);
        return { 
          success: true, 
          purchase: {
            ...purchase,
            // Convert øre to kr for display
            lines: purchase.lines?.map((l: any) => ({
              ...l,
              netPriceKr: l.netPrice / 100,
              vatKr: l.vat / 100,
              grossKr: (l.netPrice + l.vat) / 100,
            })),
            payments: purchase.payments?.map((p: any) => ({
              ...p,
              amountKr: p.amount / 100,
            })),
          },
          _hint: "Alle beløp er i KRONER (kr), IKKE øre.",
        };
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
        grossAmountKr: z.number().describe("BRUTTOBELØP i kroner INKLUDERT MVA. Eksempel: bruker sier '500 kr' → grossAmountKr = 500. ALDRI konverter til øre!"),
        vatType: z.string().describe("MVA-type: HIGH (25%), MEDIUM (15%), LOW (12%), NONE (0%), EXEMPT (fritatt)"),
        account: z.string().optional().describe("Kostnadskonto (f.eks. 6300=leie, 4000=varekjøp, 6540=inventar)"),
      })).describe("Kjøpslinjer"),
      supplierId: z.number().nullable().optional().describe("Leverandør-ID (contactId fra kontaktoppslag). Utelat hvis ukjent."),
      identifier: z.string().optional().describe("Fakturanummer fra leverandør"),
      dueDate: z.string().optional().describe("Forfallsdato (YYYY-MM-DD) - påkrevd for supplier"),
      paymentAccount: z.string().optional().describe("Bankkonto for betaling (f.eks. '1920:10001')"),
      paymentDate: z.string().optional().describe("Betalingsdato hvis betalt"),
      projectId: z.number().optional().describe("Prosjekt-ID for kostnadsføring"),
    }),
    execute: async ({ date, kind, paid, currency, lines, supplierId, identifier, dueDate, paymentAccount, paymentDate, projectId }) => {
      try {
        // ============================================
        // CONVERT grossAmountKr → netPrice in øre
        // AI sends gross amount in KR (e.g. 500 for 500 kr)
        // We calculate net = gross / (1 + vatRate) and convert to øre (* 100)
        // ============================================
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
        
        const convertedLines = lines.map((l) => {
          const rate = vatRates[l.vatType] ?? 0;
          const grossOre = Math.round(l.grossAmountKr * 100); // Convert kr to øre
          const netOre = Math.round(grossOre / (1 + rate));
          const vatOre = grossOre - netOre;
          console.log(`[createPurchase] Line: "${l.description}" | gross=${l.grossAmountKr} kr → ${grossOre} øre | net=${netOre} øre | vat=${vatOre} øre (${l.vatType})`);
          return {
            description: l.description,
            vatType: l.vatType,
            netPrice: netOre,
            vat: vatOre,
            account: l.account,
          };
        });
        
        // ============================================
        // DUPLICATE CHECK: Search for existing purchases
        // on the same date with similar amount/description
        // Uses GROSS amount comparison (net+vat) to catch
        // duplicates even when VAT types differ between attempts
        // ============================================
        
        const newTotalGross = convertedLines.reduce((sum, l) => sum + l.netPrice + l.vat, 0);
        
        console.log(`[createPurchase] Duplicate check: date=${date}, gross=${newTotalGross} øre, supplierId=${supplierId || 'none'}, desc="${lines[0]?.description || ''}"`);
        
        try {
          const existingPurchases = await client.getPurchases({
            dateGe: date,
            dateLe: date,
            pageSize: 100,
          });
          
          // Check each existing purchase for potential duplicate
          const duplicates = existingPurchases.filter((p) => {
            if (!p.lines || p.lines.length === 0) return false;
            
            // Calculate existing purchase total gross (net + vat)
            const existingTotalGross = p.lines.reduce((sum, l) => sum + (l.netPrice || 0) + (l.vat || 0), 0);
            
            // Check if gross amounts match (within 1 kr / 100 øre margin for rounding)
            const amountMatch = Math.abs(existingTotalGross - newTotalGross) < 100;
            
            if (!amountMatch) return false; // Skip early if amounts don't match
            
            // Check if description is similar (case-insensitive substring match)
            const newDesc = lines[0]?.description?.toLowerCase() || "";
            const existingDesc = p.lines[0]?.description?.toLowerCase() || "";
            const descMatch = newDesc && existingDesc && (
              newDesc.includes(existingDesc) || 
              existingDesc.includes(newDesc) ||
              newDesc === existingDesc
            );
            
            // Check supplier match (Fiken returns supplier as Contact object, not supplierId)
            const existingSupplierId = p.supplierId || p.supplier?.contactId;
            const supplierMatch = supplierId && existingSupplierId && supplierId === existingSupplierId;
            
            // For kontantkjøp without supplier: amount match alone is sufficient
            // (there's no supplier to disambiguate, so same amount = likely duplicate)
            const kontantAmountOnly = !supplierId && !existingSupplierId;
            
            const isDuplicate = descMatch || supplierMatch || kontantAmountOnly;
            
            if (isDuplicate) {
              console.log(`[createPurchase] DUPLICATE FOUND: existing #${p.purchaseId} (${existingTotalGross} øre, desc="${existingDesc}", supplier=${existingSupplierId || 'none'}) matches new (${newTotalGross} øre, desc="${newDesc}", supplier=${supplierId || 'none'}) — reason: ${descMatch ? 'desc' : supplierMatch ? 'supplier' : 'kontant-amount'}`);
            }
            
            return isDuplicate;
          });
          
          if (duplicates.length > 0) {
            const dup = duplicates[0];
            const dupGross = dup.lines?.reduce((sum, l) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
            return {
              success: false,
              _operationComplete: true,
              duplicateFound: true,
              message: `⚠️ DUPLIKAT FUNNET! Et lignende kjøp finnes allerede:\n` +
                `- ID: ${dup.purchaseId}\n` +
                `- Dato: ${dup.date}\n` +
                `- Beløp: ${(dupGross / 100).toFixed(2)} kr\n` +
                `- Beskrivelse: ${dup.lines?.[0]?.description || "Ukjent"}\n` +
                `- Leverandør: ${dup.supplier?.name || "Ukjent"}\n` +
                `- Har vedlegg: ${(dup.attachments?.length || 0) > 0 ? "Ja" : "Nei"}\n\n` +
                `Bruk uploadAttachmentToPurchase med purchaseId ${dup.purchaseId} hvis du kun trenger å laste opp vedlegg.\n` +
                `IKKE opprett et nytt kjøp.`,
              existingPurchase: {
                purchaseId: dup.purchaseId,
                date: dup.date,
                totalGrossKr: dupGross / 100,
                description: dup.lines?.[0]?.description,
                supplierName: dup.supplier?.name,
                hasAttachments: (dup.attachments?.length || 0) > 0,
              },
            };
          }
        } catch (dupCheckError) {
          // If duplicate check fails, log but continue with creation
          console.warn("[createPurchase] Duplicate check failed, proceeding with creation:", dupCheckError);
        }
        
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
        
        const requestBody = {
          date,
          kind,
          paid,
          currency,
          lines: convertedLines,
          supplierId: supplierId ?? undefined,
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
      amountKr: z.number().describe("Beløp i KRONER. Eksempel: betaling på 500 kr → amountKr = 500. ALDRI konverter til øre!"),
      account: z.string().optional().describe("Bankkonto-kode (f.eks. '1920:10001'). Standard: auto-hentes fra bankkonto."),
    }),
    execute: async ({ purchaseId, date, amountKr, account }) => {
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
        const payment = await client.addPurchasePayment(purchaseId, { date, amount: amountOre, account: resolvedAccount });
        return {
          success: true,
          _operationComplete: true,
          message: `Betaling på ${amountKr} kr registrert`,
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
        description: z.string().describe("Beskrivelse av vare/tjeneste"),
        vatType: z.string().describe("MVA-type"),
        account: z.string().describe("Kostnadskonto"),
        grossAmountKr: z.number().describe("BRUTTOBELØP i KRONER inkl. MVA. Eksempel: 500 kr → grossAmountKr = 500. ALDRI konverter til øre!"),
      })),
      supplierId: z.number().nullable().optional(),
      date: z.string().optional(),
      dueDate: z.string().optional(),
    }),
    execute: async ({ cash, paid, lines, supplierId, date, dueDate }) => {
      try {
        const vatRates: Record<string, number> = {
          HIGH: 0.25, MEDIUM: 0.15, LOW: 0.12, EXEMPT: 0, NONE: 0, OUTSIDE: 0,
        };
         const draft = await client.createPurchaseDraft({
          cash,
          paid,
          lines: lines.map((l) => {
            const grossOre = Math.round(l.grossAmountKr * 100);
            const rate = vatRates[l.vatType] ?? 0.25;
            const netOre = Math.round(grossOre / (1 + rate));
            return {
              text: l.description,
              vatType: l.vatType,
              incomeAccount: l.account,
              net: netOre,
              gross: grossOre,
            };
          }),
          supplierId: supplierId ?? undefined,
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
    description: "Opprett et kjøp fra et eksisterende utkast. BRUK ALLTID DETTE VERKTØYET direkte — det håndterer manglende dato automatisk. Du trenger IKKE hente utkastet først.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getPurchaseDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        // First try the native API
        try {
          const purchase = await client.createPurchaseFromDraft(draftId);
          // If successful, delete the draft
          return { 
            success: true, 
            _operationComplete: true,
            message: "Kjøp opprettet fra utkast", 
            purchase 
          };
        } catch (apiError) {
          // Fiken API often fails with "Mangler dato" — fall back to manual creation
          const draft = await client.getPurchaseDraft(draftId);
          const today = new Date().toISOString().split("T")[0];
          
          const isCash = draft.cash ?? false;
          const isPaid = draft.paid ?? false;
          
          // Build purchase request from draft data
          let paymentAccount: string | undefined;
          if (isCash || isPaid) {
            try {
              const bankAccounts = await client.getBankAccounts();
              if (bankAccounts.length > 0) {
                paymentAccount = (bankAccounts[0] as any).accountCode || "1920:10001";
              }
            } catch { paymentAccount = "1920:10001"; }
          }
          
          const vatRates: Record<string, number> = {
            HIGH: 0.25, MEDIUM: 0.15, LOW: 0.12, EXEMPT: 0, NONE: 0, OUTSIDE: 0,
          };
          
          const purchase = await client.createPurchase({
            date: today,
            kind: isCash ? "cash_purchase" : "supplier",
            paid: isPaid,
            currency: draft.currency || "NOK",
            lines: (draft.lines || []).map((l: any) => {
              const grossOre = l.gross || 0;
              const rate = vatRates[l.vatType] ?? 0.25;
              const netOre = Math.round(grossOre / (1 + rate));
              return {
                description: l.text || l.description || "",
                netPrice: netOre,
                vatType: l.vatType || "HIGH",
                account: l.incomeAccount || l.account || "6800",
              };
            }),
            ...(draft.supplierId ? { supplierId: draft.supplierId } : {}),
            ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
            ...(paymentAccount && isPaid ? { paymentAccount } : {}),
          } as any);
          
          // Delete the draft since we created the purchase manually
          try { await client.deletePurchaseDraft(draftId); } catch { /* ignore */ }
          
          return { 
            success: true, 
            _operationComplete: true,
            message: "Kjøp opprettet fra utkast (med dagens dato)", 
            purchase 
          };
        }
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
  // UNMATCHED BANK TRANSACTIONS (Avstemming)
  // Copied from bankAgent.ts — purchase agent prompt references this tool
  // ============================================

  const getUnmatchedBankTransactions = tool({
    description: `Søk etter banktransaksjoner som kan matche en kvittering/utgift.
Bruk dette FØR du registrerer et kjøp for å finne matchende banktransaksjon.
Søker etter transaksjoner på bankkontoer (1920-serien) innenfor dato-range og beløps-margin.`,
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
        
        // 3. Hent journal entries (bilag) i perioden — with pagination
        let allJournalEntries: any[] = [];
        let page = 0;
        const pageSize = 100;
        while (true) {
          const entries = await client.getJournalEntries({
            dateGe: dateFromStr,
            dateLe: dateToStr,
            pageSize,
            page,
          });
          allJournalEntries = allJournalEntries.concat(entries);
          if (entries.length < pageSize) break;
          page++;
          if (page > 10) break; // Safety limit: max 1100 entries
        }
        const journalEntries = allJournalEntries;
        
        // 4. Konverter beløp til øre og finn margin (5 kr = 500 øre)
        const amountInOre = amount * 100;
        const marginInOre = 500;
        
        // 5. Filtrer på entries som har bankkonto og matcher beløpet
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
            const account = (line as any).account || line.debitAccount || line.creditAccount;
            if (!account || !account.startsWith("19")) continue;
            
            const lineAmount = line.amount || 0;
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
  // CONTACT SEARCH (for finding suppliers)
  // ============================================

  const searchContacts = tool({
    description: "Søk etter leverandører/kontakter i Fiken. Bruk dette for å finne contactId (supplierId) når du skal opprette leverandørfaktura.",
    parameters: z.object({
      name: z.string().optional().describe("Søk etter navn (delvis match)"),
      supplierNumber: z.number().optional().describe("Søk etter leverandørnummer"),
    }),
    execute: async ({ name, supplierNumber }) => {
      try {
        const params: any = { pageSize: 20 };
        if (name) params.name = name;
        if (supplierNumber) params.supplierNumber = supplierNumber;
        const contacts = await client.getContacts(params);
        const suppliers = contacts.filter((c) => c.supplier);
        return {
          success: true,
          count: suppliers.length,
          contacts: suppliers.map((c) => ({
            contactId: c.contactId,
            name: c.name,
            email: c.email,
            supplierNumber: c.supplierNumber,
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
  // ATTACHMENT TOOLS
  // ============================================
  
  const attachmentTools = createAttachmentTools(client, pendingFiles);

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
    
    // Bank transaction matching (for smart bankavstemming)
    getUnmatchedBankTransactions,
    
    // Contact search (for finding suppliers)
    searchContacts,
    
    // Attachments
    uploadAttachmentToPurchase: attachmentTools.uploadAttachmentToPurchase,
    uploadAttachmentToPurchaseDraft: attachmentTools.uploadAttachmentToPurchaseDraft,
  };
}

// Export the agent prompt
export { PURCHASE_AGENT_PROMPT };

// Type for the purchase agent tools
export type PurchaseAgentTools = ReturnType<typeof createPurchaseAgentTools>;
