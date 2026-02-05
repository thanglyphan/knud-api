/**
 * Fiken Accounting Agent
 * 
 * Spesialisert agent for regnskap- og bilag-operasjoner:
 * - Selskapsinfo
 * - Kontoer og kontosaldoer
 * - Bilag/journal entries (opprett, søk, hent, annuller)
 * - Prosjekter (CRUD)
 * - Teller-initialisering
 */

import { z } from "zod";
import { tool } from "ai";
import type { FikenClient } from "../../client.js";
import { 
  ACCOUNTING_AGENT_PROMPT,
  createAttachmentTools,
  createDelegationToolsForAgent,
  type PendingFile,
  type DelegationHandler,
} from "../shared/index.js";

/**
 * Creates the accounting agent tools
 */
export function createAccountingAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
  onDelegate?: DelegationHandler
) {
  
  // ============================================
  // COMPANY INFO
  // ============================================

  const getCompanyInfo = tool({
    description: "Hent informasjon om selskapet i Fiken.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const company = await client.getCompany();
        return {
          success: true,
          company: {
            name: company.name,
            organizationNumber: company.organizationNumber,
            slug: company.slug,
            address: company.address,
            phoneNumber: company.phoneNumber,
            email: company.email,
            creationDate: company.creationDate,
            hasApiAccess: company.hasApiAccess,
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
  // ACCOUNTS
  // ============================================

  const getAccounts = tool({
    description: "Hent kontoplan fra Fiken. Viser alle tilgjengelige kontoer.",
    parameters: z.object({
      fromAccount: z.string().optional().describe("Filtrer fra kontonummer (f.eks. '3000')"),
      toAccount: z.string().optional().describe("Filtrer til kontonummer (f.eks. '3999')"),
    }),
    execute: async ({ fromAccount, toAccount }) => {
      try {
        const accounts = await client.getAccounts({ 
          fromAccount, 
          toAccount,
          pageSize: 100,
        });
        return {
          success: true,
          count: accounts.length,
          accounts: accounts.map((a) => ({
            code: a.code,
            name: a.name,
          })),
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
    description: "Hent kontosaldoer for en dato.",
    parameters: z.object({
      date: z.string().describe("Dato for saldo (YYYY-MM-DD)"),
      fromAccount: z.string().optional().describe("Filtrer fra kontonummer (f.eks. '3000')"),
      toAccount: z.string().optional().describe("Filtrer til kontonummer (f.eks. '3999')"),
    }),
    execute: async ({ date, fromAccount, toAccount }) => {
      try {
        const balances = await client.getAccountBalances({
          date,
          fromAccount,
          toAccount,
          pageSize: 100,
        });
        return {
          success: true,
          date,
          count: balances.length,
          balances: balances.map((b) => ({
            code: b.code,
            name: b.name,
            balance: b.balance,
            balanceKr: b.balance / 100,
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
  // JOURNAL ENTRIES (Bilag)
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
            transactionId: e.transactionId,
            date: e.date,
            description: e.description,
            lines: e.lines?.map((l) => ({
              debitAccount: l.debitAccount,
              creditAccount: l.creditAccount,
              amount: l.amount,
              amountKr: (l.amount || 0) / 100,
            })),
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

  const createJournalEntry = tool({
    description: `Opprett et bilag/fri postering i Fiken. 
VIKTIG: Bilaget MÅ balansere (total debet = total kredit).
Hver linje må ha debitAccount og/eller creditAccount.
Beløp er alltid positivt - bruk debit/credit for å angi retning.
Bankkontoer (1920) krever reskontro-format som '1920:10001'.`,
    parameters: z.object({
      date: z.string().describe("Bilagsdato (YYYY-MM-DD)"),
      description: z.string().describe("Beskrivelse av bilaget (maks 160 tegn)"),
      lines: z.array(z.object({
        amount: z.number().describe("Beløp i øre (alltid POSITIV verdi, f.eks. 50000 = 500 kr)"),
        debitAccount: z.string().optional().describe("Debetkonto (f.eks. '5000' for lønn, '6300' for husleie)"),
        creditAccount: z.string().optional().describe("Kreditkonto (f.eks. '1920:10001' for bank, '2400' for leverandørgjeld)"),
        debitVatCode: z.number().optional().describe("MVA-kode for debet"),
        creditVatCode: z.number().optional().describe("MVA-kode for kredit"),
      })).describe("Bilagslinjer"),
    }),
    execute: async ({ date, description, lines }) => {
      try {
        // Validering: sjekk at hver linje har minst én konto
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.debitAccount && !line.creditAccount) {
            return {
              success: false,
              error: `Linje ${i + 1}: Må ha debitAccount og/eller creditAccount.`,
            };
          }
          if (line.amount <= 0) {
            return {
              success: false,
              error: `Linje ${i + 1}: Beløp må være positivt (${line.amount} øre).`,
            };
          }
          
          // Sjekk for bankkontoer uten reskontro-format
          const bankAccountPattern = /^19[0-9]{2}$/;
          if (line.debitAccount && bankAccountPattern.test(line.debitAccount)) {
            return {
              success: false,
              error: `Linje ${i + 1}: Bankkonto '${line.debitAccount}' mangler reskontro-format. Bruk format '${line.debitAccount}:XXXXX'.`,
            };
          }
          if (line.creditAccount && bankAccountPattern.test(line.creditAccount)) {
            return {
              success: false,
              error: `Linje ${i + 1}: Bankkonto '${line.creditAccount}' mangler reskontro-format. Bruk format '${line.creditAccount}:XXXXX'.`,
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
          _operationComplete: true,
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

  const cancelJournalEntry = tool({
    description: "Annuller/slett et bilag (fri postering). Oppretter en motpostering som reverserer alle posteringer.",
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
        
        // 2. Sjekk om allerede annullert
        if ((entry as Record<string, unknown>).offsetTransactionId) {
          return {
            success: false,
            error: `Bilaget er allerede annullert (motpostering-ID: ${(entry as Record<string, unknown>).offsetTransactionId})`
          };
        }
        
        // 3. Slett/annuller via transaksjonen
        await client.deleteTransaction(entry.transactionId, description);
        
        return { 
          success: true, 
          _operationComplete: true,
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

  // ============================================
  // PROJECTS
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
    description: "Opprett et nytt prosjekt i Fiken.",
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
          _operationComplete: true,
          message: `Prosjekt opprettet: ${name}`,
          project: {
            id: project.projectId,
            name: project.name,
            number: project.number,
            startDate: project.startDate,
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
        return { 
          success: true, 
          _operationComplete: true,
          message: "Prosjekt oppdatert", 
          project 
        };
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
        return { 
          success: true, 
          _operationComplete: true,
          message: "Prosjekt slettet" 
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette prosjekt",
        };
      }
    },
  });

  // ============================================
  // COUNTER INITIALIZATION
  // ============================================

  const checkAndInitializeCounters = tool({
    description: "Sjekk og initialiser alle tellere (faktura, kreditnota, tilbud, ordrebekreftelse). Kjør dette hvis bruker får feilmelding om manglende tellere.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi for tellere (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      const results: Record<string, { success: boolean; message: string }> = {};
      
      // Invoice counter
      try {
        await client.getInvoiceCounter();
        results.invoice = { success: true, message: "Allerede initialisert" };
      } catch {
        try {
          await client.createInvoiceCounter(startValue);
          results.invoice = { success: true, message: `Initialisert med startverdi ${startValue}` };
        } catch (e) {
          results.invoice = { success: false, message: e instanceof Error ? e.message : "Feil" };
        }
      }
      
      // Credit note counter
      try {
        await client.getCreditNoteCounter();
        results.creditNote = { success: true, message: "Allerede initialisert" };
      } catch {
        try {
          await client.createCreditNoteCounter(startValue);
          results.creditNote = { success: true, message: `Initialisert med startverdi ${startValue}` };
        } catch (e) {
          results.creditNote = { success: false, message: e instanceof Error ? e.message : "Feil" };
        }
      }
      
      // Offer counter
      try {
        await client.getOfferCounter();
        results.offer = { success: true, message: "Allerede initialisert" };
      } catch {
        try {
          await client.createOfferCounter(startValue);
          results.offer = { success: true, message: `Initialisert med startverdi ${startValue}` };
        } catch (e) {
          results.offer = { success: false, message: e instanceof Error ? e.message : "Feil" };
        }
      }
      
      // Order confirmation counter
      try {
        await client.getOrderConfirmationCounter();
        results.orderConfirmation = { success: true, message: "Allerede initialisert" };
      } catch {
        try {
          await client.createOrderConfirmationCounter(startValue);
          results.orderConfirmation = { success: true, message: `Initialisert med startverdi ${startValue}` };
        } catch (e) {
          results.orderConfirmation = { success: false, message: e instanceof Error ? e.message : "Feil" };
        }
      }
      
      const allSuccess = Object.values(results).every(r => r.success);
      
      return {
        success: allSuccess,
        message: allSuccess ? "Alle tellere er klare" : "Noen tellere kunne ikke initialiseres",
        counters: {
          faktura: results.invoice,
          kreditnota: results.creditNote,
          tilbud: results.offer,
          ordrebekreftelse: results.orderConfirmation,
        },
      };
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
    ? createDelegationToolsForAgent('accounting_agent', onDelegate)
    : {};

  // ============================================
  // RETURN ALL TOOLS
  // ============================================

  return {
    // Company
    getCompanyInfo,
    
    // Accounts
    getAccounts,
    getAccountBalances,
    
    // Journal entries
    searchJournalEntries,
    getJournalEntry,
    createJournalEntry,
    cancelJournalEntry,
    
    // Projects
    searchProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    
    // Counters
    checkAndInitializeCounters,
    
    // Attachments
    uploadAttachmentToJournalEntry: attachmentTools.uploadAttachmentToJournalEntry,
    
    // Delegation
    ...delegationTools,
  };
}

// Export the agent prompt
export { ACCOUNTING_AGENT_PROMPT };

// Type for the accounting agent tools
export type AccountingAgentTools = ReturnType<typeof createAccountingAgentTools>;
