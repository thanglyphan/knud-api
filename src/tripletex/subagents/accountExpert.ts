/**
 * Account Expert - AI-basert kontovalg for Tripletex
 * 
 * Bruker GPT til å velge de mest relevante kontoene fra selskapets
 * kontoplan i Tripletex, basert på beskrivelse av utgift/inntekt.
 * 
 * VIKTIG: Ingen hardkodede kontomappinger - AI tolker beskrivelsen
 * og velger fra selskapets faktiske kontoplan.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { type TripletexClient } from "../client.js";
import { type Account } from "../types.js";

// Cache per selskap (companyId) - 1 uke TTL
const accountCache = new Map<number, { accounts: Account[], timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 uke i millisekunder

// Schema for AI-responsen
const AccountSuggestionSchema = z.object({
  suggestions: z.array(z.object({
    number: z.number().describe("Kontonummer (f.eks. 7140)"),
    name: z.string().describe("Kontonavn fra kontoplanen"),
    reason: z.string().describe("Kort forklaring på hvorfor denne kontoen passer (maks 50 tegn)"),
    vatDeductible: z.boolean().describe("Har denne kontoen normalt MVA-fradrag i Norge?"),
    vatNote: z.string().optional().describe("Viktig veiledning om MVA-håndtering eller spørsmål som må avklares (f.eks. 'Spør om innenlands/utenlands')"),
  })).max(3).describe("De 3 mest relevante kontoene, sortert fra best til dårligst match"),
});

export type AccountSuggestion = z.infer<typeof AccountSuggestionSchema>["suggestions"][0];

export interface SuggestAccountsResult {
  suggestions: AccountSuggestion[];
  searchDescription: string;
}

export function createAccountExpert(client: TripletexClient, companyId: number) {
  
  /**
   * Hent alle kontoer fra Tripletex med caching (1 uke TTL)
   */
  async function getAccountsWithCache(): Promise<Account[]> {
    const cached = accountCache.get(companyId);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.accounts;
    }
    
    // Hent alle kontoer fra Tripletex (paginert, max 1000 per side)
    const allAccounts: Account[] = [];
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
      const response = await client.getAccounts({ from, count: 1000 });
      allAccounts.push(...response.values);
      
      // Hvis vi fikk færre enn 1000, er vi på siste side
      if (response.values.length < 1000) {
        hasMore = false;
      } else {
        from += 1000;
        // Sikkerhetsstopp for å unngå uendelig løkke
        if (from > 10000) hasMore = false;
      }
    }
    
    // Filtrer ut inaktive kontoer
    const activeAccounts = allAccounts.filter(a => !a.isInactive);
    
    accountCache.set(companyId, { accounts: activeAccounts, timestamp: now });
    
    return activeAccounts;
  }
  
  /**
   * Bruk AI til å velge de 3 mest relevante kontoene
   */
  async function suggestAccounts(
    description: string,
    accountType: "expense" | "income" | "asset" | "liability"
  ): Promise<SuggestAccountsResult> {
    const accounts = await getAccountsWithCache();
    
    // Filtrer på kontotype basert på kontonummer (Norsk Standard Kontoplan)
    const filtered = accounts.filter(a => {
      const code = a.number ?? 0;
      switch (accountType) {
        case "expense":
          return code >= 4000 && code <= 7999;
        case "income":
          return code >= 3000 && code <= 3999;
        case "asset":
          return code >= 1000 && code <= 1999;
        case "liability":
          return code >= 2000 && code <= 2999;
        default:
          return true;
      }
    });
    
    // Formater kontoliste for AI
    const accountList = filtered
      .map(a => `${a.number} - ${a.name}`)
      .join("\n");
    
    const typeLabels: Record<string, string> = {
      expense: "utgift/kostnad",
      income: "inntekt",
      asset: "eiendel",
      liability: "gjeld/egenkapital"
    };
    const typeLabel = typeLabels[accountType] || "transaksjon";
    
    // Kall AI for å velge kontoer
    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: AccountSuggestionSchema,
      prompt: `Du er en norsk regnskapsekspert. Velg de 3 mest relevante kontoene for denne ${typeLabel}en.

BESKRIVELSE: "${description}"

KONTOPLAN (${filtered.length} kontoer):
${accountList}

REGLER:
- Velg kontoer basert på norsk regnskapspraksis (Norsk Standard Kontoplan)
- Første forslag skal være det BESTE valget
- "reason" skal være en kort, presis forklaring (maks 50 tegn)
- Bruk KUN kontoer som finnes i kontoplanen over
- number og name MÅ matche eksakt med kontoplanen

=== MVA-FRADRAG OG vatNote REGLER ===

**REISEKOSTNADER (fly, tog, hotell, taxi, drosje, parkering, bompenger):**
- vatDeductible: true (har MVA-fradrag)
- vatNote: "Spør om innenlands eller utenlands reise"
- VIKTIG: Innenlands = 12% MVA (lav sats), Utenlands = 0% (ingen MVA)

**MAT OG BEVERTNING:**
- Hvis det kan være INTERNT (ansatte, møter): 
  - vatDeductible: true, vatNote: "Spør om dette var internt møte eller med eksterne/kunder"
- Hvis det tydelig er REPRESENTASJON (kunder, forretningsforbindelser):
  - vatDeductible: false, vatNote: "Representasjon - ingen MVA-fradrag"

**REPRESENTASJON (kundemiddag, kundegaver, forretningslunsj med eksterne):**
- vatDeductible: false (ALDRI MVA-fradrag)
- vatNote: "Representasjon - ingen MVA-fradrag"

**GAVER:**
- Hvis det kan være til kunde ELLER ansatt:
  - vatNote: "Spør om gaven var til kunde (representasjon) eller ansatt (velferd)"
- Kundegaver: vatDeductible: false
- Ansattgaver: vatDeductible: false

**VELFERD/SOSIALE KOSTNADER (julebord, sommerfest, teambuilding, overtidsmat):**
- vatDeductible: false (ALDRI MVA-fradrag)
- vatNote: "Velferdskostnad - ingen MVA-fradrag"

**VANLIGE DRIFTSKOSTNADER (kontor, programvare, telefon, utstyr, husleie):**
- vatDeductible: true (har MVA-fradrag, vanligvis 25%)
- vatNote: ikke nødvendig (kan utelates)

=== EKSEMPLER ===

Beskrivelse: "flyreise"
→ number: 7140, vatDeductible: true, vatNote: "Spør om innenlands eller utenlands reise"

Beskrivelse: "hotell"
→ number: 7140, vatDeductible: true, vatNote: "Spør om innenlands eller utenlands reise"

Beskrivelse: "lunsj"
→ number: 7350, vatDeductible: true, vatNote: "Spør om dette var internt møte eller med eksterne/kunder"

Beskrivelse: "middag med kunde"
→ number: 7320, vatDeductible: false, vatNote: "Representasjon - ingen MVA-fradrag"

Beskrivelse: "julebord"
→ number: 5900, vatDeductible: false, vatNote: "Velferdskostnad - ingen MVA-fradrag"

Beskrivelse: "gave"
→ number: 7320 eller 7420, vatNote: "Spør om gaven var til kunde (representasjon) eller ansatt (velferd)"

Beskrivelse: "programvare"
→ number: 6860, vatDeductible: true, vatNote: (kan utelates)

Hvis ingen kontoer passer godt for beskrivelsen, returner tom liste.`,
    });
    
    return {
      suggestions: object.suggestions,
      searchDescription: description,
    };
  }
  
  /**
   * Hent flere kontoforslag (ekskluderer tidligere foreslåtte kontoer)
   */
  async function getMoreSuggestions(
    description: string,
    accountType: "expense" | "income" | "asset" | "liability",
    excludeNumbers: number[] = []
  ): Promise<SuggestAccountsResult> {
    const accounts = await getAccountsWithCache();
    
    // Filtrer på kontotype og ekskluder tidligere forslag
    const filtered = accounts.filter(a => {
      const code = a.number ?? 0;
      
      // Ekskluder tidligere foreslåtte kontoer
      if (excludeNumbers.includes(code)) {
        return false;
      }
      
      switch (accountType) {
        case "expense":
          return code >= 4000 && code <= 7999;
        case "income":
          return code >= 3000 && code <= 3999;
        case "asset":
          return code >= 1000 && code <= 1999;
        case "liability":
          return code >= 2000 && code <= 2999;
        default:
          return true;
      }
    });
    
    const accountList = filtered
      .map(a => `${a.number} - ${a.name}`)
      .join("\n");
    
    const typeLabels: Record<string, string> = {
      expense: "utgift/kostnad",
      income: "inntekt",
      asset: "eiendel",
      liability: "gjeld/egenkapital"
    };
    const typeLabel = typeLabels[accountType] || "transaksjon";
    
    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: AccountSuggestionSchema,
      prompt: `Du er en norsk regnskapsekspert. De første forslagene passet ikke. Velg 3 ANDRE relevante kontoer for denne ${typeLabel}en.

BESKRIVELSE: "${description}"

KONTOPLAN (ekskludert tidligere forslag):
${accountList}

REGLER:
- Velg kontoer basert på norsk regnskapspraksis
- Første forslag skal være det beste av de gjenværende
- "reason" skal være kort og presis (maks 50 tegn)
- Bruk KUN kontoer fra listen over
- number og name MÅ matche eksakt

MVA-FRADRAG OG vatNote:
- Reisekostnader: vatDeductible=true, vatNote="Spør om innenlands eller utenlands reise"
- Mat/bevertning: vatNote="Spør om internt møte eller med eksterne/kunder"
- Representasjon: vatDeductible=false, vatNote="Representasjon - ingen MVA-fradrag"
- Velferd/sosiale: vatDeductible=false, vatNote="Velferdskostnad - ingen MVA-fradrag"
- Gaver: vatNote="Spør om gave til kunde eller ansatt"
- Vanlige driftskostnader: vatDeductible=true

Hvis ingen kontoer passer, returner tom liste.`,
    });
    
    return {
      suggestions: object.suggestions,
      searchDescription: description,
    };
  }
  
  /**
   * Finn konto etter kontonummer
   */
  async function getAccountByNumber(accountNumber: number): Promise<Account | null> {
    const accounts = await getAccountsWithCache();
    return accounts.find(a => a.number === accountNumber) ?? null;
  }
  
  /**
   * Tøm cache for dette selskapet
   */
  function clearCache() {
    accountCache.delete(companyId);
  }
  
  return {
    getAccountsWithCache,
    suggestAccounts,
    getMoreSuggestions,
    getAccountByNumber,
    clearCache,
  };
}

export type AccountExpert = ReturnType<typeof createAccountExpert>;
