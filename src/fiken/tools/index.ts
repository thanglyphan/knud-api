/**
 * Fiken Tools - Main Export
 * 
 * Exports both the legacy monolithic tool set and the new multi-agent system.
 */

// Legacy monolithic tools (for backwards compatibility)
export { createFikenTools } from "./definitions.js";

// Shared modules
export * from "./shared/index.js";

// Multi-agent system
export * from "./agents/index.js";

// Account helper
export { createAccountHelper, type AccountHelper, type AccountSuggestion, type SuggestAccountsResult } from "./accountHelper.js";
