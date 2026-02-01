/**
 * Account Helper - AI-basert kontovalg
 * 
 * Bruker GPT til å velge de mest relevante kontoene fra selskapets
 * kontoplan i Fiken, basert på beskrivelse av utgift/inntekt.
 * 
 * VIKTIG: Ingen hardkodede kontomappinger - AI tolker beskrivelsen
 * og velger fra selskapets faktiske kontoplan.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { type FikenClient } from "../client.js";

// Cache per selskap (companySlug) - 1 uke TTL
const accountCache = new Map<string, { accounts: Account[], timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 uke i millisekunder

interface Account {
  code: string;
  name: string;
}

// Schema for AI-responsen
const AccountSuggestionSchema = z.object({
  suggestions: z.array(z.object({
    code: z.string().describe("Kontonummer (f.eks. '7140')"),
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

export function createAccountHelper(client: FikenClient, companySlug: string) {
  
  /**
   * Hent alle kontoer fra Fiken med caching (1 uke TTL)
   */
  async function getAccountsWithCache(): Promise<Account[]> {
    const cached = accountCache.get(companySlug);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.accounts;
    }
    
    // Hent alle kontoer fra Fiken (paginert, max 100 per side)
    const allAccounts: Account[] = [];
    let page = 0;
    let hasMore = true;
    
    while (hasMore) {
      const accounts = await client.getAccounts({ page, pageSize: 100 });
      allAccounts.push(...accounts);
      
      // Hvis vi fikk færre enn 100, er vi på siste side
      if (accounts.length < 100) {
        hasMore = false;
      } else {
        page++;
        // Sikkerhetsstopp for å unngå uendelig løkke
        if (page > 50) hasMore = false;
      }
    }
    
    accountCache.set(companySlug, { accounts: allAccounts, timestamp: now });
    
    return allAccounts;
  }
  
  /**
   * Bruk AI til å velge de 3 mest relevante kontoene
   */
  async function suggestAccounts(
    description: string,
    accountType: "expense" | "income"
  ): Promise<SuggestAccountsResult> {
    const accounts = await getAccountsWithCache();
    
    // Filtrer på kontotype basert på kontonummer
    const filtered = accounts.filter(a => {
      const code = parseInt(a.code.split(":")[0]);
      if (accountType === "expense") return code >= 4000 && code <= 7999;
      if (accountType === "income") return code >= 3000 && code <= 3999;
      return true;
    });
    
    // Formater kontoliste for AI
    const accountList = filtered
      .map(a => `${a.code} - ${a.name}`)
      .join("\n");
    
    const typeLabel = accountType === "expense" ? "utgift/kostnad" : "inntekt";
    
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
- code og name MÅ matche eksakt med kontoplanen

=== MVA-FRADRAG OG vatNote REGLER ===

**REISEKOSTNADER (fly, tog, hotell, taxi, drosje, parkering, bompenger):**
- vatDeductible: true (har MVA-fradrag)
- vatNote: "Spør om innenlands eller utenlands reise"
- VIKTIG: Innenlands = 12% MVA (LOW), Utenlands = 0% (OUTSIDE)

**MAT OG BEVERTNING:**
- Hvis det kan være INTERNT (ansatte, møter): 
  - vatDeductible: true, vatNote: "Spør om dette var internt møte eller med eksterne/kunder"
- Hvis det tydelig er REPRESENTASJON (kunder, forretningsforbindelser):
  - vatDeductible: false, vatNote: "Representasjon - ingen MVA-fradrag"

**REPRESENTASJON (kundemiddag, kundegaver, forretningslunsj med eksterne):**
- vatDeductible: false (ALDRI MVA-fradrag)
- vatNote: "Representasjon - ingen MVA-fradrag, bruk vatType NONE"

**GAVER:**
- Hvis det kan være til kunde ELLER ansatt:
  - vatNote: "Spør om gaven var til kunde (representasjon) eller ansatt (velferd)"
- Kundegaver: vatDeductible: false
- Ansattgaver: vatDeductible: false

**VELFERD/SOSIALE KOSTNADER (julebord, sommerfest, teambuilding, overtidsmat):**
- vatDeductible: false (ALDRI MVA-fradrag)
- vatNote: "Velferdskostnad - ingen MVA-fradrag, bruk vatType NONE"

**VANLIGE DRIFTSKOSTNADER (kontor, programvare, telefon, utstyr, husleie):**
- vatDeductible: true (har MVA-fradrag, vanligvis 25%)
- vatNote: ikke nødvendig (kan utelates)

=== EKSEMPLER ===

Beskrivelse: "flyreise"
→ code: "7140", vatDeductible: true, vatNote: "Spør om innenlands eller utenlands reise"

Beskrivelse: "hotell"
→ code: "7140", vatDeductible: true, vatNote: "Spør om innenlands eller utenlands reise"

Beskrivelse: "lunsj"
→ code: "7350", vatDeductible: true, vatNote: "Spør om dette var internt møte eller med eksterne/kunder"

Beskrivelse: "middag med kunde"
→ code: "7320", vatDeductible: false, vatNote: "Representasjon - ingen MVA-fradrag, bruk vatType NONE"

Beskrivelse: "julebord"
→ code: "5900", vatDeductible: false, vatNote: "Velferdskostnad - ingen MVA-fradrag, bruk vatType NONE"

Beskrivelse: "gave"
→ code: "7320" eller "7420", vatNote: "Spør om gaven var til kunde (representasjon) eller ansatt (velferd)"

Beskrivelse: "programvare"
→ code: "6860", vatDeductible: true, vatNote: (kan utelates)

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
    accountType: "expense" | "income",
    excludeCodes: string[] = []
  ): Promise<SuggestAccountsResult> {
    const accounts = await getAccountsWithCache();
    
    // Filtrer på kontotype og ekskluder tidligere forslag
    const filtered = accounts.filter(a => {
      const code = parseInt(a.code.split(":")[0]);
      const codeStr = a.code.split(":")[0];
      
      // Ekskluder tidligere foreslåtte kontoer
      if (excludeCodes.includes(codeStr) || excludeCodes.includes(a.code)) {
        return false;
      }
      
      if (accountType === "expense") return code >= 4000 && code <= 7999;
      if (accountType === "income") return code >= 3000 && code <= 3999;
      return true;
    });
    
    const accountList = filtered
      .map(a => `${a.code} - ${a.name}`)
      .join("\n");
    
    const typeLabel = accountType === "expense" ? "utgift/kostnad" : "inntekt";
    
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
- code og name MÅ matche eksakt

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
   * Tøm cache for dette selskapet
   */
  function clearCache() {
    accountCache.delete(companySlug);
  }
  
  return {
    getAccountsWithCache,
    suggestAccounts,
    getMoreSuggestions,
    clearCache,
  };
}

export type AccountHelper = ReturnType<typeof createAccountHelper>;
