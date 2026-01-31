/**
 * Account Helper - Smart konto-søk og caching
 * 
 * Gir AI-agenten mulighet til å finne riktig regnskapskonto
 * basert på beskrivelse av utgift/inntekt.
 */

import { type FikenClient } from "../client.js";

// Cache per selskap (companySlug) - 1 uke TTL
const accountCache = new Map<string, { accounts: Account[], timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 uke i millisekunder

interface Account {
  code: string;
  name: string;
}

export interface AccountSearchResult {
  code: string;
  name: string;
  matchScore: number;
  reason: string;
  vatDeductible: boolean; // true = MVA-fradrag tillatt, false = IKKE fradragsberettiget
}

// Nøkkelord-mapping for vanlige utgiftstyper til kontoområder
const ACCOUNT_KEYWORDS: Record<string, { keywords: string[], preferredRange: string, description: string, vatDeductible?: boolean }> = {
  // Varekostnader (4xxx)
  "varekjøp": { 
    keywords: ["vare", "varekjøp", "innkjøp", "lager", "råvare"], 
    preferredRange: "4000-4999",
    description: "Varekostnader og innkjøp for videresalg"
  },
  
  // Lønnskostnader (5xxx)
  "lønn": { 
    keywords: ["lønn", "løn", "salary", "wage", "utbetaling ansatt"], 
    preferredRange: "5000-5099",
    description: "Lønn til ansatte"
  },
  "arbeidsgiveravgift": { 
    keywords: ["arbeidsgiveravgift", "aga", "arbeidsgiver"], 
    preferredRange: "5400-5499",
    description: "Arbeidsgiveravgift"
  },
  "pensjon": { 
    keywords: ["pensjon", "otp", "innskuddspensjon"], 
    preferredRange: "5200-5299",
    description: "Pensjonskostnader"
  },
  "feriepenger": { 
    keywords: ["feriepenger", "ferie"], 
    preferredRange: "5280-5289",
    description: "Feriepenger"
  },
  
  // Velferdstiltak (5900-5999) - IKKE MVA-fradrag
  "overtidsmat": {
    keywords: ["overtidsmat", "overtid mat", "mat overtid", "kveldsmat", "nattmat"],
    preferredRange: "5915-5915",
    description: "Overtidsmat for ansatte",
    vatDeductible: false
  },
  "velferd": {
    keywords: ["velferd", "velferdstiltak", "sosiale tiltak", "ansattgoder", "personalgoder"],
    preferredRange: "5900-5999",
    description: "Velferdstiltak for ansatte",
    vatDeductible: false
  },
  "julebord": {
    keywords: ["julebord", "sommerfest", "firmafest", "personalfest", "kick-off", "teambuilding"],
    preferredRange: "5910-5920",
    description: "Sosiale arrangementer for ansatte",
    vatDeductible: false
  },
  "gave_ansatt": {
    keywords: ["gave ansatt", "ansattgave", "jubileumsgave", "oppmerksomhet ansatt"],
    preferredRange: "5990-5999",
    description: "Gaver til ansatte",
    vatDeductible: false
  },
  
  // Driftskostnader (6xxx)
  "leie": { 
    keywords: ["leie", "husleie", "lokale", "kontorlokale", "kontorleie", "fellesutgifter"], 
    preferredRange: "6300-6399",
    description: "Leie av lokaler"
  },
  "strøm": { 
    keywords: ["strøm", "elektrisitet", "energi", "kraft"], 
    preferredRange: "6340-6349",
    description: "Strøm og energi"
  },
  "forsikring": { 
    keywords: ["forsikring", "insurance"], 
    preferredRange: "6400-6499",
    description: "Forsikringskostnader"
  },
  "inventar": { 
    keywords: ["inventar", "møbler", "utstyr", "småanskaffelser", "kontorutstyr"], 
    preferredRange: "6500-6599",
    description: "Inventar og småanskaffelser"
  },
  "vedlikehold": { 
    keywords: ["vedlikehold", "reparasjon", "service", "reperasjon"], 
    preferredRange: "6600-6699",
    description: "Vedlikehold og reparasjoner"
  },
  "regnskap": { 
    keywords: ["regnskap", "revisjon", "revisor", "regnskapsfører", "bokføring", "årsoppgjør"], 
    preferredRange: "6700-6799",
    description: "Regnskaps- og revisjonstjenester"
  },
  "kontor": { 
    keywords: ["kontor", "rekvisita", "papir", "skriver", "kontorrekvisita", "kontormateriell"], 
    preferredRange: "6800-6899",
    description: "Kontorrekvisita"
  },
  "programvare": { 
    keywords: ["programvare", "software", "lisens", "abonnement", "saas", "it", "sky", "cloud", "app"], 
    preferredRange: "6850-6899",
    description: "Programvare og IT-tjenester"
  },
  "telefon": { 
    keywords: ["telefon", "mobil", "internett", "bredbånd", "data", "fiber", "nett"], 
    preferredRange: "6900-6999",
    description: "Telefon og internett"
  },
  
  // Andre driftskostnader (7xxx)
  "drivstoff": { 
    keywords: ["drivstoff", "bensin", "diesel", "bil", "kjøretøy", "bompenger", "parkering bil"], 
    preferredRange: "7000-7099",
    description: "Drivstoff og bilkostnader"
  },
  "reise": { 
    keywords: ["reise", "fly", "tog", "buss", "transport", "taxi", "flybillett", "togbillett", "reisekostnad"], 
    preferredRange: "7100-7199",
    description: "Reisekostnader"
  },
  "diett": { 
    keywords: ["diett", "kostgodtgjørelse", "diettkostnad"], 
    preferredRange: "7150-7159",
    description: "Diett og kostgodtgjørelse"
  },
  "parkering": { 
    keywords: ["parkering", "p-avgift"], 
    preferredRange: "7160-7169",
    description: "Parkeringskostnader"
  },
  "markedsføring": { 
    keywords: ["markedsføring", "reklame", "annonse", "facebook", "google ads", "annonsering", "markedføring", "kampanje"], 
    preferredRange: "7300-7349",
    description: "Markedsføring og reklame"
  },
  "representasjon": { 
    keywords: ["representasjon", "gave", "kundemøte", "kundegave", "forretningsgave", "middag kunde", "restaurant kunde"], 
    preferredRange: "7320-7329",
    description: "Representasjon (med kunder/forretningsforbindelser)",
    vatDeductible: false
  },
  "servering": { 
    keywords: ["servering", "bevertning", "mat", "lunsj", "middag", "kantine", "kaffe", "snacks", "mat møte", "lunsj møte", "frokost"], 
    preferredRange: "7350-7399",
    description: "Servering og bevertning (internt/møter)"
  },
  "kontingent": { 
    keywords: ["kontingent", "medlemskap", "forening", "forbund"], 
    preferredRange: "7400-7499",
    description: "Kontingenter og medlemskap"
  },
  "gave_forretning": {
    keywords: ["gave", "forretningsgave", "kundegave", "gave kunde", "gave leverandør"],
    preferredRange: "7420-7429",
    description: "Gaver til forretningsforbindelser",
    vatDeductible: false
  },
  "tap": { 
    keywords: ["tap", "avskriving fordring", "konstatert tap"], 
    preferredRange: "7800-7899",
    description: "Tap på fordringer"
  },
  "bank": { 
    keywords: ["bankgebyr", "gebyr", "kortgebyr", "transaksjonsgebyr"], 
    preferredRange: "7770-7779",
    description: "Bankgebyrer"
  },
  
  // Inntekter (3xxx)
  "salg": { 
    keywords: ["salg", "inntekt", "omsetning", "salgsinntekt"], 
    preferredRange: "3000-3099",
    description: "Salgsinntekter"
  },
  "tjeneste": { 
    keywords: ["tjeneste", "konsulent", "rådgivning", "honorar", "timebasert"], 
    preferredRange: "3100-3199",
    description: "Tjenesteinntekter"
  },
  "avgiftsfri": { 
    keywords: ["avgiftsfri", "momsfri", "eksport"], 
    preferredRange: "3200-3299",
    description: "Avgiftsfrie inntekter"
  },
};

export function createAccountHelper(client: FikenClient, companySlug: string) {
  
  /**
   * Hent alle kontoer med caching (1 uke TTL)
   */
  async function getAccountsWithCache(): Promise<Account[]> {
    const cached = accountCache.get(companySlug);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.accounts;
    }
    
    // Hent alle kontoer fra Fiken (paginert, max 100 per side)
    // Vi henter flere sider for å få alle kontoer
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
   * Beregn match-score for en konto basert på søkeord
   */
  function calculateMatchScore(account: Account, searchTerms: string[]): { score: number; reasons: string[]; vatDeductible: boolean } {
    const nameLower = account.name.toLowerCase();
    const codeLower = account.code.toLowerCase();
    let score = 0;
    const reasons: string[] = [];
    let vatDeductible = true; // Default: MVA-fradrag tillatt
    
    for (const term of searchTerms) {
      const termLower = term.toLowerCase();
      
      // Eksakt match i kontonavn (høyest score)
      if (nameLower === termLower) {
        score += 20;
        reasons.push(`Eksakt match: "${account.name}"`);
        continue;
      }
      
      // Delvis match i kontonavn
      if (nameLower.includes(termLower)) {
        score += 10;
        reasons.push(`Navn inneholder "${term}"`);
        continue;
      }
      
      // Sjekk om søkeordet er i et ord i kontonavnet
      const nameWords = nameLower.split(/[\s\/,.-]+/);
      if (nameWords.some(word => word.startsWith(termLower) || termLower.startsWith(word))) {
        score += 7;
        reasons.push(`Delvis ordmatch for "${term}"`);
        continue;
      }
      
      // Sjekk keyword-mapping for å finne riktig kontoområde
      for (const [category, data] of Object.entries(ACCOUNT_KEYWORDS)) {
        const matchesKeyword = data.keywords.some(kw => 
          termLower.includes(kw) || kw.includes(termLower) ||
          termLower.split(/\s+/).some(t => kw.includes(t) && t.length > 2)
        );
        
        if (matchesKeyword) {
          const [from, to] = data.preferredRange.split("-").map(Number);
          const accountCode = parseInt(account.code.split(":")[0]);
          
          if (accountCode >= from && accountCode <= to) {
            score += 5;
            reasons.push(`Matcher kategori "${category}" (${data.description})`);
            
            // Sjekk om denne kategorien har MVA-fradrag
            if (data.vatDeductible === false) {
              vatDeductible = false;
              reasons.push(`⚠️ IKKE MVA-fradrag for ${category}`);
            }
          }
        }
      }
    }
    
    // Sjekk også kontonummeret direkte for kjente kontoer uten MVA-fradrag
    const accountCode = parseInt(account.code.split(":")[0]);
    
    // 5900-5999: Velferdstiltak - ikke MVA-fradrag
    if (accountCode >= 5900 && accountCode <= 5999) {
      vatDeductible = false;
      if (!reasons.some(r => r.includes("IKKE MVA-fradrag"))) {
        reasons.push("⚠️ Konto 59xx (velferd) har IKKE MVA-fradrag");
      }
    }
    
    // 7320-7329: Representasjon - ikke MVA-fradrag
    if (accountCode >= 7320 && accountCode <= 7329) {
      vatDeductible = false;
      if (!reasons.some(r => r.includes("IKKE MVA-fradrag"))) {
        reasons.push("⚠️ Konto 732x (representasjon) har IKKE MVA-fradrag");
      }
    }
    
    // 7420-7429: Gaver - ikke MVA-fradrag
    if (accountCode >= 7420 && accountCode <= 7429) {
      vatDeductible = false;
      if (!reasons.some(r => r.includes("IKKE MVA-fradrag"))) {
        reasons.push("⚠️ Konto 742x (gaver) har IKKE MVA-fradrag");
      }
    }
    
    return { score, reasons, vatDeductible };
  }
  
  /**
   * Søk etter kontoer basert på beskrivelse
   */
  async function searchAccountByDescription(
    description: string, 
    accountType: "expense" | "income" | "all" = "all"
  ): Promise<AccountSearchResult[]> {
    const accounts = await getAccountsWithCache();
    
    // Del opp beskrivelsen i søkeord (fjern korte ord)
    const searchTerms = description
      .toLowerCase()
      .split(/[\s,.\-\/]+/)
      .filter(t => t.length > 2);
    
    // Legg til hele beskrivelsen som ett søkeord også
    if (description.length > 3) {
      searchTerms.push(description.toLowerCase());
    }
    
    // Filtrer på kontotype
    let filteredAccounts = accounts;
    if (accountType === "expense") {
      filteredAccounts = accounts.filter(a => {
        const code = parseInt(a.code.split(":")[0]);
        return code >= 4000 && code <= 7999;
      });
    } else if (accountType === "income") {
      filteredAccounts = accounts.filter(a => {
        const code = parseInt(a.code.split(":")[0]);
        return code >= 3000 && code <= 3999;
      });
    }
    
    // Beregn score for hver konto
    const results: AccountSearchResult[] = filteredAccounts
      .map(account => {
        const { score, reasons, vatDeductible } = calculateMatchScore(account, searchTerms);
        return { 
          code: account.code, 
          name: account.name, 
          matchScore: score, 
          reason: reasons.length > 0 ? reasons.join("; ") : "Ingen direkte match",
          vatDeductible
        };
      })
      .filter(r => r.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5); // Returner topp 5
    
    return results;
  }
  
  /**
   * Tøm cache for dette selskapet
   */
  function clearCache() {
    accountCache.delete(companySlug);
  }
  
  /**
   * Hent vanlige kontoer for en gitt type
   */
  async function getCommonAccounts(accountType: "expense" | "income"): Promise<Account[]> {
    const accounts = await getAccountsWithCache();
    
    return accounts
      .filter(a => {
        const code = parseInt(a.code.split(":")[0]);
        return accountType === "income" 
          ? (code >= 3000 && code <= 3999)
          : (code >= 6000 && code <= 7999);
      })
      .slice(0, 15);
  }
  
  return {
    getAccountsWithCache,
    searchAccountByDescription,
    getCommonAccounts,
    clearCache,
  };
}

export type AccountHelper = ReturnType<typeof createAccountHelper>;
