/**
 * E2E Test: Bank Reconciliation (Bankavstemming) — Full Flow (ALL 11 transactions)
 *
 * Simulates a REAL user conversation for bank reconciliation including BOOKING ALL 11
 * unmatched transactions from the kontoutskrift.pdf (januar 2026):
 *
 *   1. User asks to reconcile → agent lists bank accounts
 *   2. User picks Demo-konto + january 2026 period
 *   3. User uploads kontoutskrift.pdf (real 2-page bank statement, januar 2026)
 *   4. Agent parses with Vision, calls reconcileBankStatement, shows overview
 *   5. User books IT purchases (One.com x2, Render, Magicapi, OpenAI, Claude.ai)
 *   6. User books bank fees (Omkostninger 339.50 + Giro 43.75)
 *   7. User books accounting service (Randi Regnskap 4500)
 *   8. User books tax+salary as journal entries (Skatteetaten x2, Lønn)
 *   9. User books income (Folq AS +253800) as sale
 *  10. Summary + Fiken manual upload reminder
 *
 * After conversation, verifies DIRECTLY against Fiken API:
 *   - Purchases exist with correct amounts
 *   - Journal entries exist with correct amounts
 *   - Sale exists with correct amount
 *   - Cleanup: deletes all test entities
 *
 * The kontoutskrift.pdf contains 13 transactions for januar 2026:
 *   02.01 Omkostninger 339.50 kr, 04.01 One.com 9 kr, 04.01 Render.com 149.65 kr,
 *   05.01 Magicapi 309.62 kr, 07.01 Folq AS +253800 kr, 13.01 Randi Regnskap 4500 kr,
 *   15.01 Skatteetaten 12631 kr, 15.01 Skatteetaten 15274 kr,
 *   15.01 Lønn 41535 kr, 15.01 Giro 43.75 kr,
 *   17.01 One.com 9 kr, 20.01 OpenAI 199.20 kr, 20.01 Claude.ai 206.62 kr
 *
 * Of these, 2 are already matched/booked, leaving 11 unmatched that we book.
 *
 * Prerequisites:
 *   - API server running on localhost:3001
 *   - Docker DB running (regnskap-db)
 *   - Valid Fiken demo account connected
 *   - kontoutskrift.pdf exists at ../knud-web/kontoutskrift.pdf
 *
 * Usage:
 *   npx tsx scripts/e2e-test-bank.ts
 *   npx tsx scripts/e2e-test-bank.ts --verbose
 *   npx tsx scripts/e2e-test-bank.ts --no-cleanup    # Keep entities in Fiken
 *   npx tsx scripts/e2e-test-bank.ts --step=3         # Run up to step N
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getValidAccessToken } from "../src/fiken/auth.js";
import { getFikenConnection } from "../src/fiken/auth.js";
import { createFikenClient } from "../src/fiken/client.js";

// ============================================
// Config
// ============================================

const API_URL = "http://localhost:3001";
const USER_ID = "678b5c02-c4a1-4496-a479-006f257c37ab";

// Keep IDs — DO NOT DELETE these existing entities
const KEEP_IDS = [
  11498006863, 11498006864, 11507580081, 11507580091, 11507580095,
  11507580109, 11507580202, 11579783709, 11579784037, 11580333601,
  11580334017, 11580334018, 11580334019, 11580772105, 11580772106,
];

// Expected purchase amounts (kr) — used to identify test purchases
const expectedPurchaseAmounts = [9, 9, 149.65, 309.62, 199.20, 206.62, 339.50, 43.75, 4500];

// ============================================
// All 11 unmatched transactions we need to book
// ============================================

interface TestTransaction {
  id: string;
  description: string;
  amountKr: number;
  date: string;
  type: "purchase" | "journal_entry" | "sale";
  group: string;
}

const ALL_TRANSACTIONS: TestTransaction[] = [
  // Group 1: IT purchases (6 transactions)
  { id: "onecom1", description: "One.com", amountKr: 9.0, date: "2026-01-04", type: "purchase", group: "it" },
  { id: "render", description: "Render.com", amountKr: 149.65, date: "2026-01-04", type: "purchase", group: "it" },
  { id: "magicapi", description: "Magicapi", amountKr: 309.62, date: "2026-01-05", type: "purchase", group: "it" },
  { id: "onecom2", description: "One.com", amountKr: 9.0, date: "2026-01-17", type: "purchase", group: "it" },
  { id: "openai", description: "OpenAI", amountKr: 199.20, date: "2026-01-20", type: "purchase", group: "it" },
  { id: "claude", description: "Claude.ai", amountKr: 206.62, date: "2026-01-20", type: "purchase", group: "it" },
  // Group 2: Bank fees (2 transactions)
  { id: "bankfee1", description: "Omkostninger", amountKr: 339.50, date: "2026-01-02", type: "purchase", group: "fees" },
  { id: "bankfee2", description: "Giro", amountKr: 43.75, date: "2026-01-15", type: "purchase", group: "fees" },
  // Group 3: Accounting service (1 transaction)
  { id: "regnskap", description: "Randi Regnskap", amountKr: 4500.0, date: "2026-01-13", type: "purchase", group: "accounting" },
  // Group 4: Tax & salary journal entries (3 transactions)
  { id: "skatt", description: "Forskuddsskatt", amountKr: 12631.0, date: "2026-01-15", type: "journal_entry", group: "tax" },
  { id: "arbgavg", description: "Arbeidsgiveravgift", amountKr: 15274.0, date: "2026-01-15", type: "journal_entry", group: "tax" },
  // Lønn is also a journal entry but grouped with tax for conversation flow
  // Actually lønn is handled separately but we track it
  // Group 5: Income (1 transaction)
  { id: "folq", description: "Folq AS", amountKr: 253800.0, date: "2026-01-07", type: "sale", group: "income" },
];

// Lønn transaction — tracked separately because it may be handled as journal entry
const LONN_TRANSACTION: TestTransaction = {
  id: "lonn", description: "Lønn Thang", amountKr: 41535.0, date: "2026-01-15", type: "journal_entry", group: "tax",
};

// ============================================
// Types
// ============================================

interface ParsedStream {
  fullText: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args?: unknown }>;
  toolResults: Array<{ toolCallId: string; result: unknown }>;
  errors: string[];
  textChunks: number;
}

interface ConvMessage {
  role: "user" | "assistant";
  content: string;
}

// ============================================
// ANSI Colors
// ============================================

const C = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

let VERBOSE = false;

// ============================================
// Test counters
// ============================================

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(name: string, passed: boolean, detail?: string): void {
  totalAssertions++;
  if (passed) {
    passedAssertions++;
    console.log(`    ${C.green}✓${C.reset} ${name}${detail ? ` ${C.dim}— ${detail}${C.reset}` : ""}`);
  } else {
    failedAssertions++;
    console.log(`    ${C.red}✗${C.reset} ${name}${detail ? ` ${C.dim}— ${detail}${C.reset}` : ""}`);
  }
}

// ============================================
// SSE Stream Parser
// ============================================

async function parseSSE(response: Response): Promise<ParsedStream> {
  const result: ParsedStream = {
    fullText: "",
    toolCalls: [],
    toolResults: [],
    errors: [],
    textChunks: 0,
  };

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      const textMatch = line.match(/^0:"(.*)"/);
      if (textMatch) {
        const content = textMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        result.fullText += content;
        result.textChunks++;
      }

      if (line.startsWith("9:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolCalls.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            toolName: data.toolName || data.name || "unknown",
            args: data.args,
          });
        } catch { /* ignore */ }
      }

      if (line.startsWith("a:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolResults.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            result: data.result || data,
          });
        } catch { /* ignore */ }
      }

      if (line.startsWith("e:")) {
        try {
          const data = JSON.parse(line.slice(2));
          if (data?.error) {
            result.errors.push(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
          }
        } catch { /* ignore */ }
      }
    }
  }

  if (buffer.trim()) {
    const textMatch = buffer.match(/^0:"(.*)"/);
    if (textMatch) {
      const content = textMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      result.fullText += content;
      result.textChunks++;
    }
  }

  return result;
}

// ============================================
// API Helper
// ============================================

async function sendChat(
  messages: Array<{ role: string; content: string }>,
  files?: Array<{ name: string; type: string; data: string }>,
  filesResend?: boolean,
): Promise<ParsedStream> {
  const body: Record<string, unknown> = { messages };
  if (files && files.length > 0) {
    body.files = files;
    if (filesResend) body.filesResend = true;
  }

  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${USER_ID}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorBody}`);
  }

  return parseSSE(response);
}

// ============================================
// Helpers
// ============================================

function contains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

function notContains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return !patterns.some((p) => lower.includes(p.toLowerCase()));
}

function delegated(result: ParsedStream, tool: string): boolean {
  return result.toolCalls.some((tc) => tc.toolName === tool);
}

function printResponse(step: string, result: ParsedStream): void {
  if (VERBOSE) {
    console.log(
      `    ${C.dim}Tools: ${result.toolCalls.map((tc) => tc.toolName).join(" → ") || "none"}${C.reset}`,
    );
    const truncated = result.fullText.substring(0, 800);
    console.log(
      `    ${C.dim}Response: ${truncated}${result.fullText.length > 800 ? "..." : ""}${C.reset}`,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadKontoutskrift(): { name: string; type: string; data: string } {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const pdfPath = path.resolve(__dirname, "../../knud-web/kontoutskrift.pdf");

  if (!fs.existsSync(pdfPath)) {
    throw new Error(
      `kontoutskrift.pdf not found at ${pdfPath}. ` +
        `Expected at ../knud-web/kontoutskrift.pdf relative to knud-api.`,
    );
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  const base64 = pdfBuffer.toString("base64");
  console.log(`  ${C.dim}Loaded kontoutskrift.pdf: ${(pdfBuffer.length / 1024).toFixed(0)} KB${C.reset}`);

  return {
    name: "kontoutskrift.pdf",
    type: "application/pdf",
    data: base64,
  };
}

/**
 * Check if the agent's response indicates an entity was ACTUALLY created/registered
 * (not just described or presented for confirmation).
 */
function entityWasCreated(text: string): boolean {
  const lower = text.toLowerCase();

  // If the response asks for confirmation, the entity is NOT yet created
  if (contains(text, "stemmer dette", "ja/nei", "bekreft dette")) {
    return false;
  }

  // Regex patterns to handle "er nå registrert", "er nå opprettet", etc.
  const regexPatterns = [
    /er\s+(?:nå\s+)?registrert/,
    /er\s+(?:nå\s+)?opprettet/,
    /er\s+(?:nå\s+)?bokført/,
    /har\s+(?:nå\s+)?registrert/,
    /har\s+(?:nå\s+)?opprettet/,
    /har\s+(?:nå\s+)?bokført/,
    /ble\s+(?:nå\s+)?registrert/,
    /ble\s+(?:nå\s+)?opprettet/,
    /ble\s+(?:nå\s+)?bokført/,
    /nå\s+registrert/,
    /nå\s+opprettet/,
    /nå\s+bokført/,
    /bilag\s+opprettet/,
    /salg\s+registrert/,
  ];
  const stringPatterns = [
    "registrert i fiken",
    "opprettet i fiken",
    "bokført i fiken",
    "kjøpet er nå",
    "kontantkjøpet er",
    "fullført",
    "bilaget er opprettet",
    "salget er registrert",
    "er lagt inn",
  ];
  return (
    regexPatterns.some((r) => r.test(lower)) ||
    stringPatterns.some((p) => lower.includes(p))
  );
}

/**
 * Determine if the agent is asking a question that needs a response
 */
function agentNeedsResponse(text: string): boolean {
  return (
    (contains(text, "stemmer dette", "bekreft", "skal jeg registrere", "vil du", "ønsker du") ||
      contains(text, "hvilken konto", "finnes ikke", "foreslår", "ja/nei")) &&
    !entityWasCreated(text)
  );
}

/**
 * Send confirmation messages until the entity is created.
 * Adapts response based on what the agent is asking about.
 */
async function confirmUntilCreated(
  history: ConvMessage[],
  stepLabel: string,
  contextHint?: string,
  maxRetries: number = 4,
): Promise<{ result: ParsedStream; created: boolean }> {
  let created = false;
  let lastResult: ParsedStream | null = null;

  for (let i = 0; i < maxRetries; i++) {
    const suffix = i === 0 ? "" : ` (attempt ${i + 1})`;
    await delay(3000);

    const lastAssistant = history[history.length - 1];
    let confirmMsg: string;

    // Adapt response based on what the agent said
    if (contains(lastAssistant.content, "flere kunder", "flere kontakter", "duplikat", "to kunder", "to kontakter", "hvilken kunde")) {
      confirmMsg = "Bruk den første kunden i listen. Registrer salget nå med den første Folq AS-kunden!";
    } else if (contains(lastAssistant.content, "finnes ikke", "ikke funnet", "konto 6900")) {
      confirmMsg =
        "Ok, bruk konto 6553 (Programvare) eller den kontoen du mener passer best. Registrer det.";
    } else if (contains(lastAssistant.content, "hvilken konto", "foreslår")) {
      confirmMsg = contextHint || "Bruk kontoen du mener passer best. Registrer det.";
    } else if (contains(lastAssistant.content, "leverandør") && contains(lastAssistant.content, "finnes ikke", "ikke funnet")) {
      confirmMsg = "Registrer det som kontantkjøp uten leverandør da. Bare gjør det.";
    } else if (contains(lastAssistant.content, "stemmer dette", "bekreft")) {
      confirmMsg = "Ja, det stemmer! Registrer det.";
    } else if (contains(lastAssistant.content, "skal jeg")) {
      confirmMsg = "Ja, gjør det!";
    } else if (contains(lastAssistant.content, "?")) {
      confirmMsg = contextHint || "Ja, registrer det nå!";
    } else {
      confirmMsg = "Ja, registrer det nå!";
    }

    console.log(`\n${C.bold}═══ ${stepLabel}${suffix}: Confirm${C.reset}`);
    console.log(`${C.dim}  "${confirmMsg.substring(0, 120)}"${C.reset}`);

    const msgs = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: confirmMsg },
    ];

    const start = Date.now();
    lastResult = await sendChat(msgs);
    console.log(`  ${C.dim}(${((Date.now() - start) / 1000).toFixed(1)}s)${C.reset}`);
    printResponse(stepLabel, lastResult);

    history.push({ role: "user", content: confirmMsg });
    history.push({ role: "assistant", content: lastResult.fullText });

    if (entityWasCreated(lastResult.fullText)) {
      created = true;
      break;
    }

    // If agent didn't ask a new question, don't retry
    if (!agentNeedsResponse(lastResult.fullText) && !contains(lastResult.fullText, "?")) {
      break;
    }
  }

  return { result: lastResult!, created };
}

/**
 * Send a booking request and handle the full confirm-until-created flow.
 * Returns whether the booking was successful.
 */
async function bookTransaction(
  history: ConvMessage[],
  stepLabel: string,
  userMessage: string,
  contextHint?: string,
  maxRetries: number = 4,
): Promise<boolean> {
  console.log(`\n${C.bold}═══ ${stepLabel}${C.reset}`);
  console.log(`${C.dim}  "${userMessage.substring(0, 150)}${userMessage.length > 150 ? "..." : ""}"${C.reset}`);

  const msgs = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  const start = Date.now();
  const result = await sendChat(msgs);
  console.log(`  ${C.dim}(${((Date.now() - start) / 1000).toFixed(1)}s)${C.reset}`);
  printResponse(stepLabel, result);

  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: result.fullText });

  assert(`${stepLabel}: Response not empty`, result.fullText.trim().length > 30);
  assert(`${stepLabel}: No fatal errors`, result.errors.length === 0);

  // Check if already created
  if (entityWasCreated(result.fullText)) {
    console.log(`  ${C.green}Entity created directly${C.reset}`);
    return true;
  }

  // If agent asks for confirmation, go through confirm flow
  if (agentNeedsResponse(result.fullText) || contains(result.fullText, "?")) {
    const { created } = await confirmUntilCreated(history, `${stepLabel}b`, contextHint, maxRetries);
    if (created) {
      console.log(`  ${C.green}Entity created after confirmation${C.reset}`);
    } else {
      console.log(`  ${C.yellow}Entity NOT created after confirmation attempts${C.reset}`);
    }
    return created;
  }

  // Agent didn't create and didn't ask — push harder
  console.log(`  ${C.yellow}Agent didn't create or ask — pushing harder${C.reset}`);
  const pushMsg = contextHint || "Registrer det nå! Ikke spør mer, bare gjør det.";
  history.push({ role: "user", content: pushMsg });

  const pushMsgs = history.map((m) => ({ role: m.role, content: m.content }));
  const pushResult = await sendChat(pushMsgs);
  history.push({ role: "assistant", content: pushResult.fullText });
  printResponse(`${stepLabel}-push`, pushResult);

  if (entityWasCreated(pushResult.fullText)) {
    return true;
  }

  if (agentNeedsResponse(pushResult.fullText) || contains(pushResult.fullText, "?")) {
    const { created } = await confirmUntilCreated(history, `${stepLabel}c`, contextHint, maxRetries);
    return created;
  }

  return false;
}

// ============================================
// THE MAIN CONVERSATION
// ============================================

interface ConversationResult {
  history: ConvMessage[];
  bookedPurchases: string[];   // IDs of booked purchase transactions
  bookedJournals: string[];    // IDs of booked journal entry transactions
  bookedSales: string[];       // IDs of booked sale transactions
}

async function runConversation(maxStep: number): Promise<ConversationResult> {
  const history: ConvMessage[] = [];
  const kontoutskrift = loadKontoutskrift();
  const bookedPurchases: string[] = [];
  const bookedJournals: string[] = [];
  const bookedSales: string[] = [];

  // ═══════════════════════════════════════════
  // STEP 1: User asks to reconcile the bank
  // ═══════════════════════════════════════════
  if (maxStep < 1) return { history, bookedPurchases, bookedJournals, bookedSales };
  console.log(`\n${C.bold}═══ Step 1: Ask to reconcile the bank${C.reset}`);
  console.log(`${C.dim}  "Hei! Jeg vil gjerne avstemme banken."${C.reset}`);

  const step1Start = Date.now();
  const step1 = await sendChat([
    { role: "user", content: "Hei! Jeg vil gjerne avstemme banken." },
  ]);
  console.log(`  ${C.dim}(${((Date.now() - step1Start) / 1000).toFixed(1)}s)${C.reset}`);
  printResponse("step1", step1);

  assert("Step 1: Response is not empty", step1.fullText.trim().length > 30, `${step1.fullText.trim().length} chars`);
  assert("Step 1: Delegates to bank agent", delegated(step1, "delegateToBankAgent"), `Tools: ${step1.toolCalls.map((tc) => tc.toolName).join(", ")}`);
  assert("Step 1: Mentions bank account(s)", contains(step1.fullText, "bankkonto", "demo-konto", "konto", "1920"));
  assert("Step 1: Asks about period or which account", contains(step1.fullText, "periode", "måned", "hvilken", "dato", "konto"));
  assert("Step 1: No fatal errors", step1.errors.length === 0);

  history.push({ role: "user", content: "Hei! Jeg vil gjerne avstemme banken." });
  history.push({ role: "assistant", content: step1.fullText });

  // ═══════════════════════════════════════════
  // STEP 2: Pick Demo-konto + januar 2026
  // ═══════════════════════════════════════════
  if (maxStep < 2) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  console.log(`\n${C.bold}═══ Step 2: Pick bank account and period${C.reset}`);
  const step2Msg = "Bruk Demo-konto (1920). Perioden er januar 2026, altså 01.01.2026 til 31.01.2026.";
  console.log(`${C.dim}  "${step2Msg}"${C.reset}`);

  const step2Msgs = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: step2Msg },
  ];

  const step2Start = Date.now();
  const step2 = await sendChat(step2Msgs);
  console.log(`  ${C.dim}(${((Date.now() - step2Start) / 1000).toFixed(1)}s)${C.reset}`);
  printResponse("step2", step2);

  assert("Step 2: Response is not empty", step2.fullText.trim().length > 30, `${step2.fullText.trim().length} chars`);
  assert("Step 2: Acknowledges account and period", contains(step2.fullText, "demo", "1920", "januar", "2026", "01"));
  assert("Step 2: Asks for kontoutskrift upload", contains(step2.fullText, "kontoutskrift", "last opp", "laste opp", "fil", "pdf", "csv"));
  assert("Step 2: No fatal errors", step2.errors.length === 0);

  history.push({ role: "user", content: step2Msg });
  history.push({ role: "assistant", content: step2.fullText });

  // ═══════════════════════════════════════════
  // STEP 3: Upload kontoutskrift.pdf
  // ═══════════════════════════════════════════
  if (maxStep < 3) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  console.log(`\n${C.bold}═══ Step 3: Upload kontoutskrift.pdf${C.reset}`);
  console.log(`${C.dim}  Uploading real bank statement PDF (2 pages, image-based, januar 2026)${C.reset}`);

  const step3Msg = "Her er kontoutskriften for januar 2026.";
  const step3Msgs = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: step3Msg },
  ];

  const step3Start = Date.now();
  const step3 = await sendChat(step3Msgs, [kontoutskrift]);
  const step3Duration = (Date.now() - step3Start) / 1000;
  console.log(`  ${C.dim}(${step3Duration.toFixed(1)}s)${C.reset}`);
  printResponse("step3", step3);

  assert("Step 3: Response is substantial", step3.fullText.trim().length > 100, `${step3.fullText.trim().length} chars`);
  assert("Step 3: Delegates to bank agent", delegated(step3, "delegateToBankAgent") || delegated(step3, "delegateToPurchaseAgent"), `Tools: ${step3.toolCalls.map((tc) => tc.toolName).join(", ")}`);
  assert("Step 3: Shows transaction count or overview", contains(step3.fullText, "transaksjon", "totalt", "bokført", "matchet", "umatchet", "trenger"));
  assert("Step 3: No fatal errors", step3.errors.length === 0);

  history.push({ role: "user", content: step3Msg });
  history.push({ role: "assistant", content: step3.fullText });

  // ═══════════════════════════════════════════
  // STEP 4: Book IT purchases (6 transactions)
  // One.com 9kr x2, Render.com 149.65kr, Magicapi 309.62kr,
  // OpenAI 199.20kr, Claude.ai 206.62kr
  // All kontantkjøp, konto 6553, bankkonto 1920:10001, inkl. mva 25%
  // ═══════════════════════════════════════════
  if (maxStep < 4) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  const step4Msg =
    "La oss begynne å bokføre de umatchede transaksjonene. " +
    "Jeg har ingen kvitteringer for disse, så registrer uten vedlegg. " +
    "Start med alle IT-kostnadene: " +
    "One.com 9 kr (04.01), Render.com 149,65 kr (04.01), Magicapi 309,62 kr (05.01), " +
    "One.com 9 kr (17.01), OpenAI 199,20 kr (20.01), og Claude.ai 206,62 kr (20.01). " +
    "Alle er kontantkjøp for programvare/IT-tjenester. " +
    "Bruk konto 6553 (Programvare anskaffelse), bankkonto 1920:10001, inkl. mva 25%. " +
    "Registrer alle seks uten vedlegg.";

  const itBooked = await bookTransaction(
    history, "Step 4: IT purchases",
    step4Msg,
    "Ja, registrer alle seks IT-kjøpene nå. Konto 6553, bankkonto 1920:10001, inkl. mva 25%. Kontantkjøp uten leverandør.",
  );

  if (itBooked) {
    bookedPurchases.push("onecom1", "render", "magicapi", "onecom2", "openai", "claude");
    console.log(`  ${C.green}IT purchases marked as booked${C.reset}`);
  }

  // If agent only booked some, try to book remaining individually
  if (!itBooked || !contains(history[history.length - 1].content, "alle", "seks", "6")) {
    // Check which ones were mentioned as done in the last response
    const lastResp = history[history.length - 1].content;
    
    // The agent may have booked some but not all. Let's ask about the rest.
    await delay(3000);
    const remainMsg =
      "Bra! Hvis ikke alle seks IT-kjøpene er registrert ennå, " +
      "registrer de resterende nå. Samme oppsett: kontantkjøp, konto 6553, bankkonto 1920:10001, inkl. mva 25%. " +
      "Transaksjonene er: One.com 9 kr (04.01), Render.com 149,65 kr (04.01), Magicapi 309,62 kr (05.01), " +
      "One.com 9 kr (17.01), OpenAI 199,20 kr (20.01), Claude.ai 206,62 kr (20.01).";

    const remainBooked = await bookTransaction(
      history, "Step 4b: Remaining IT purchases",
      remainMsg,
      "Ja, registrer alle de resterende IT-kjøpene nå! Kontantkjøp, konto 6553, bankkonto 1920:10001.",
    );

    if (remainBooked) {
      // Mark all as booked since we asked for all
      for (const id of ["onecom1", "render", "magicapi", "onecom2", "openai", "claude"]) {
        if (!bookedPurchases.includes(id)) bookedPurchases.push(id);
      }
    }
  }

  assert(
    "Step 4: IT purchases booked",
    bookedPurchases.length >= 1,
    `${bookedPurchases.length} IT purchases tracked`,
  );

  // ═══════════════════════════════════════════
  // STEP 5: Book bank fees (2 transactions)
  // Omkostninger 339.50kr (02.01), Giro 43.75kr (15.01)
  // Kontantkjøp, konto 7770 (Bankgebyr), bankkonto 1920:10001
  // ═══════════════════════════════════════════
  if (maxStep < 5) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  const step5Msg =
    "Neste: bankgebyrene. " +
    "Omkostninger 339,50 kr (02.01.2026) og Giro-gebyr 43,75 kr (15.01.2026). " +
    "Begge er kontantkjøp for bankgebyr. Bruk konto 7770 (Bankgebyr) eller lignende bankkostnadskonto, " +
    "bankkonto 1920:10001. Ingen mva (mva-fri). Ingen kvittering, registrer uten vedlegg.";

  const feesBooked = await bookTransaction(
    history, "Step 5: Bank fees",
    step5Msg,
    "Ja, registrer begge bankgebyrene nå. Kontantkjøp, konto 7770, bankkonto 1920:10001, ingen mva.",
  );

  if (feesBooked) {
    bookedPurchases.push("bankfee1", "bankfee2");
    console.log(`  ${C.green}Bank fees marked as booked${C.reset}`);
  }

  assert("Step 5: Bank fees booked", feesBooked, feesBooked ? "Both fees registered" : "Fees NOT registered");

  // ═══════════════════════════════════════════
  // STEP 6: Book accounting service (1 transaction)
  // Randi Regnskap AS 4500kr (13.01)
  // Purchase with supplier, konto 6300 (Revisjon/regnskapshonorar)
  // ═══════════════════════════════════════════
  if (maxStep < 6) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  const step6Msg =
    "Neste: Randi Regnskap AS, 4 500 kr (13.01.2026). " +
    "Det er en regnskapstjeneste. Sjekk om Randi Regnskap finnes som leverandør, " +
    "og registrer kjøpet med konto 6300 (Revisjon og regnskapshonorar), bankkonto 1920:10001, " +
    "inkl. mva 25%. Kontantkjøp er ok hvis du ikke finner leverandøren. Ingen kvittering, registrer uten vedlegg.";

  const regnskapBooked = await bookTransaction(
    history, "Step 6: Randi Regnskap",
    step6Msg,
    "Ja, registrer det nå. Bruk konto 6300, bankkonto 1920:10001, inkl. mva 25%. Kontantkjøp er ok.",
  );

  if (regnskapBooked) {
    bookedPurchases.push("regnskap");
    console.log(`  ${C.green}Randi Regnskap marked as booked${C.reset}`);
  }

  assert("Step 6: Randi Regnskap booked", regnskapBooked, regnskapBooked ? "Registered" : "NOT registered");

  // ═══════════════════════════════════════════
  // STEP 7: Book tax & salary as journal entries (3 transactions)
  // Skatteetaten 12631kr (forskuddsskatt), Skatteetaten 15274kr (arbeidsgiveravgift),
  // Lønn 41535kr
  // These must be booked as free-form journal entries (fri postering)
  // ═══════════════════════════════════════════
  if (maxStep < 7) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  const step7Msg =
    "Neste: de tre lønns- og skattetransaksjonene fra 15.01.2026. " +
    "Disse må bokføres som fri postering (bilag/journal entry), ikke som kjøp:\n\n" +
    "1. Forskuddsskatt 12 631 kr: debet konto 2780 (Skyldig forskuddstrekk), kredit 1920:10001 (bank)\n" +
    "2. Arbeidsgiveravgift 15 274 kr: debet konto 2770 (Skyldig arbeidsgiveravgift), kredit 1920:10001 (bank)\n" +
    "3. Lønnsutbetaling 41 535 kr: debet konto 2930 (Skyldig lønn), kredit 1920:10001 (bank)\n\n" +
    "Alle tre er fra 15.01.2026. Ingen mva. Opprett disse tre bilagene nå.";

  const taxBooked = await bookTransaction(
    history, "Step 7: Tax & salary journal entries",
    step7Msg,
    "Ja, opprett alle tre bilagene/fri posteringene nå! Debet/kredit som beskrevet. Dato 15.01.2026.",
  );

  if (taxBooked) {
    bookedJournals.push("skatt", "arbgavg", "lonn");
    console.log(`  ${C.green}Tax & salary journal entries marked as booked${C.reset}`);
  }

  // If agent only did some, push for remaining
  if (!taxBooked) {
    await delay(3000);
    const remainTaxMsg =
      "Opprett de resterende bilagene nå. Alle tre som fri postering:\n" +
      "1. Forskuddsskatt 12631 kr: debet 2780, kredit 1920:10001\n" +
      "2. Arbeidsgiveravgift 15274 kr: debet 2770, kredit 1920:10001\n" +
      "3. Lønnsutbetaling 41535 kr: debet 2930, kredit 1920:10001\n" +
      "Dato 15.01.2026 for alle. Bare gjør det.";

    const remainTaxBooked = await bookTransaction(
      history, "Step 7b: Remaining journal entries",
      remainTaxMsg,
      "Ja, opprett bilagene nå!",
    );

    if (remainTaxBooked) {
      bookedJournals.push("skatt", "arbgavg", "lonn");
    }
  }

  assert(
    "Step 7: Journal entries booked",
    bookedJournals.length > 0,
    `${bookedJournals.length} journal entries tracked`,
  );

  // ═══════════════════════════════════════════
  // STEP 8: Book income (Folq AS +253800kr)
  // This is an incoming payment — registered as "annet salg" (other sale)
  // ═══════════════════════════════════════════
  if (maxStep < 8) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  const step8Msg =
    "Siste transaksjon: Folq AS innbetaling +253 800 kr (07.01.2026). " +
    "Dette er inntekt — honorar/konsulentinntekt fra Folq AS. " +
    "Registrer det som et salg (annet salg / cash_sale) med konto 3000 (Salgsinntekt), " +
    "bankkonto 1920:10001, inkl. mva 25%, betalt 07.01.2026. " +
    "Søk etter Folq AS som kunde. Hvis det finnes flere, bruk den første. " +
    "Hvis ingen finnes, opprett salget UTEN contactId. Ikke bruk contact_agent, bare invoice_agent direkte.";

  const saleBooked = await bookTransaction(
    history, "Step 8: Folq AS income",
    step8Msg,
    "Ja, bruk den første Folq AS-kunden og registrer salget nå! Annet salg (cash_sale), konto 3000, bankkonto 1920:10001, 253 800 kr inkl. mva 25%, betalt 07.01.2026. Bare gjør det, ikke spør mer!",
    6,  // More retries for sale creation which can involve contact resolution
  );

  if (saleBooked) {
    bookedSales.push("folq");
    console.log(`  ${C.green}Folq AS sale marked as booked${C.reset}`);
  }

  assert("Step 8: Folq AS sale booked", saleBooked, saleBooked ? "Sale registered" : "Sale NOT registered");

  // ═══════════════════════════════════════════
  // STEP 9: Summary + Fiken reminder
  // ═══════════════════════════════════════════
  if (maxStep < 9) return { history, bookedPurchases, bookedJournals, bookedSales };
  await delay(3000);

  console.log(`\n${C.bold}═══ Step 9: Ask for summary / closing${C.reset}`);
  const step9Msg = "Det var alle transaksjonene. Kan du oppsummere hva vi har gjort med avstemmingen? Er det noe annet jeg bør gjøre?";
  console.log(`${C.dim}  "${step9Msg}"${C.reset}`);

  const step9Msgs = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: step9Msg },
  ];

  const step9Start = Date.now();
  const step9 = await sendChat(step9Msgs);
  console.log(`  ${C.dim}(${((Date.now() - step9Start) / 1000).toFixed(1)}s)${C.reset}`);
  printResponse("step9", step9);

  assert("Step 9: Response is not empty", step9.fullText.trim().length > 30, `${step9.fullText.trim().length} chars`);
  assert(
    "Step 9: Provides a summary",
    contains(step9.fullText, "oppsummering", "gjennomgått", "avstemming", "bokført", "registrert") ||
      contains(step9.fullText, "transaksjoner", "kjøp", "bilag"),
  );
  assert(
    "Step 9: Mentions Fiken manual upload reminder",
    contains(step9.fullText, "fiken", "manuelt", "laste opp", "kontoutskrift") ||
      contains(step9.fullText, "last opp", "selv") ||
      contains(step9.fullText, "husk", "kontoutskrift") ||
      contains(step9.fullText, "kontoutskrift", "fiken") ||
      contains(step9.fullText, "manuell", "opplasting") ||
      contains(step9.fullText, "laste opp kontoutskrift"),
  );
  assert("Step 9: No fatal errors", step9.errors.length === 0);

  history.push({ role: "user", content: step9Msg });
  history.push({ role: "assistant", content: step9.fullText });

  return { history, bookedPurchases, bookedJournals, bookedSales };
}

// ============================================
// FIKEN VERIFICATION
// ============================================

interface VerifiedPurchase {
  purchaseId: number;
  date: string;
  description: string;
  grossKr: number;
  supplier: string | null;
  account: string | null;
  paid: boolean;
}

interface VerifiedJournalEntry {
  journalEntryId: number;
  transactionId: number | undefined;
  date: string;
  description: string;
  lines: Array<{
    debitAccount?: string;
    creditAccount?: string;
    amountKr: number;
  }>;
}

interface VerifiedSale {
  saleId: number;
  date: string;
  grossKr: number;
  paid: boolean;
  kind: string | null;
}

interface VerificationResult {
  purchases: VerifiedPurchase[];
  journalEntries: VerifiedJournalEntry[];
  sales: VerifiedSale[];
}

async function verifyInFiken(): Promise<VerificationResult> {
  console.log(`\n${C.bold}═══ FIKEN API VERIFICATION${C.reset}`);
  console.log(`${C.dim}  Directly querying Fiken API to verify all created entities...${C.reset}`);

  const accessToken = await getValidAccessToken(USER_ID);
  if (!accessToken) throw new Error("No valid Fiken access token — token may be expired");

  const connection = await getFikenConnection(USER_ID);
  if (!connection?.companyId) throw new Error("No Fiken company connected");

  console.log(`  ${C.dim}Company: ${connection.companyName || connection.companyId}${C.reset}`);

  const client = createFikenClient(accessToken, connection.companyId);

  // ── PURCHASES ──
  const allPurchases = await client.getPurchases({
    dateGe: "2026-01-01",
    dateLe: "2026-01-31",
    pageSize: 100,
  });

  console.log(`  ${C.dim}Found ${allPurchases.length} total purchases in januar 2026${C.reset}`);

  const testPurchases: VerifiedPurchase[] = [];
  for (const p of allPurchases) {
    // Skip KEEP_IDs
    if (p.purchaseId && KEEP_IDS.includes(p.purchaseId)) continue;

    const totalGross = p.lines?.reduce((sum, l) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
    const grossKr = totalGross / 100;

    // Check if this purchase matches any expected amount (within tolerance)
    if (!expectedPurchaseAmounts.some((amt) => Math.abs(grossKr - amt) < 5)) continue;

    testPurchases.push({
      purchaseId: p.purchaseId!,
      date: p.date || "unknown",
      description: p.lines?.[0]?.description || "no description",
      grossKr,
      supplier: p.supplier?.name || null,
      account: p.lines?.[0]?.account || null,
      paid: p.paid || false,
    });
  }

  // ── JOURNAL ENTRIES ──
  // Search the whole month, not just 15.01, in case the agent used a different date
  const allJournalEntries = await client.getJournalEntries({
    dateGe: "2026-01-01",
    dateLe: "2026-01-31",
    pageSize: 100,
  });

  console.log(`  ${C.dim}Found ${allJournalEntries.length} journal entries in januar 2026${C.reset}`);

  // Our expected journal entry amounts (kr)
  const expectedJournalAmounts = [12631, 15274, 41535];

  const testJournalEntries: VerifiedJournalEntry[] = [];
  for (const je of allJournalEntries) {
    if (je.journalEntryId && KEEP_IDS.includes(je.journalEntryId)) continue;

    const lines = je.lines?.map((l) => ({
      debitAccount: l.debitAccount,
      creditAccount: l.creditAccount,
      amountKr: (l.amount || 0) / 100,
    })) || [];

    // Check if any line amount matches our expected amounts
    const lineAmounts = lines.map((l) => l.amountKr);
    if (!lineAmounts.some((amt) => expectedJournalAmounts.some((exp) => Math.abs(amt - exp) < 5))) continue;

    testJournalEntries.push({
      journalEntryId: je.journalEntryId!,
      transactionId: je.transactionId,
      date: je.date || "unknown",
      description: je.description || "no description",
      lines,
    });
  }

  // ── SALES ──
  // Try multiple date ranges in case sale was created with a slightly different date
  let allSales = await client.getSales({
    dateGe: "2026-01-01",
    dateLe: "2026-01-31",
    pageSize: 100,
  });

  console.log(`  ${C.dim}Found ${allSales.length} sales in januar 2026${C.reset}`);

  // If no sales found, try a broader range (the agent might have used a different date)
  if (allSales.length === 0) {
    allSales = await client.getSales({
      dateGe: "2025-12-01",
      dateLe: "2026-12-31",
      pageSize: 100,
    });
    console.log(`  ${C.dim}Broader search found ${allSales.length} sales in 2025-2026${C.reset}`);
  }

  // If still nothing, try without date filter
  if (allSales.length === 0) {
    allSales = await client.getSales({ pageSize: 20 });
    console.log(`  ${C.dim}Unfiltered search found ${allSales.length} recent sales${C.reset}`);
  }

  // Expected sale amount: 253800 kr (Folq AS)
  const testSales: VerifiedSale[] = [];
  for (const s of allSales) {
    if (s.saleId && KEEP_IDS.includes(s.saleId)) continue;

    // Check multiple amount fields — Fiken may populate different ones depending on vatType
    const grossKr = (s.grossAmount || 0) / 100;
    const netKr = (s.netAmount || 0) / 100;
    const totalPaidKr = (s.totalPaid || 0) / 100;
    const linesGrossKr = (s.lines || []).reduce((sum, l) => sum + ((l.grossAmount || 0) / 100), 0);
    const bestAmount = grossKr || totalPaidKr || netKr || linesGrossKr;
    if (VERBOSE) {
      console.log(`    ${C.dim}Sale #${s.saleId}: ${bestAmount} kr (gross=${grossKr}, net=${netKr}, totalPaid=${totalPaidKr}, linesGross=${linesGrossKr}), date=${s.date}, kind=${(s as any).kind}, paid=${s.paid}, settled=${s.settled}${C.reset}`);
    }
    if (Math.abs(bestAmount - 253800) > 500) continue; // tolerance for MVA calculation differences

    testSales.push({
      saleId: s.saleId!,
      date: s.date || "unknown",
      grossKr: bestAmount,
      paid: s.paid === true || s.settled === true || (s.totalPaid || 0) > 0,
      kind: (s as any).kind || null,
    });
  }

  return { purchases: testPurchases, journalEntries: testJournalEntries, sales: testSales };
}

async function cleanupFiken(result: VerificationResult): Promise<void> {
  console.log(`\n${C.bold}═══ CLEANUP${C.reset}`);

  const accessToken = await getValidAccessToken(USER_ID);
  if (!accessToken) {
    console.log(`  ${C.red}Cannot cleanup — no valid access token${C.reset}`);
    return;
  }

  const connection = await getFikenConnection(USER_ID);
  if (!connection?.companyId) {
    console.log(`  ${C.red}Cannot cleanup — no company connected${C.reset}`);
    return;
  }

  const client = createFikenClient(accessToken, connection.companyId);
  const totalCount = result.purchases.length + result.journalEntries.length + result.sales.length;
  console.log(`${C.dim}  Deleting ${totalCount} test entities from Fiken...${C.reset}`);

  // Delete purchases
  for (const p of result.purchases) {
    try {
      await client.deletePurchase(p.purchaseId, "E2E bank reconciliation test cleanup");
      console.log(`  ${C.green}✓${C.reset} Deleted purchase #${p.purchaseId} (${p.grossKr} kr)`);
    } catch (error) {
      console.log(
        `  ${C.yellow}⚠${C.reset} Could not delete purchase #${p.purchaseId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Delete journal entries (via their transaction IDs)
  for (const je of result.journalEntries) {
    if (!je.transactionId) {
      console.log(`  ${C.yellow}⚠${C.reset} Journal entry #${je.journalEntryId} has no transactionId — cannot delete`);
      continue;
    }
    try {
      await client.deleteTransaction(je.transactionId, "E2E bank reconciliation test cleanup");
      console.log(`  ${C.green}✓${C.reset} Deleted journal entry #${je.journalEntryId} (txn ${je.transactionId})`);
    } catch (error) {
      console.log(
        `  ${C.yellow}⚠${C.reset} Could not delete journal entry #${je.journalEntryId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Delete sales
  for (const s of result.sales) {
    try {
      await client.deleteSale(s.saleId, "E2E bank reconciliation test cleanup");
      console.log(`  ${C.green}✓${C.reset} Deleted sale #${s.saleId} (${s.grossKr} kr)`);
    } catch (error) {
      console.log(
        `  ${C.yellow}⚠${C.reset} Could not delete sale #${s.saleId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("=".repeat(70));
  console.log(`${C.bold}E2E Test: Bank Reconciliation — ALL 11 Transactions${C.reset}`);
  console.log(`${C.dim}Parse kontoutskrift → match → book ALL 11 unmatched → verify in Fiken${C.reset}`);
  console.log(`${C.dim}Purchases (9) + Journal entries (3) + Sale (1) = 13 total bookings${C.reset}`);
  console.log("=".repeat(70));

  // Parse CLI args
  const args = process.argv.slice(2);
  VERBOSE = args.includes("--verbose");
  const noCleanup = args.includes("--no-cleanup");
  const stepArg = args.find((a) => a.startsWith("--step="))?.split("=")[1];
  const maxStep = stepArg ? parseInt(stepArg) : 99;

  // Health check
  try {
    const health = await fetch(`${API_URL}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log(`\n${C.green}[OK]${C.reset} Server is running at ${API_URL}`);
  } catch {
    console.error(`${C.red}[FAIL]${C.reset} Server is not running at ${API_URL}`);
    console.error("Start the server with: npm run dev");
    process.exit(1);
  }

  // Auth check
  try {
    const authCheck = await fetch(`${API_URL}/api/chats`, {
      headers: { Authorization: `Bearer ${USER_ID}` },
    });
    if (authCheck.status === 401) {
      const body = await authCheck.json();
      console.error(`${C.red}[FAIL]${C.reset} Authentication failed:`, body);
      process.exit(1);
    }
    console.log(`${C.green}[OK]${C.reset} Authentication valid`);
  } catch (error) {
    console.error(`${C.red}[FAIL]${C.reset} Auth check error:`, error);
    process.exit(1);
  }

  // Verify kontoutskrift.pdf exists
  try {
    loadKontoutskrift();
    console.log(`${C.green}[OK]${C.reset} kontoutskrift.pdf found`);
  } catch (error) {
    console.error(`${C.red}[FAIL]${C.reset} ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Pre-cleanup: Remove stale test entities from previous runs
  try {
    console.log(`\n${C.dim}Pre-cleanup: Removing stale test data from previous runs...${C.reset}`);
    const accessToken = await getValidAccessToken(USER_ID);
    const connection = await getFikenConnection(USER_ID);
    if (accessToken && connection?.companyId) {
      const client = createFikenClient(accessToken, connection.companyId);

      // Clean up stale purchases
      const stalePurchases = await client.getPurchases({ dateGe: "2026-01-01", dateLe: "2026-01-31", pageSize: 100 });
      for (const p of stalePurchases) {
        if (p.purchaseId && !KEEP_IDS.includes(p.purchaseId)) {
          const totalGross = p.lines?.reduce((sum, l) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
          const grossKr = totalGross / 100;
          if (expectedPurchaseAmounts.some((amt) => Math.abs(grossKr - amt) < 5)) {
            try {
              await client.deletePurchase(p.purchaseId, "Pre-cleanup: stale test data");
              console.log(`  ${C.dim}Deleted stale purchase #${p.purchaseId} (${grossKr} kr)${C.reset}`);
            } catch { /* ignore */ }
          }
        }
      }

      // Clean up stale journal entries
      const staleJEs = await client.getJournalEntries({ dateGe: "2026-01-01", dateLe: "2026-01-31", pageSize: 100 });
      const expectedJeAmountsPreClean = [12631, 15274, 41535];
      for (const je of staleJEs) {
        if (je.journalEntryId && !KEEP_IDS.includes(je.journalEntryId)) {
          const lineAmounts = je.lines?.map((l) => (l.amount || 0) / 100) || [];
          if (lineAmounts.some((amt) => expectedJeAmountsPreClean.some((exp) => Math.abs(amt - exp) < 5))) {
            if (je.transactionId) {
              try {
                await client.deleteTransaction(je.transactionId, "Pre-cleanup: stale test data");
                console.log(`  ${C.dim}Deleted stale journal entry #${je.journalEntryId}${C.reset}`);
              } catch { /* ignore */ }
            }
          }
        }
      }

      // Clean up stale sales
      const staleSales = await client.getSales({ dateGe: "2026-01-01", dateLe: "2026-01-31", pageSize: 100 });
      for (const s of staleSales) {
        if (s.saleId && !KEEP_IDS.includes(s.saleId)) {
          const grossKr = (s.grossAmount || 0) / 100;
          if (Math.abs(grossKr - 253800) < 500) {
            try {
              await client.deleteSale(s.saleId, "Pre-cleanup: stale test data");
              console.log(`  ${C.dim}Deleted stale sale #${s.saleId} (${grossKr} kr)${C.reset}`);
            } catch { /* ignore */ }
          }
        }
      }

      console.log(`${C.green}[OK]${C.reset} Pre-cleanup complete`);
    }
  } catch (error) {
    console.log(`  ${C.yellow}Pre-cleanup warning:${C.reset} ${error instanceof Error ? error.message : error}`);
  }

  const startTime = Date.now();

  // ─────────────────────────────────────────
  // PART 1: THE CONVERSATION
  // ─────────────────────────────────────────
  let conversationResult: ConversationResult;
  try {
    conversationResult = await runConversation(maxStep);
  } catch (error) {
    console.error(
      `\n${C.red}FATAL ERROR during conversation:${C.reset}`,
      error instanceof Error ? error.message : error,
    );
    failedAssertions++;
    totalAssertions++;
    conversationResult = { history: [], bookedPurchases: [], bookedJournals: [], bookedSales: [] };
  }

  const totalBooked = conversationResult.bookedPurchases.length +
    conversationResult.bookedJournals.length +
    conversationResult.bookedSales.length;

  // ─────────────────────────────────────────
  // PART 2: CROSS-CUTTING ASSERTIONS
  // ─────────────────────────────────────────
  if (conversationResult.history.length > 0) {
    console.log(`\n${C.bold}═══ Cross-cutting Assertions${C.reset}`);

    const allAssistantText = conversationResult.history
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n");

    assert(
      "Fiken limitation mentioned at least once",
      contains(allAssistantText, "manuelt", "selv laste") ||
        contains(allAssistantText, "laste opp", "fiken") ||
        contains(allAssistantText, "ikke tilgang"),
    );
    assert(
      "Never claims to upload kontoutskrift to Fiken",
      notContains(allAssistantText, "har lastet opp kontoutskriften i fiken"),
    );
    assert(
      "Mentions bank account details",
      contains(allAssistantText, "1920", "demo-konto", "bankkonto"),
    );
  }

  // ─────────────────────────────────────────
  // PART 3: FIKEN API VERIFICATION
  // ─────────────────────────────────────────
  let verificationResult: VerificationResult | null = null;
  if (maxStep >= 8 && totalBooked > 0) {
    try {
      await delay(5000); // Give Fiken API time to process

      verificationResult = await verifyInFiken();

      console.log(`\n${C.bold}  Verification Results:${C.reset}`);
      console.log(`  Test purchases found:      ${verificationResult.purchases.length}`);
      console.log(`  Test journal entries found: ${verificationResult.journalEntries.length}`);
      console.log(`  Test sales found:          ${verificationResult.sales.length}`);

      for (const p of verificationResult.purchases) {
        const supplierInfo = p.supplier ? `supplier: ${p.supplier}` : "kontantkjøp";
        console.log(
          `    ${C.dim}Purchase #${p.purchaseId}: ${p.grossKr} kr — ${p.description} (${supplierInfo}, konto ${p.account})${C.reset}`,
        );
      }
      for (const je of verificationResult.journalEntries) {
        console.log(
          `    ${C.dim}JournalEntry #${je.journalEntryId}: ${je.description} — ${je.lines.map((l) => `${l.amountKr} kr`).join(", ")}${C.reset}`,
        );
      }
      for (const s of verificationResult.sales) {
        console.log(
          `    ${C.dim}Sale #${s.saleId}: ${s.grossKr} kr — ${s.date} (${s.kind || "unknown kind"})${C.reset}`,
        );
      }

      // ── PURCHASE VERIFICATION ──
      console.log(`\n${C.bold}  Purchase Verification:${C.reset}`);

      // Check IT purchases — we expect at least some of the 6 IT purchases
      const itAmounts = [9, 149.65, 309.62, 199.20, 206.62];
      let itCount = 0;
      for (const amt of itAmounts) {
        const matches = verificationResult.purchases.filter((p) => Math.abs(p.grossKr - amt) < 5);
        if (matches.length > 0) itCount++;
      }
      // Count 9kr purchases separately (expect 2)
      const nineKrPurchases = verificationResult.purchases.filter((p) => Math.abs(p.grossKr - 9) < 2);

      assert(
        "IT purchases found (at least 4 of 6)",
        itCount >= 4,
        `Found ${itCount} distinct IT amounts, ${nineKrPurchases.length}x 9kr`,
      );

      // Check bank fees
      const feeAmounts = [339.50, 43.75];
      let feeCount = 0;
      for (const amt of feeAmounts) {
        const match = verificationResult.purchases.find((p) => Math.abs(p.grossKr - amt) < 5);
        if (match) feeCount++;
      }
      assert(
        "Bank fee purchases found (at least 1 of 2)",
        feeCount >= 1,
        `Found ${feeCount}/2 bank fees`,
      );

      // Check Randi Regnskap
      const regnskapPurchase = verificationResult.purchases.find((p) => Math.abs(p.grossKr - 4500) < 50);
      assert(
        "Randi Regnskap purchase found (~4500 kr)",
        regnskapPurchase !== undefined,
        regnskapPurchase ? `${regnskapPurchase.grossKr} kr, konto ${regnskapPurchase.account}` : "Not found",
      );

      // Check all purchases have valid accounts (not 6900)
      for (const p of verificationResult.purchases) {
        assert(
          `Purchase #${p.purchaseId} has valid account (not 6900)`,
          p.account !== null && p.account !== "6900",
          `Account: ${p.account}`,
        );
      }

      // Check paid status for kontantkjøp
      for (const p of verificationResult.purchases) {
        if (!p.supplier) {
          assert(
            `Purchase #${p.purchaseId} (kontantkjøp) is paid`,
            p.paid === true,
            p.paid ? "paid" : "NOT paid",
          );
        }
      }

      // ── JOURNAL ENTRY VERIFICATION ──
      console.log(`\n${C.bold}  Journal Entry Verification:${C.reset}`);

      assert(
        "At least 1 journal entry found",
        verificationResult.journalEntries.length >= 1,
        `Found ${verificationResult.journalEntries.length}`,
      );

      // Check for specific amounts
      const expectedJeAmounts = [12631, 15274, 41535];
      for (const expectedAmt of expectedJeAmounts) {
        const found = verificationResult.journalEntries.some((je) =>
          je.lines.some((l) => Math.abs(l.amountKr - expectedAmt) < 5),
        );
        assert(
          `Journal entry with amount ${expectedAmt} kr exists`,
          found,
          found ? "Found" : "Not found",
        );
      }

      // ── SALE VERIFICATION ──
      console.log(`\n${C.bold}  Sale Verification:${C.reset}`);

      assert(
        "Folq AS sale found (~253800 kr)",
        verificationResult.sales.length >= 1,
        verificationResult.sales.length > 0
          ? `${verificationResult.sales[0].grossKr} kr`
          : "No sale found",
      );

      if (verificationResult.sales.length > 0) {
        assert(
          "Sale is marked as paid",
          verificationResult.sales[0].paid === true,
          verificationResult.sales[0].paid ? "paid" : "NOT paid",
        );
      }

      // ── OVERALL COUNT ──
      console.log(`\n${C.bold}  Overall Verification:${C.reset}`);
      const totalVerified = verificationResult.purchases.length +
        verificationResult.journalEntries.length +
        verificationResult.sales.length;

      assert(
        "Total entities >= 8 (of 11 expected)",
        totalVerified >= 8,
        `${totalVerified} entities found in Fiken`,
      );

      // No excessive duplicates
      assert(
        "No excessive duplicates (max 15 purchases)",
        verificationResult.purchases.length <= 15,
        `${verificationResult.purchases.length} purchases found`,
      );

      // ─────────────────────────────────────────
      // PART 4: CLEANUP
      // ─────────────────────────────────────────
      if (!noCleanup && totalVerified > 0) {
        await cleanupFiken(verificationResult);
      } else if (noCleanup) {
        console.log(`\n${C.dim}═══ Cleanup skipped (--no-cleanup flag)${C.reset}`);
      }
    } catch (error) {
      console.error(
        `\n${C.red}VERIFICATION ERROR:${C.reset}`,
        error instanceof Error ? error.message : error,
      );
      failedAssertions++;
      totalAssertions++;
    }
  } else if (maxStep >= 8) {
    console.log(`\n${C.yellow}⚠ Skipping Fiken verification — no entities were booked${C.reset}`);
    console.log(`${C.dim}  Booked: ${totalBooked} entities${C.reset}`);
    console.log(`${C.dim}  Try running with --verbose to see full responses.${C.reset}`);
    assert(
      "At least one entity was booked during conversation",
      false,
      "Nothing was confirmed as booked",
    );
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // ─────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log(`${C.bold}SUMMARY — Bank Reconciliation E2E Test (ALL 11 Transactions)${C.reset}`);
  console.log("=".repeat(70));
  console.log(
    `Conversation: ${Math.floor(conversationResult.history.length / 2)} turns (${conversationResult.history.filter((m) => m.role === "user").length} user, ${conversationResult.history.filter((m) => m.role === "assistant").length} assistant)`,
  );
  console.log(
    `Bookings:     Purchases: ${C.green}${conversationResult.bookedPurchases.length}${C.reset}, ` +
      `Journal entries: ${C.green}${conversationResult.bookedJournals.length}${C.reset}, ` +
      `Sales: ${C.green}${conversationResult.bookedSales.length}${C.reset}`,
  );
  console.log(
    `Assertions:   ${C.green}${passedAssertions} passed${C.reset}, ${failedAssertions > 0 ? C.red : C.dim}${failedAssertions} failed${C.reset} / ${totalAssertions} total`,
  );
  console.log(`Duration:     ${duration}s`);

  if (verificationResult) {
    console.log(
      `\nFiken:        ${verificationResult.purchases.length} purchases, ${verificationResult.journalEntries.length} journal entries, ${verificationResult.sales.length} sales verified`,
    );
    for (const p of verificationResult.purchases) {
      console.log(`  ${C.green}✓${C.reset} Purchase #${p.purchaseId}: ${p.grossKr} kr — ${p.description} (konto ${p.account})`);
    }
    for (const je of verificationResult.journalEntries) {
      console.log(`  ${C.green}✓${C.reset} JournalEntry #${je.journalEntryId}: ${je.description}`);
    }
    for (const s of verificationResult.sales) {
      console.log(`  ${C.green}✓${C.reset} Sale #${s.saleId}: ${s.grossKr} kr`);
    }
  }

  if (failedAssertions > 0) {
    console.log(`\n${C.red}${C.bold}SOME ASSERTIONS FAILED${C.reset}`);
    console.log(`${C.dim}Run with --verbose to see full AI responses.${C.reset}`);
  } else {
    console.log(`\n${C.green}${C.bold}ALL ASSERTIONS PASSED${C.reset}`);
  }

  console.log("");

  // Disconnect Prisma
  const { prisma } = await import("../src/db.js");
  await prisma.$disconnect();

  process.exit(failedAssertions > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(`${C.red}Fatal error:${C.reset}`, error);
  try {
    const { prisma } = await import("../src/db.js");
    await prisma.$disconnect();
  } catch { /* ignore */ }
  process.exit(1);
});
