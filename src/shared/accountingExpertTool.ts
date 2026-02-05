/**
 * Accounting Expert Tool - Tool-wrapper for hovedagentene
 * 
 * Eksporterer en factory-funksjon som lager et tool som hovedagentene
 * (Fiken/Tripletex) kan bruke for å delegere generelle regnskapsspørsmål
 * til regnskapseksperten.
 */

import { tool } from "ai";
import { z } from "zod";
import { askAccountingExpert, type SuggestAccountsFn } from "./accountingExpert.js";

/**
 * Create an askAccountingExpert tool for a specific provider
 * 
 * @param provider - "fiken" or "tripletex"
 * @param suggestAccountsFn - Provider-specific function to get account suggestions
 * @returns A tool that can be added to the provider's tool set
 */
export function createAccountingExpertTool(
  provider: "fiken" | "tripletex",
  suggestAccountsFn: SuggestAccountsFn
) {
  return tool({
    description: `Spør regnskapseksperten om generelle regnskapsspørsmål og få profesjonelle råd.

**BRUK DETTE VERKTØYET NÅR brukeren stiller SPØRSMÅL som:**
- "Hvordan fører jeg...?" (purring, gave, representasjon, reise, etc.)
- "Hva er forskjellen mellom...?" (MVA-typer, kontoer, fradrag, etc.)
- "Hvilken konto brukes for...?" (julebord, kundemiddag, utstyr, etc.)
- "Må jeg føre...?" / "Trenger jeg å...?"
- "Er det MVA på...?" / "Får jeg MVA-fradrag for...?"
- "Hva er reglene for...?" (fradrag, avskrivning, representasjon, etc.)
- "Bør jeg...?" (aktivere vs kostnadsføre, etc.)

**IKKE bruk dette for OPPGAVER/HANDLINGER som:**
- "Registrer kjøp av..." → bruk ${provider === "fiken" ? "createPurchase" : "register_expense"}
- "Lag faktura til..." → bruk ${provider === "fiken" ? "createInvoice" : "create_invoice"}
- "Vis mine fakturaer" → bruk ${provider === "fiken" ? "searchInvoices" : "search_invoices"}
- "Send faktura..." → bruk ${provider === "fiken" ? "sendInvoice" : "send_invoice"}

Eksperten kan gi råd om kontovalg, MVA-regler, bokføring, og vil tilby å hjelpe med registrering når det er relevant.
Eksperten bruker selskapets faktiske kontoplan for kontoforslag.`,

    parameters: z.object({
      question: z
        .string()
        .describe("Brukerens spørsmål om regnskap, bokføring, MVA, kontoer, fradrag, etc."),
    }),

    execute: async ({ question }) => {
      console.log(`[askAccountingExpert] Provider: ${provider}, Question: "${question.substring(0, 100)}..."`);
      
      const result = await askAccountingExpert({
        question,
        provider,
        suggestAccountsFn,
      });

      if (!result.success) {
        console.log(`[askAccountingExpert] Failed:`, result.error);
        // Fallback: Returner feil så hovedagenten kan prøve selv
        return {
          success: false,
          fallback: true,
          error: result.error,
          message: "Regnskapseksperten kunne ikke svare. Prøv å svare basert på din egen kunnskap om norsk regnskap, og bruk suggestAccounts for kontovalg.",
        };
      }

      console.log(`[askAccountingExpert] Success, answer length: ${result.answer.length}, accounts: ${result.suggestedAccounts?.length || 0}`);
      
      return {
        success: true,
        answer: result.answer,
        suggestedAccounts: result.suggestedAccounts,
        hint: "Presenter svaret til brukeren. Hvis brukeren vil utføre en handling basert på rådet, bruk de vanlige verktøyene (createPurchase, createInvoice, etc.).",
      };
    },
  });
}
