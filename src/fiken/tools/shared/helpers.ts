/**
 * Fiken Shared Helpers
 * 
 * Utility-funksjoner som brukes av alle agenter.
 */

import type { FikenClient } from "../../client.js";

/**
 * Standard success response type
 */
export interface SuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
  _operationComplete?: boolean;
}

/**
 * Standard error response type
 */
export interface ErrorResponse {
  success: false;
  error: string;
}

export type ToolResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Create a success response
 */
export function success<T>(data: T, message?: string, operationComplete = false): SuccessResponse<T> {
  const response: SuccessResponse<T> = { success: true, data };
  if (message) response.message = message;
  if (operationComplete) response._operationComplete = true;
  return response;
}

/**
 * Create an error response
 */
export function error(message: string): ErrorResponse {
  return { success: false, error: message };
}

/**
 * Wrap async tool execution with error handling
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorPrefix: string
): Promise<T | ErrorResponse> {
  try {
    return await fn();
  } catch (err) {
    return error(`${errorPrefix}: ${err instanceof Error ? err.message : "Ukjent feil"}`);
  }
}

/**
 * Convert kroner to øre (Fiken uses øre for all amounts)
 */
export function kronerToOere(kroner: number): number {
  return Math.round(kroner * 100);
}

/**
 * Convert øre to kroner
 */
export function oereToKroner(oere: number): number {
  return oere / 100;
}

/**
 * Format amount from øre to Norwegian kroner display string
 */
export function formatAmount(oere: number): string {
  const kroner = oereToKroner(oere);
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
  }).format(kroner);
}

/**
 * Parse date string to YYYY-MM-DD format
 */
export function parseDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Ugyldig dato: ${dateStr}`);
  }
  return date.toISOString().split('T')[0];
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get a date N days from today in YYYY-MM-DD format
 */
export function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * VAT types for SALES in Fiken
 */
export const SALES_VAT_TYPES = [
  'HIGH',      // 25%
  'MEDIUM',    // 15% (mat/drikke)
  'LOW',       // 12% (transport, kino, etc.)
  'RAW_FISH',  // 11.11%
  'NONE',      // Ingen MVA
  'EXEMPT',    // Fritatt (avgiftsfritt)
  'EXEMPT_IMPORT_EXPORT',
  'EXEMPT_REVERSE',
  'OUTSIDE',   // Utenfor avgiftsområdet
] as const;

/**
 * VAT types for PURCHASES in Fiken
 */
export const PURCHASE_VAT_TYPES = [
  'HIGH',      // 25%
  'MEDIUM',    // 15%
  'LOW',       // 12%
  'RAW_FISH',  // 11.11%
  'NONE',      // Ingen MVA
  'HIGH_DIRECT',   // Kun kjøpsmva 25%
  'HIGH_BASIS',
  'MEDIUM_DIRECT', // Kun kjøpsmva 15%
  'MEDIUM_BASIS',
  'NONE_IMPORT_BASIS',
  'HIGH_FOREIGN_SERVICE_DEDUCTIBLE',      // Tjenester fra utlandet med fradrag
  'HIGH_FOREIGN_SERVICE_NONDEDUCTIBLE',   // Tjenester fra utlandet uten fradrag
  'LOW_FOREIGN_SERVICE_DEDUCTIBLE',
  'LOW_FOREIGN_SERVICE_NONDEDUCTIBLE',
  'HIGH_PURCHASE_OF_EMISSIONSTRADING_OR_GOLD_DEDUCTIBLE',
  'HIGH_PURCHASE_OF_EMISSIONSTRADING_OR_GOLD_NONDEDUCTIBLE',
] as const;

export type SalesVatType = typeof SALES_VAT_TYPES[number];
export type PurchaseVatType = typeof PURCHASE_VAT_TYPES[number];

/**
 * Purchase kinds in Fiken
 */
export const PURCHASE_KINDS = {
  CASH_PURCHASE: 'cash_purchase',
  SUPPLIER: 'supplier',
} as const;

export type PurchaseKind = typeof PURCHASE_KINDS[keyof typeof PURCHASE_KINDS];

/**
 * Bank account types in Fiken
 */
export const BANK_ACCOUNT_TYPES = [
  'NORMAL',
  'TAX_DEDUCTION',
  'FOREIGN',
  'CREDIT_CARD',
] as const;

export type BankAccountType = typeof BANK_ACCOUNT_TYPES[number];

/**
 * Validate that a VAT type is valid for sales
 */
export function isValidSalesVatType(vatType: string): vatType is SalesVatType {
  return SALES_VAT_TYPES.includes(vatType as SalesVatType);
}

/**
 * Validate that a VAT type is valid for purchases
 */
export function isValidPurchaseVatType(vatType: string): vatType is PurchaseVatType {
  return PURCHASE_VAT_TYPES.includes(vatType as PurchaseVatType);
}

/**
 * Common account ranges in Norwegian standard chart of accounts (NS 4102)
 */
export const ACCOUNT_RANGES = {
  ASSETS: { min: 1000, max: 1999 },
  EQUITY_LIABILITY: { min: 2000, max: 2999 },
  INCOME: { min: 3000, max: 3999 },
  COST_OF_GOODS: { min: 4000, max: 4999 },
  PERSONNEL: { min: 5000, max: 5999 },
  DEPRECIATION: { min: 6000, max: 6099 },
  OTHER_OPERATING: { min: 6100, max: 7999 },
  FINANCIAL: { min: 8000, max: 8999 },
};

/**
 * Check if an account code is in a specific range
 */
export function isAccountInRange(code: number | string, range: { min: number; max: number }): boolean {
  const numCode = typeof code === 'string' ? parseInt(code.split(':')[0]) : code;
  return numCode >= range.min && numCode <= range.max;
}

/**
 * Determine account type from code
 */
export function getAccountType(code: number | string): 'asset' | 'liability' | 'income' | 'expense' | 'financial' | 'unknown' {
  const numCode = typeof code === 'string' ? parseInt(code.split(':')[0]) : code;
  
  if (numCode >= 1000 && numCode <= 1999) return 'asset';
  if (numCode >= 2000 && numCode <= 2999) return 'liability';
  if (numCode >= 3000 && numCode <= 3999) return 'income';
  if (numCode >= 4000 && numCode <= 7999) return 'expense';
  if (numCode >= 8000 && numCode <= 8999) return 'financial';
  return 'unknown';
}

/**
 * Truncate string to max length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Create a simple summary of an entity for display
 */
export function summarize(entity: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (entity[field] !== undefined) {
      result[field] = entity[field];
    }
  }
  return result;
}

/**
 * Re-export account helper for convenience
 */
export { createAccountHelper, type AccountHelper, type AccountSuggestion, type SuggestAccountsResult } from "../accountHelper.js";
