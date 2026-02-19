/**
 * Fiken Bank Agent
 * 
 * Spesialisert agent for bank- og transaksjons-operasjoner:
 * - Bankkontoer (liste, hent, opprett)
 * - Banksaldoer
 * - Transaksjoner (søk, hent, slett)
 * - Innboks-dokumenter
 * - Avstemming (finne matchende banktransaksjoner)
 */

import { z } from "zod";
import { tool } from "ai";
import type { FikenClient } from "../../client.js";
import { 
  BANK_AGENT_PROMPT,
  createAttachmentTools,
  type PendingFile,
} from "../shared/index.js";

/**
 * Creates the bank agent tools
 */
export function createBankAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
) {
  
  // ============================================
  // BANK ACCOUNTS
  // ============================================

  const getBankAccounts = tool({
    description: "Hent liste over bankkontoer i Fiken. Nyttig for å finne riktig konto for betalinger.",
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
            type: a.type,
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

  const getBankAccount = tool({
    description: "Hent detaljert informasjon om en spesifikk bankkonto.",
    parameters: z.object({
      bankAccountId: z.number().describe("Bankkonto-ID"),
    }),
    execute: async ({ bankAccountId }) => {
      try {
        const account = await client.getBankAccount(bankAccountId);
        return { success: true, bankAccount: account };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente bankkonto",
        };
      }
    },
  });

  const createBankAccount = tool({
    description: "Opprett en ny bankkonto i Fiken. Type MÅ være uppercase: NORMAL, TAX_DEDUCTION, FOREIGN, eller CREDIT_CARD.",
    parameters: z.object({
      name: z.string().describe("Navn på kontoen"),
      bankAccountNumber: z.string().describe("Kontonummer (11 siffer, påkrevd)"),
      type: z.string().default("NORMAL").describe("Kontotype: NORMAL, TAX_DEDUCTION, FOREIGN, eller CREDIT_CARD (UPPERCASE)"),
      bic: z.string().optional().describe("BIC/SWIFT-kode"),
      iban: z.string().optional().describe("IBAN"),
    }),
    execute: async ({ name, bankAccountNumber, type, bic, iban }) => {
      // Normalize type to uppercase
      const normalizedType = type.toUpperCase() as "NORMAL" | "TAX_DEDUCTION" | "FOREIGN" | "CREDIT_CARD";
      const validTypes = ["NORMAL", "TAX_DEDUCTION", "FOREIGN", "CREDIT_CARD"];
      if (!validTypes.includes(normalizedType)) {
        return {
          success: false,
          error: `Ugyldig kontotype: ${type}. Gyldige typer: ${validTypes.join(", ")}`,
        };
      }
      try {
        const account = await client.createBankAccount({
          name,
          bankAccountNumber,
          type: normalizedType,
          bic,
          iban,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Bankkonto opprettet: ${name}`,
          bankAccount: {
            id: account.bankAccountId,
            name: account.name,
            accountCode: account.accountCode,
            bankAccountNumber: account.bankAccountNumber,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette bankkonto",
        };
      }
    },
  });

  // ============================================
  // BANK BALANCES
  // ============================================

  const getBankBalances = tool({
    description: "Hent bankbeholdning/saldoer for alle bankkontoer.",
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

        const totalBalanceKr = result.reduce((sum, b) => sum + b.balanceKr, 0);

        return {
          success: true,
          date: date || new Date().toISOString().split("T")[0],
          balances: result,
          totalBalanceKr,
          summary: `Total bankbeholdning: ${totalBalanceKr.toLocaleString('nb-NO')} kr`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente banksaldoer",
        };
      }
    },
  });

  // ============================================
  // TRANSACTIONS
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
    description: "Slett/annuller en transaksjon. Oppretter en motpostering som reverserer alle posteringer.",
    parameters: z.object({
      transactionId: z.number().describe("Transaksjon-ID (IKKE journalEntryId!)"),
      description: z.string().describe("Begrunnelse for sletting"),
    }),
    execute: async ({ transactionId, description }) => {
      try {
        await client.deleteTransaction(transactionId, description);
        return { 
          success: true, 
          _operationComplete: true,
          message: "Transaksjon slettet/annullert" 
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette transaksjon",
        };
      }
    },
  });

  // ============================================
  // UNMATCHED BANK TRANSACTIONS (Avstemming)
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
          if (entries.length < pageSize) break; // Last page
          page++;
          if (page > 10) break; // Safety limit: max 1100 entries
        }
        const journalEntries = allJournalEntries;
        
        // 4. Konverter beløp til øre og finn margin (5 kr = 500 øre)
        const amountInOre = amount * 100;
        const marginInOre = 500; // 5 kr margin
        
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
            // Sjekk om linjen er på en bankkonto (starter med 19)
            // NOTE: Fiken API returns "account" (readOnly) on GET responses,
            // NOT "debitAccount"/"creditAccount" (writeOnly, used only on POST).
            // The "account" field format is "1920:10001" (accountCode:subAccount)
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
  // INBOX
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
  // BANK RECONCILIATION (Bankavstemming)
  // ============================================

  const reconcileBankStatement = tool({
    description: `Avstem kontoutskrift mot bokførte transaksjoner.
Tar strukturerte transaksjoner fra et kontoutdrag (som du har lest med Vision) og matcher dem mot bokførte journal entries i Fiken.
Returnerer oversikt over matchede (allerede bokført) og umatchede (trenger bokføring) transaksjoner.

VIKTIG: Du MÅ først lese kontoutskriften med Vision og ekstrahere alle transaksjoner til strukturert format FØR du kaller dette verktøyet.
Beløp skal være i KR (ikke øre). Negative beløp = utgifter/ut. Positive beløp = inntekter/inn.`,
    parameters: z.object({
      bankAccountCode: z.string().describe("Bankkonto-kode fra getBankAccounts (f.eks. '1920:10001')"),
      periodFrom: z.string().describe("Periodens start (YYYY-MM-DD)"),
      periodTo: z.string().describe("Periodens slutt (YYYY-MM-DD)"),
      transactions: z.array(z.object({
        date: z.string().describe("Transaksjonsdato (YYYY-MM-DD)"),
        amount: z.number().describe("Beløp i KR (negativ = ut, positiv = inn)"),
        description: z.string().describe("Beskrivelse fra kontoutdraget"),
      })).describe("Transaksjoner ekstrahert fra kontoutskriften"),
    }),
    execute: async ({ bankAccountCode, periodFrom, periodTo, transactions }) => {
      try {
        // 1. Hent alle journal entries for perioden (paginert)
        let allJournalEntries: any[] = [];
        let page = 0;
        const pageSize = 100;
        while (true) {
          const entries = await client.getJournalEntries({
            dateGe: periodFrom,
            dateLe: periodTo,
            pageSize,
            page,
          });
          allJournalEntries = allJournalEntries.concat(entries);
          if (entries.length < pageSize) break;
          page++;
          if (page > 10) break; // Safety limit: max 1100 entries
        }

        // 2. Filtrer journal entry lines som er på den angitte bankkontoen
        const bookedBankEntries: Array<{
          journalEntryId: number;
          transactionId?: number;
          date: string;
          amount: number; // i øre
          amountKr: number;
          description: string;
          matched: boolean;
        }> = [];

        for (const entry of allJournalEntries) {
          if (!entry.lines || !entry.journalEntryId) continue;

          for (const line of entry.lines) {
            // Fiken API returns "account" (readOnly) on GET responses
            const account = (line as any).account || line.debitAccount || line.creditAccount;
            if (!account) continue;

            // Match exact bank account code, or match the base account (e.g. "1920" matches "1920:10001")
            const matchesAccount = account === bankAccountCode || 
              account.startsWith(bankAccountCode.split(":")[0]);
            if (!matchesAccount) continue;

            bookedBankEntries.push({
              journalEntryId: entry.journalEntryId,
              transactionId: entry.transactionId,
              date: entry.date || periodFrom,
              amount: line.amount || 0,
              amountKr: (line.amount || 0) / 100,
              description: entry.description || "Ingen beskrivelse",
              matched: false,
            });
          }
        }

        // 3. Match kontoutdrag-transaksjoner mot bokførte entries
        const marginInOre = 500; // 5 kr margin
        const dayMargin = 5; // 5 dager margin

        const matched: Array<{
          index: number;
          statementDate: string;
          statementAmount: number;
          statementDescription: string;
          journalEntryId: number;
          journalDate: string;
          journalAmount: number;
          journalDescription: string;
        }> = [];

        const unmatched: Array<{
          index: number;
          date: string;
          amount: number;
          description: string;
        }> = [];

        for (let i = 0; i < transactions.length; i++) {
          const txn = transactions[i];
          const txnAmountOre = Math.round(txn.amount * 100);
          const txnDate = new Date(txn.date);

          // Find best matching booked entry (not already matched)
          let bestMatch: (typeof bookedBankEntries)[0] | null = null;
          let bestDateDiff = Infinity;

          for (const booked of bookedBankEntries) {
            if (booked.matched) continue;

            // Check amount match (within 5 kr margin)
            // Bank statement: negative = out, positive = in
            // Journal entry: amount on bank account can be positive or negative
            const amountDiff = Math.abs(Math.abs(txnAmountOre) - Math.abs(booked.amount));
            if (amountDiff > marginInOre) continue;

            // Check date match (within 5 days)
            const bookedDate = new Date(booked.date);
            const dateDiff = Math.abs(txnDate.getTime() - bookedDate.getTime()) / (1000 * 60 * 60 * 24);
            if (dateDiff > dayMargin) continue;

            // Pick closest date match
            if (dateDiff < bestDateDiff) {
              bestDateDiff = dateDiff;
              bestMatch = booked;
            }
          }

          if (bestMatch) {
            bestMatch.matched = true;
            matched.push({
              index: i + 1,
              statementDate: txn.date,
              statementAmount: txn.amount,
              statementDescription: txn.description,
              journalEntryId: bestMatch.journalEntryId,
              journalDate: bestMatch.date,
              journalAmount: bestMatch.amountKr,
              journalDescription: bestMatch.description,
            });
          } else {
            unmatched.push({
              index: i + 1,
              date: txn.date,
              amount: txn.amount,
              description: txn.description,
            });
          }
        }

        // 4. Build summary
        const totalCount = transactions.length;
        const matchedCount = matched.length;
        const unmatchedCount = unmatched.length;

        const summaryLines = [
          `Periode: ${periodFrom} til ${periodTo}`,
          `Bankkonto: ${bankAccountCode}`,
          `Totalt i kontoutskriften: ${totalCount} transaksjoner`,
          `Allerede bokført (matchet): ${matchedCount}`,
          `Trenger bokføring: ${unmatchedCount}`,
        ];

        if (unmatchedCount > 0) {
          summaryLines.push("");
          summaryLines.push("Transaksjoner som trenger bokføring:");
          for (const u of unmatched) {
            const sign = u.amount < 0 ? "ut" : "inn";
            summaryLines.push(`  ${u.index}. ${u.date} — ${u.description} — ${Math.abs(u.amount).toFixed(2)} kr (${sign})`);
          }
        }

        return {
          success: true,
          totalTransactions: totalCount,
          matchedCount,
          unmatchedCount,
          matched,
          unmatched,
          bookedEntriesCount: bookedBankEntries.length,
          summary: summaryLines.join("\n"),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke gjennomføre avstemming",
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
    // Bank accounts
    getBankAccounts,
    getBankAccount,
    createBankAccount,
    
    // Bank balances
    getBankBalances,
    
    // Transactions
    searchTransactions,
    getTransaction,
    deleteTransaction,
    
    // Avstemming
    getUnmatchedBankTransactions,
    reconcileBankStatement,
    
    // Inbox
    searchInbox,
    getInboxDocument,
    
    // Attachments
    uploadAttachmentToJournalEntry: attachmentTools.uploadAttachmentToJournalEntry,
  };
}

// Export the agent prompt
export { BANK_AGENT_PROMPT };

// Type for the bank agent tools
export type BankAgentTools = ReturnType<typeof createBankAgentTools>;
