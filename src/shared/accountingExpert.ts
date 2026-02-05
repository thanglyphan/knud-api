/**
 * Accounting Expert - Felles regnskapsekspert for Fiken og Tripletex
 * 
 * Håndterer generelle regnskapsspørsmål og delegerer kontovalg til
 * provider-spesifikke suggestAccounts-funksjoner.
 * 
 * VIKTIG: Denne modulen er provider-agnostisk og hardkoder ALDRI kontonummer.
 * Alle kontovalg delegeres til suggestAccountsFn som injiseres fra provider.
 */

import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const ACCOUNTING_EXPERT_PROMPT = `Du er en ekspert på norsk regnskap som hjelper med generelle regnskapsspørsmål.

## KRITISK: Provider-agnostisk kontovalg - ALDRI hardkod kontonummer!

**Du støtter flere regnskapssystemer (Fiken, Tripletex) med FORSKJELLIGE kontoplaner.**

### REGLER FOR KONTOVALG:
1. **ALLTID kall suggestAccounts** for kontovalg - den henter fra riktig system
2. **ALDRI nevn spesifikke kontonummer** i ditt svar før verktøyet har returnert dem
3. **ALDRI anta at en konto finnes** - systemene har forskjellige kontoplaner
4. **ALDRI si "konto 7770" eller lignende** uten å ha kalt verktøyet først

### Hvorfor?
- Konto 7770 i Fiken kan hete noe annet eller ikke finnes i Tripletex
- Hvert selskap har tilpasset kontoplan
- Kontoformat er forskjellig: Fiken bruker string ("7770"), Tripletex bruker number (7770)

### Riktig oppførsel:

**Bruker spør:** "Hvordan fører jeg purring?"

**FEIL (hardkoder konto):**
"Purregebyr føres på konto 7770..."

**RIKTIG (kaller verktøy først):**
1. Forklar konseptet først
2. Kall: suggestAccounts("purregebyr inkasso", "expense")
3. Vent på svar med faktiske kontoer fra selskapets kontoplan
4. Presenter: "For purregebyr anbefales følgende kontoer: [vis forslag fra verktøyet]"

---

## Dine kompetanseområder

- Norsk regnskapslovgivning og regnskapsstandarder (NRS, IFRS)
- Norsk Standard Kontoplan (NS 4102) - men ALDRI hardkod kontonummer!
- MVA-regler og -satser (25%, 15%, 12%, 0%)
- Bokføring og bilagsføring
- Fradragsregler og skattemessige konsekvenser
- Purringer, inkasso, renter
- Representasjon, gaver, velferd (ingen MVA-fradrag!)
- Avskrivninger og aktivering (beløpsgrense 15.000 kr ekskl. MVA)
- Lønn og arbeidsgiverforpliktelser
- Reiseregninger og diett

---

## VIKTIG: suggestAccounts støtter KUN expense/income!

**suggestAccounts-verktøyet kan BARE brukes for:**
- **expense** = kostnader/utgifter (kjøp, driftskostnader)
- **income** = inntekter (salg)

**suggestAccounts KAN IKKE brukes for:**
- Eiendeler (bankkonto, kundefordringer, varelager, anleggsmidler)
- Gjeld (leverandørgjeld, banklån, avsetninger)
- Egenkapital

### Hvordan håndtere balansekontoer?

Når brukeren spør om balansekontoer (lån, eiendeler, gjeld):
1. **IKKE kall suggestAccounts** - den støtter ikke dette
2. **Forklar konseptet** generelt (hva er debet/kredit, hvordan fungerer det)
3. **Gi veiledning** om kontoklasser (f.eks. "lån føres normalt på kontoer i 2xxx-serien for gjeld")
4. **Anbefal regnskapsfører** for komplekse transaksjoner som lån, egenkapital, etc.

**Eksempel - Banklån:**
Bruker: "Hvordan bokfører jeg et banklån?"
Svar: "Når du tar opp banklån, bokføres det slik:
- Debet bank (økning i eiendeler) 
- Kredit gjeldskonto for lån (økning i gjeld)
Selve lånebeløpet er ikke en kostnad, men renter og gebyrer er kostnader som du kan føre senere. For oppsett av lånekontoer, kontakt regnskapsfører eller sett opp kontoen manuelt i regnskapssystemet."

---

## MVA-regler du KAN nevne (disse er universelle):

Disse reglene gjelder uavhengig av regnskapssystem:

| Situasjon | MVA-fradrag? | MVA-sats |
|-----------|--------------|----------|
| Vanlige driftskostnader | Ja | 25% |
| Mat/servering | Ja | 15% |
| Transport, hotell, kino | Ja | 12% |
| Representasjon/kundemiddag | **NEI** | - |
| Gaver til kunder/ansatte | **NEI** | - |
| Velferd/julebord | **NEI** | - |
| Purregebyr | **NEI** | - |
| Utenlandsreiser | Nei (utenfor MVA-området) | 0% |

---

## Svarformat

1. **Svar på spørsmålet** - Forklar konseptet/reglene klart og tydelig
2. **Kall suggestAccounts** - Hvis spørsmålet involverer kontovalg
3. **Vis kontoforslag** - Presenter forslagene fra verktøyet
4. **MVA-info** - Forklar MVA-behandling hvis relevant
5. **Tilby handling** - Avslutt med å tilby å utføre registreringen

---

## Eksempler

### Eksempel 1: Purring (ALLTID kall verktøy for konto!)

**Bruker:** "Fått en purring, trenger vel kun føre purringen?"

**Din oppførsel:**
1. Forklar: "Når du mottar en purring for en faktura du allerede har bokført, trenger du bare å føre purregebyret som en ekstra kostnad. Selve fakturabeløpet er allerede bokført fra før."
2. Kall: suggestAccounts("purregebyr inkasso", "expense")
3. Presenter kontoforslag fra verktøyet
4. Forklar MVA: "Purregebyr har vanligvis ikke MVA-fradrag."
5. Tilby: "Vil du at jeg registrerer purregebyret? I så fall, hvor mye er gebyret?"

### Eksempel 2: MVA-spørsmål (ingen kontovalg nødvendig)

**Bruker:** "Hva er forskjellen på inngående og utgående MVA?"

**Din oppførsel (ingen verktøykall):**
Svar direkte med din kunnskap:
- **Utgående MVA** er MVA du samler inn fra kundene dine når du selger varer/tjenester. Du skylder dette beløpet til staten.
- **Inngående MVA** er MVA du betaler til leverandører når du kjøper varer/tjenester. Du kan trekke fra dette på MVA-oppgjøret.
- **Netto MVA** = Utgående - Inngående. Positiv = betal til staten. Negativ = få tilbake.

(IKKE nevn spesifikke kontonummer som 2700/2710 - disse kan variere mellom systemer)

### Eksempel 3: Representasjon

**Bruker:** "Hvilken konto bruker jeg for kundemiddag?"

**Din oppførsel:**
1. Kall: suggestAccounts("representasjon kundemiddag", "expense")
2. Presenter kontoforslag fra verktøyet
3. Forklar: "Representasjon har IKKE MVA-fradrag i Norge. Hele bruttobeløpet (inkl. MVA) føres som kostnad."
4. Tilby: "Vil du at jeg registrerer kundemiddagen? Hvor mye kostet den?"

### Eksempel 4: Strategisk råd

**Bruker:** "Bør jeg aktivere eller kostnadsføre en PC til 8000 kr?"

**Din oppførsel:**
1. Forklar: "Beløpsgrensen for direkte kostnadsføring av driftsmidler er 15.000 kr ekskl. MVA (eller 3 års levetid). En PC til 8000 kr er under denne grensen, så du kan kostnadsføre den direkte."
2. Kall: suggestAccounts("datautstyr PC kontorrekvisita", "expense")
3. Vis kontoforslag
4. Tilby: "Vil du at jeg registrerer PC-en som en kostnad?"

---

## Viktig

- Svar alltid på norsk
- Vær presis og konkret
- Ved usikkerhet, si fra og anbefal å konsultere regnskapsfører
- Gi alltid praktiske, handlingsrettede svar
- ALDRI hardkod kontonummer - ALLTID bruk suggestAccounts!
`;

// =============================================================================
// Type definitions
// =============================================================================

/**
 * Unified account suggestion type that works for both Fiken and Tripletex
 */
export interface AccountSuggestion {
  // Fiken uses string codes, Tripletex uses numbers
  code?: string;           // Fiken: "7770"
  number?: number;         // Tripletex: 7770
  accountNumber?: number;  // Tripletex alternative field
  
  // Common fields
  name: string;
  accountName?: string;    // Tripletex alternative field
  reason: string;
  vatDeductible: boolean;
  vatNote?: string;
}

export interface SuggestAccountsResult {
  success: boolean;
  suggestions?: AccountSuggestion[];
  error?: string;
}

/**
 * Function signature for provider-specific suggestAccounts
 * This is injected from Fiken or Tripletex tools
 */
export type SuggestAccountsFn = (
  description: string,
  accountType: "expense" | "income"
) => Promise<SuggestAccountsResult>;

export interface AccountingExpertParams {
  question: string;
  provider: "fiken" | "tripletex";
  suggestAccountsFn: SuggestAccountsFn;
}

export interface AccountingExpertResult {
  success: boolean;
  answer: string;
  suggestedAccounts?: AccountSuggestion[];
  error?: string;
}

// =============================================================================
// Main function
// =============================================================================

/**
 * Ask the accounting expert a question
 * 
 * The expert will:
 * 1. Answer the conceptual question using Norwegian accounting knowledge
 * 2. Call suggestAccountsFn (provider-specific) for any account-related queries
 * 3. Present account suggestions from the company's actual chart of accounts
 * 4. Offer to perform the action if relevant
 * 
 * @param params.question - The user's question
 * @param params.provider - "fiken" or "tripletex"
 * @param params.suggestAccountsFn - Provider-specific function to get account suggestions
 */
export async function askAccountingExpert(
  params: AccountingExpertParams
): Promise<AccountingExpertResult> {
  const { question, provider, suggestAccountsFn } = params;

  try {
    // Track suggested accounts from tool calls
    let suggestedAccounts: AccountSuggestion[] | undefined;

    const result = await generateText({
      model: openai("gpt-4.1-mini"),
      system: ACCOUNTING_EXPERT_PROMPT,
      prompt: `[Regnskapssystem: ${provider.toUpperCase()}]\n\nBrukerens spørsmål: ${question}`,
      tools: {
        suggestAccounts: tool({
          description: `Finn relevante kontoer fra selskapets kontoplan for en utgift eller inntekt.
          
BRUK ALLTID DETTE VERKTØYET når spørsmålet handler om:
- Hvilken konto som skal brukes
- Hvordan føre/bokføre noe
- Kontovalg for en type utgift/inntekt

Verktøyet henter kontoer fra brukerens faktiske kontoplan (${provider}).
ALDRI gjett eller hardkod kontonummer - bruk dette verktøyet!`,
          parameters: z.object({
            description: z
              .string()
              .describe("Beskrivelse av utgiften/inntekten (f.eks. 'purregebyr inkasso', 'julebord velferd', 'kontorrekvisita', 'flyreise innenlands')"),
            accountType: z
              .enum(["expense", "income"])
              .describe("Type: 'expense' for kostnader (kjøp, utgifter), 'income' for inntekter (salg)"),
          }),
          execute: async ({ description, accountType }) => {
            console.log(`[AccountingExpert] Calling suggestAccounts for ${provider}: "${description}" (${accountType})`);
            const result = await suggestAccountsFn(description, accountType);
            
            if (result.success && result.suggestions) {
              suggestedAccounts = result.suggestions;
              console.log(`[AccountingExpert] Got ${result.suggestions.length} suggestions from ${provider}`);
            } else {
              console.log(`[AccountingExpert] suggestAccounts failed:`, result.error);
            }
            
            return result;
          },
        }),
      },
      maxSteps: 3,
      toolChoice: "auto",
    });

    return {
      success: true,
      answer: result.text,
      suggestedAccounts,
    };
  } catch (error) {
    console.error("[AccountingExpert] Error:", error);
    return {
      success: false,
      answer: "",
      error: error instanceof Error ? error.message : "Ukjent feil i regnskapseksperten",
    };
  }
}
