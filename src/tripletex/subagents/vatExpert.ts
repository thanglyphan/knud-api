/**
 * VAT Expert - MVA-regler og fradrag for Tripletex
 * 
 * Håndterer norske MVA-regler inkludert:
 * - Standard satser (25%, 15%, 12%, 0%)
 * - Fradragsregler (representasjon, velferd, etc.)
 * - Spesialtilfeller (reise, mat, gaver)
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { type TripletexClient } from "../client.js";
import { type VatType } from "../types.js";

// Cache for VAT types per selskap - 1 uke TTL
const vatTypeCache = new Map<number, { vatTypes: VatType[], timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 uke i millisekunder

// Norske MVA-satser
export const VAT_RATES = {
  HIGH: { rate: 25, description: "Standard MVA-sats (25%)" },
  MEDIUM: { rate: 15, description: "Matservering (15%)" },
  LOW: { rate: 12, description: "Transport, overnatting, kino, etc. (12%)" },
  EXEMPT: { rate: 0, description: "Fritatt MVA (0%)" },
  OUTSIDE: { rate: 0, description: "Utenfor MVA-området" },
  NONE: { rate: 0, description: "Ingen MVA-fradrag (representasjon, velferd)" },
} as const;

// MVA-fradragsregler
export const VAT_DEDUCTION_RULES = {
  FULL_DEDUCTION: [
    "Vanlige driftskostnader (kontor, programvare, telefon)",
    "Vareinnkjøp for videresalg",
    "Kontorrekvisita og utstyr",
    "Husleie for næringslokaler",
    "Faglig oppdatering og kurs",
    "Reisekostnader (innenlands)",
  ],
  NO_DEDUCTION: [
    "Representasjon (kundemiddager, kundegaver)",
    "Velferd/sosiale arrangementer (julebord, sommerfest)",
    "Personlige gaver til ansatte",
    "Mat og drikke ved representasjon",
    "Sponsing uten motytelse",
  ],
  SPECIAL_RULES: [
    "Reise: Innenlands = 12% fradrag, Utenlands = Ingen MVA",
    "Mat: Internt møte = fradrag, Representasjon = ingen fradrag",
    "Gaver: Kundegaver = ingen fradrag, Reklameartikler under 100kr = fradrag",
    "Bil: Kun fradrag for yrkesbiler, ikke personbiler",
  ],
} as const;

// Schema for AI MVA-vurdering
const VatAssessmentSchema = z.object({
  suggestedVatCode: z.string().describe("Foreslått MVA-kode fra Tripletex (f.eks. '3' for 25% utgående)"),
  vatRate: z.number().describe("MVA-sats i prosent (25, 15, 12, 0)"),
  hasDeduction: z.boolean().describe("Har denne typen kostnad MVA-fradrag?"),
  reason: z.string().describe("Kort forklaring på MVA-håndtering"),
  needsClarification: z.boolean().describe("Trenger vi mer informasjon fra bruker?"),
  clarificationQuestion: z.string().optional().describe("Spørsmål til bruker hvis clarification trengs"),
});

export type VatAssessment = z.infer<typeof VatAssessmentSchema>;

export function createVatExpert(client: TripletexClient, companyId: number) {
  
  /**
   * Hent alle MVA-typer fra Tripletex med caching
   */
  async function getVatTypesWithCache(): Promise<VatType[]> {
    const cached = vatTypeCache.get(companyId);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.vatTypes;
    }
    
    const response = await client.getVatTypes();
    const vatTypes = response.values;
    
    vatTypeCache.set(companyId, { vatTypes, timestamp: now });
    
    return vatTypes;
  }
  
  /**
   * Finn MVA-type basert på sats og type (inngående/utgående)
   */
  async function findVatType(
    rate: number,
    type: "incoming" | "outgoing"
  ): Promise<VatType | null> {
    const vatTypes = await getVatTypesWithCache();
    
    // Tripletex MVA-koder:
    // Utgående (salg): 3 = 25%, 31 = 15%, 33 = 12%, 5 = 0%
    // Inngående (kjøp): 1 = 25%, 11 = 15%, 13 = 12%, 14 = 0%
    
    // Finn basert på prosent og navn
    return vatTypes.find(v => {
      const percentage = v.percentage ?? 0;
      const name = (v.name ?? "").toLowerCase();
      
      if (percentage !== rate) return false;
      
      if (type === "incoming") {
        return name.includes("inngående") || name.includes("innkjøp") || name.includes("fradrag");
      } else {
        return name.includes("utgående") || name.includes("salg");
      }
    }) ?? null;
  }
  
  /**
   * Bruk AI til å vurdere MVA-håndtering for en transaksjon
   */
  async function assessVat(
    description: string,
    transactionType: "expense" | "income",
    accountNumber?: number
  ): Promise<VatAssessment> {
    const vatTypes = await getVatTypesWithCache();
    
    // Formater VAT-typer for AI
    const vatTypeList = vatTypes
      .map(v => `${v.number} - ${v.name} (${v.percentage}%)`)
      .join("\n");
    
    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: VatAssessmentSchema,
      prompt: `Du er en norsk MVA-ekspert. Vurder MVA-håndtering for denne transaksjonen.

BESKRIVELSE: "${description}"
TYPE: ${transactionType === "expense" ? "Utgift/kostnad" : "Inntekt"}
${accountNumber ? `KONTO: ${accountNumber}` : ""}

TILGJENGELIGE MVA-KODER I TRIPLETEX:
${vatTypeList}

=== NORSKE MVA-REGLER ===

**SATSER:**
- 25%: Standard sats (de fleste varer og tjenester)
- 15%: Matservering (restaurant, kantine)
- 12%: Transport, overnatting, kino, museer
- 0%: Fritatt eller utenfor MVA-området

**FRADRAGSREGLER - INGEN FRADRAG:**
- Representasjon: Kundemiddager, kundegaver, forretningslunsj med eksterne
- Velferd: Julebord, sommerfest, teambuilding, sosiale arrangementer
- Gaver til ansatte (utover skattefrie grenser)
- Personbil (kun yrkesbiler har fradrag)

**FRADRAGSREGLER - HAR FRADRAG:**
- Vanlige driftskostnader (kontor, programvare, utstyr)
- Reisekostnader innenlands (12%)
- Vareinnkjøp for videresalg
- Faglig oppdatering og kurs

**SPESIALTILFELLER:**
- REISE: Innenlands = 12% fradrag, Utenlands = ingen MVA (må avklares)
- MAT: Internt møte = 15% fradrag, Representasjon = ingen fradrag (må avklares)
- GAVER: Kundegaver = ingen fradrag, Reklameartikler < 100kr = fradrag

=== INSTRUKSJONER ===

1. Velg riktig MVA-kode basert på ${transactionType === "expense" ? "inngående (kjøp)" : "utgående (salg)"}
2. hasDeduction = false for representasjon og velferd
3. Hvis du er usikker på om det er representasjon/velferd eller reise/mat-type, sett needsClarification = true
4. clarificationQuestion skal være et konkret spørsmål på norsk

EKSEMPLER:
- "flyreise" → needsClarification: true, clarificationQuestion: "Var dette en innenlands eller utenlands reise?"
- "kundemiddag" → hasDeduction: false, reason: "Representasjon har ikke MVA-fradrag"
- "programvare" → hasDeduction: true, vatRate: 25
- "lunsj" → needsClarification: true, clarificationQuestion: "Var dette et internt møte eller representasjon med eksterne?"`,
    });
    
    return object;
  }
  
  /**
   * Få MVA-sats basert på kostnadskategori
   */
  function getVatRateForCategory(category: string): { rate: number; hasDeduction: boolean; note?: string } {
    const lowerCategory = category.toLowerCase();
    
    // Representasjon - ingen fradrag
    if (lowerCategory.includes("representasjon") || 
        lowerCategory.includes("kundemiddag") || 
        lowerCategory.includes("kundegave")) {
      return { rate: 0, hasDeduction: false, note: "Representasjon har ikke MVA-fradrag" };
    }
    
    // Velferd - ingen fradrag
    if (lowerCategory.includes("velferd") || 
        lowerCategory.includes("julebord") || 
        lowerCategory.includes("sommerfest") ||
        lowerCategory.includes("teambuilding")) {
      return { rate: 0, hasDeduction: false, note: "Velferdskostnader har ikke MVA-fradrag" };
    }
    
    // Reise innenlands - 12%
    if (lowerCategory.includes("reise") && !lowerCategory.includes("utenlands")) {
      return { rate: 12, hasDeduction: true, note: "Reisekostnader innenlands har 12% MVA" };
    }
    
    // Hotell/overnatting - 12%
    if (lowerCategory.includes("hotell") || lowerCategory.includes("overnatting")) {
      return { rate: 12, hasDeduction: true };
    }
    
    // Mat/servering - 15%
    if (lowerCategory.includes("mat") || lowerCategory.includes("servering") || lowerCategory.includes("restaurant")) {
      return { rate: 15, hasDeduction: true };
    }
    
    // Standard - 25%
    return { rate: 25, hasDeduction: true };
  }
  
  /**
   * Tøm cache
   */
  function clearCache() {
    vatTypeCache.delete(companyId);
  }
  
  return {
    getVatTypesWithCache,
    findVatType,
    assessVat,
    getVatRateForCategory,
    clearCache,
    VAT_RATES,
    VAT_DEDUCTION_RULES,
  };
}

export type VatExpert = ReturnType<typeof createVatExpert>;
