/**
 * Tripletex Subagents - AI-drevne hjelpere for regnskapsoppgaver
 * 
 * Eksporterer alle subagenter for bruk i tools og andre moduler.
 */

export { createAccountExpert, type AccountExpert, type AccountSuggestion, type SuggestAccountsResult } from "./accountExpert.js";
export { createVatExpert, type VatExpert, type VatAssessment, VAT_RATES, VAT_DEDUCTION_RULES } from "./vatExpert.js";
export { createContactMatcher, type ContactMatcher, type MatchResult, type ContactInfo } from "./contactMatcher.js";
