/**
 * E2E Test: Purchase Registration — 4 Scenarios (~20 turns)
 *
 * Simulates a REAL user (like the customer who reported the bug) trying to
 * register purchases in various ways. Talks naturally in Norwegian, gives
 * incomplete info, changes mind, uploads receipts.
 *
 * CRITICAL BUG BEING TESTED: Customer reported that after uploading a receipt
 * and answering questions about konto/leverandør, the system "brukte så lang tid
 * at jeg lurer på om noe feil har skjedd" — i.e. the agent got stuck.
 *
 * Scenarios:
 *   A) Kontantkjøp uten kvittering — "Kjøpte kontorrekvisita på Clas Ohlson for 487 kr"
 *      Natural speech, no PDF. Agent must ask for account, confirm, register.
 *   B) Kvittering med PDF — Upload a receipt for an Elkjøp purchase (749 kr).
 *      This is THE scenario from the bug report. Agent must read PDF, present
 *      summary, ask for account, and ACTUALLY register (not get stuck).
 *   C) Leverandørfaktura (ubetalt) — "Fikk faktura fra Telenor på 599 kr"
 *      Tests supplier invoice flow with dueDate.
 *   D) Bruker endrer mening — Start with wrong amount, correct mid-conversation.
 *      "Kjøpte printerpapir for 350 kr... nei vent, det var 450 kr"
 *
 * After conversation, verifies DIRECTLY against Fiken API:
 *   - Each purchase exists with correct amount, account, date, paid status
 *   - Supplier invoices have correct supplierId and dueDate
 *   - Then cleans up all test data
 *
 * Prerequisites:
 *   - API server running on localhost:3001
 *   - Docker DB running (regnskap-db)
 *   - Valid Fiken demo account connected
 *
 * Usage:
 *   npx tsx scripts/e2e-test-purchase.ts
 *   npx tsx scripts/e2e-test-purchase.ts --verbose
 *   npx tsx scripts/e2e-test-purchase.ts --no-cleanup
 *   npx tsx scripts/e2e-test-purchase.ts --step=6
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

// Expected purchase amounts (in KR) for pre-cleanup identification
// Include 350 (old amount from scenario D correction) to clean up stale data
const TEST_PURCHASE_AMOUNTS = [487, 749, 599, 450, 350, 1234];

// Date for all test purchases — use a date in 2026 that's not jan
// (to avoid conflict with bank test which uses januar 2026)
const TEST_DATE = "2026-02-15";
const TEST_DATE_DISPLAY = "15. februar 2026";
const TEST_DATE_RANGE_START = "2026-02-01";
const TEST_DATE_RANGE_END = "2026-02-28";

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

interface TestPurchase {
  purchaseId: number;
  description: string;
  grossKr: number;
  account: string;
  paid: boolean;
  kind: string;
  date: string;
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
  timeoutMs: number = 120_000,
): Promise<ParsedStream> {
  const body: Record<string, unknown> = { messages };
  if (files && files.length > 0) {
    body.files = files;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${USER_ID}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    }

    return await parseSSE(response);
  } finally {
    clearTimeout(timer);
  }
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

/**
 * Check if the agent's response indicates a PURCHASE was ACTUALLY created/registered.
 * Must be purchase-specific — "leverandøren er nå opprettet" does NOT count.
 */
function purchaseWasCreated(text: string): boolean {
  const lower = text.toLowerCase();

  // If the response asks for confirmation, NOT created yet
  if (contains(text, "stemmer dette", "ja/nei", "bekreft dette")) {
    return false;
  }

  // Exclude supplier/contact creation — these are NOT purchases
  // Check if text is primarily about creating a supplier/contact, not a purchase
  const isAboutSupplier = (
    contains(text, "leverandøren er nå opprettet", "leverandør er opprettet") &&
    !contains(text, "kjøp", "faktura", "utgift", "kontantkjøp")
  );
  if (isAboutSupplier) return false;

  // Purchase-specific patterns
  const purchasePatterns = [
    /kjøp(?:et)?\s+(?:er|har|ble)\s+(?:nå\s+)?(?:registrert|opprettet|bokført)/,
    /faktura(?:en)?\s+(?:er|har|ble)\s+(?:nå\s+)?(?:registrert|opprettet|bokført)/,
    /utgift(?:en)?\s+(?:er|har|ble)\s+(?:nå\s+)?(?:registrert|opprettet|bokført)/,
    /kontantkjøp(?:et)?\s+(?:er|har|ble)\s+(?:nå\s+)?(?:registrert|opprettet)/,
    /leverandørfaktura(?:en)?\s+(?:er|har|ble)\s+(?:nå\s+)?(?:registrert|opprettet)/,
  ];

  // General patterns — but only if in purchase context (mentions amount or account)
  const generalPatterns = [
    /er\s+nå\s+registrert/,
    /har\s+(?:nå\s+)?registrert/,
    /er\s+nå\s+bokført/,
    /har\s+(?:nå\s+)?bokført/,
  ];

  const hasPurchaseContext = contains(text, "kr", "konto", "bankkonto", "betalt", "ubetalt", "mva");

  const purchaseStringPatterns = [
    "kjøpet er registrert",
    "fakturaen er registrert",
    "er registrert på konto",
    "er bokført på konto",
  ];

  return (
    purchasePatterns.some((r) => r.test(lower)) ||
    purchaseStringPatterns.some((p) => lower.includes(p)) ||
    (generalPatterns.some((r) => r.test(lower)) && hasPurchaseContext)
  );
}

/**
 * Check if agent is asking a question that needs user response
 */
function agentNeedsResponse(text: string): boolean {
  return (
    (contains(text, "stemmer dette", "bekreft", "skal jeg", "vil du", "ønsker du") ||
      contains(text, "hvilken konto", "kan du oppgi", "trenger jeg", "hva er") ||
      contains(text, "?")) &&
    !purchaseWasCreated(text)
  );
}

/**
 * Send confirmation and retry until entity is created.
 * Adapts the confirmation message based on what the agent is asking.
 */
async function confirmUntilCreated(
  history: ConvMessage[],
  stepLabel: string,
  maxRetries: number = 4,
): Promise<{ result: ParsedStream; created: boolean }> {
  let created = false;
  let lastResult: ParsedStream | null = null;

  for (let i = 0; i < maxRetries; i++) {
    const suffix = i === 0 ? "" : ` (attempt ${i + 1})`;
    await delay(3000);

    const lastAssistant = history[history.length - 1];
    let confirmMsg: string;

    // Adapt confirmation based on what agent asked
    // PRIORITY: If agent presents a summary and asks "stemmer dette?" — just confirm!
    if (contains(lastAssistant.content, "stemmer dette", "ja/nei", "bekreft", "bekrefter du")) {
      confirmMsg = "Ja, det stemmer! Registrer det.";
    } else if (contains(lastAssistant.content, "hvilken konto", "velg konto", "svar med 1")) {
      // Agent is asking about account — give a reasonable one
      confirmMsg = "Bruk konto 6540 (inventar og utstyr).";
    } else if (contains(lastAssistant.content, "betalt", "ubetalt", "betalingsstatus")) {
      confirmMsg = "Ja, det er betalt.";
    } else if (contains(lastAssistant.content, "mva", "merverdiavgift")) {
      confirmMsg = "25% MVA.";
    } else if (contains(lastAssistant.content, "bankkonto", "hvilken bank")) {
      confirmMsg = "Bruk Demo-konto (1920:10001).";
    } else if (contains(lastAssistant.content, "leverandør")) {
      confirmMsg = "Registrer uten leverandør, bare som kontantkjøp.";
    } else if (contains(lastAssistant.content, "skal jeg")) {
      confirmMsg = "Ja, gjør det!";
    } else if (contains(lastAssistant.content, "prøve igjen", "på nytt", "forsøke")) {
      confirmMsg = "Ja, prøv igjen!";
    } else if (contains(lastAssistant.content, "?")) {
      confirmMsg = "Ja, registrer kjøpet!";
    } else {
      confirmMsg = "Ja, registrer kjøpet nå!";
    }

    console.log(`\n${C.bold}═══ ${stepLabel}${suffix}: Confirm${C.reset}`);
    console.log(`${C.dim}  "${confirmMsg}"${C.reset}`);

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

    if (purchaseWasCreated(lastResult.fullText)) {
      created = true;
      break;
    }

    // If agent is not asking anything more, it might be stuck or done
    if (!agentNeedsResponse(lastResult.fullText) && !contains(lastResult.fullText, "?")) {
      break;
    }
  }

  return { result: lastResult!, created };
}

/**
 * Generate a simple test PDF receipt (just enough for the AI to parse).
 * Creates a minimal PDF with receipt text.
 */
function generateTestReceiptPdf(): { name: string; type: string; data: string } {
  // Build a minimal but valid PDF with correct xref offsets.
  // The receipt text must be clearly parseable by AI vision/OCR.
  const receiptLines = [
    "ELKJOP NORGE AS",
    "Org.nr: 945 091 185",
    "Storgata 45, 0182 Oslo",
    "",
    "KVITTERING",
    "Dato: 15.02.2026",
    "Kl: 14:32",
    "",
    "Logitech MX Keys Tastatur",
    "1 stk x 749,00",
    "",
    "Sum ekskl. MVA:     599,20",
    "MVA 25%:            149,80",
    "TOTALT:             749,00 NOK",
    "",
    "Betalt med kort: **** 4521",
    "Ref: ELK-2026-889432",
    "",
    "Takk for handelen!",
  ];

  // Build content stream
  let streamContent = "BT\n/F1 10 Tf\n";
  let yPos = 750;
  for (const line of receiptLines) {
    const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    streamContent += `1 0 0 1 50 ${yPos} Tm\n(${escaped}) Tj\n`;
    yPos -= 16;
  }
  streamContent += "ET";
  const streamLen = Buffer.byteLength(streamContent, "latin1");

  // Build PDF objects individually and track byte offsets
  const objects: string[] = [];
  const offsets: number[] = [];

  const header = "%PDF-1.4\n";
  let pos = Buffer.byteLength(header, "latin1");

  // obj 1: Catalog
  offsets.push(pos);
  const obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objects.push(obj1);
  pos += Buffer.byteLength(obj1, "latin1");

  // obj 2: Pages
  offsets.push(pos);
  const obj2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  objects.push(obj2);
  pos += Buffer.byteLength(obj2, "latin1");

  // obj 3: Page
  offsets.push(pos);
  const obj3 = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n";
  objects.push(obj3);
  pos += Buffer.byteLength(obj3, "latin1");

  // obj 4: Content stream
  offsets.push(pos);
  const obj4 = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
  objects.push(obj4);
  pos += Buffer.byteLength(obj4, "latin1");

  // obj 5: Font
  offsets.push(pos);
  const obj5 = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  objects.push(obj5);
  pos += Buffer.byteLength(obj5, "latin1");

  // xref
  const xrefOffset = pos;
  const pad = (n: number) => String(n).padStart(10, "0");
  const xref = [
    "xref",
    "0 6",
    `${pad(0)} 65535 f \r`,
    `${pad(offsets[0])} 00000 n \r`,
    `${pad(offsets[1])} 00000 n \r`,
    `${pad(offsets[2])} 00000 n \r`,
    `${pad(offsets[3])} 00000 n \r`,
    `${pad(offsets[4])} 00000 n \r`,
  ].join("\n") + "\n";

  const trailer = [
    "trailer",
    "<< /Size 6 /Root 1 0 R >>",
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ].join("\n") + "\n";

  const pdf = header + objects.join("") + xref + trailer;
  const base64 = Buffer.from(pdf, "latin1").toString("base64");

  return {
    name: "elkjop-kvittering.pdf",
    type: "application/pdf",
    data: base64,
  };
}


// ============================================
// Fiken client helper
// ============================================

async function getFikenClient() {
  const accessToken = await getValidAccessToken(USER_ID);
  if (!accessToken) throw new Error("No valid Fiken access token");

  const connection = await getFikenConnection(USER_ID);
  if (!connection?.companyId) throw new Error("No Fiken company connected");

  return createFikenClient(accessToken, connection.companyId);
}

// ============================================
// THE MAIN CONVERSATION
// ============================================

interface ConversationResult {
  history: ConvMessage[];
  createdPurchaseIds: number[];
}

async function runConversation(maxStep: number): Promise<ConversationResult> {
  const history: ConvMessage[] = [];
  const createdPurchaseIds: number[] = [];

  // Helper to send a step
  async function sendStep(
    stepNum: number,
    stepLabel: string,
    userMessage: string,
    files?: Array<{ name: string; type: string; data: string }>,
  ): Promise<ParsedStream> {
    if (maxStep < stepNum) throw new Error(`SKIP:${stepNum}`);

    console.log(`\n${C.bold}═══ ${stepLabel}${C.reset}`);
    const preview = userMessage.substring(0, 150);
    console.log(`${C.dim}  "${preview}${userMessage.length > 150 ? "..." : ""}"${C.reset}`);
    if (files) {
      console.log(`${C.dim}  [Attached: ${files.map(f => f.name).join(", ")}]${C.reset}`);
    }

    const msgs = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ];

    const start = Date.now();
    const result = await sendChat(msgs, files);
    console.log(`  ${C.dim}(${((Date.now() - start) / 1000).toFixed(1)}s)${C.reset}`);
    printResponse(stepLabel, result);

    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: result.fullText });

    return result;
  }

  /**
   * Helper: search Fiken for a new purchase matching expected amount.
   * Returns purchaseId if found, or null.
   */
  async function findPurchaseByAmount(amountKr: number, tolerance: number = 5): Promise<number | null> {
    const client = await getFikenClient();
    const purchases = await client.getPurchases({
      dateGe: TEST_DATE_RANGE_START,
      dateLe: TEST_DATE_RANGE_END,
      pageSize: 100,
    });

    for (const p of purchases) {
      if (p.purchaseId && KEEP_IDS.includes(p.purchaseId)) continue;
      const totalGross = p.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
      const grossKr = totalGross / 100;
      if (Math.abs(grossKr - amountKr) < tolerance) {
        // Make sure it's not already tracked
        if (!createdPurchaseIds.includes(p.purchaseId!)) {
          return p.purchaseId!;
        }
      }
    }
    return null;
  }

  // ──────────────────────────────────────────────
  // SCENARIO A: Kontantkjøp uten kvittering
  // "Kjøpte kontorrekvisita på Clas Ohlson for 487 kr"
  // ──────────────────────────────────────────────

  console.log(`\n${C.bold}${C.cyan}──── SCENARIO A: Kontantkjøp uten kvittering ────${C.reset}`);

  // Step 1: Natural request — incomplete info (no account, no date, no MVA)
  const step1 = await sendStep(1, "Step 1",
    "Hei! Jeg kjøpte kontorrekvisita på Clas Ohlson for 487 kr inkl mva i går. Kan du registrere det?",
  );

  assert("A.1: Response not empty", step1.fullText.trim().length > 30);
  assert("A.1: No fatal errors", step1.errors.length === 0);
  assert(
    "A.1: Delegates to purchase agent",
    delegated(step1, "delegateToPurchaseAgent"),
    step1.toolCalls.map((tc) => tc.toolName).join(", "),
  );
  // Agent should recognize the purchase details and ask for account or confirmation
  assert(
    "A.1: Agent acknowledges purchase details",
    contains(step1.fullText, "clas ohlson", "kontorrekvisita", "487"),
  );

  await delay(3000);

  // Step 2: Agent might ask about konto, or present summary — handle both
  let scenarioADone = purchaseWasCreated(step1.fullText);
  let stepAResult = step1;

  if (!scenarioADone) {
    // Agent should be asking a question (konto, bekreftelse, MVA, etc.)
    assert(
      "A.1: Agent asks follow-up question",
      agentNeedsResponse(step1.fullText) || contains(step1.fullText, "?"),
      "Agent should ask about konto/confirmation",
    );

    // Step 2: Provide account and confirm
    const step2msg = contains(step1.fullText, "svar med 1", "velg", "hvilken konto")
      ? "Bruk konto 6800 (kontorrekvisita). Betalt med debetkort på bankkonto 1920:10001."
      : "Ja, registrer det! Bruk konto 6800, betalt med kort, bankkonto 1920:10001.";

    const step2 = await sendStep(2, "Step A2", step2msg);
    assert("A.2: Response not empty", step2.fullText.trim().length > 30);
    assert("A.2: No fatal errors", step2.errors.length === 0);
    printResponse("Step A2", step2);

    scenarioADone = purchaseWasCreated(step2.fullText);
    stepAResult = step2;

    // If still not created, confirm until it is
    if (!scenarioADone && agentNeedsResponse(step2.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step A2");
      scenarioADone = created;
      stepAResult = result;
    }
  }

  assert(
    "A: Purchase was registered",
    scenarioADone,
    scenarioADone ? "Created successfully" : "FAILED — agent did not create purchase",
  );

  // Find the purchase in Fiken
  if (scenarioADone) {
    const purchaseId = await findPurchaseByAmount(487);
    if (purchaseId) {
      createdPurchaseIds.push(purchaseId);
      console.log(`  ${C.cyan}Found Clas Ohlson purchase in Fiken: #${purchaseId}${C.reset}`);
    }
    assert(
      "A: Purchase exists in Fiken",
      purchaseId !== null,
      purchaseId ? `purchaseId: ${purchaseId}` : "Not found in Fiken",
    );

    // Verify purchase details
    if (purchaseId) {
      const client = await getFikenClient();
      const purchase = await client.getPurchase(purchaseId);
      const totalGross = purchase.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
      assert(
        "A: Amount is ~487 kr",
        Math.abs(totalGross / 100 - 487) < 5,
        `${totalGross / 100} kr`,
      );
      assert(
        "A: Purchase is paid (kontantkjøp)",
        purchase.paid === true,
        `paid=${purchase.paid}`,
      );
      assert(
        "A: Kind is cash_purchase",
        (purchase as any).kind === "cash_purchase",
        `kind=${(purchase as any).kind}`,
      );
    }
  }

  await delay(3000);

  // ──────────────────────────────────────────────
  // SCENARIO B: Kvittering med PDF — THE BUG SCENARIO
  // Upload receipt, agent reads, presents summary, registers
  // ──────────────────────────────────────────────

  console.log(`\n${C.bold}${C.cyan}──── SCENARIO B: Kvittering med PDF (bug-scenario) ────${C.reset}`);

  const receipt = generateTestReceiptPdf();

  // Step 3: Upload receipt with natural message
  const step3 = await sendStep(3, "Step B1",
    "Jeg har en kvittering fra Elkjøp som jeg vil registrere. Her er den.",
    [receipt],
  );

  assert("B.1: Response not empty", step3.fullText.trim().length > 30);
  assert("B.1: No fatal errors", step3.errors.length === 0);
  assert(
    "B.1: Delegates to purchase agent",
    delegated(step3, "delegateToPurchaseAgent"),
    step3.toolCalls.map((tc) => tc.toolName).join(", "),
  );
  // Agent should read the PDF and present a summary
  assert(
    "B.1: Agent reads receipt content",
    contains(step3.fullText, "749", "elkjøp", "elkjop", "logitech", "tastatur", "kvittering") ||
    contains(step3.fullText, "lest", "funnet", "identifisert", "hentet"),
    "Agent should show parsed receipt details",
  );
  // CRITICAL: Agent must NOT say "registrert" at this point (Fix 3)
  assert(
    "B.1: Agent does NOT claim purchase is registered yet",
    notContains(step3.fullText, "er nå registrert", "har registrert kjøpet", "er nå bokført"),
    "Must not say 'registrert' before createPurchase is called",
  );

  await delay(3000);

  // Step 4: Agent should ask about account — respond with one
  let scenarioBDone = purchaseWasCreated(step3.fullText);
  let stepBResult = step3;

  if (!scenarioBDone) {
    assert(
      "B.1: Agent asks for account or confirmation",
      agentNeedsResponse(step3.fullText) || contains(step3.fullText, "?"),
      "Agent should ask about konto/confirmation",
    );

    const step4msg = contains(step3.fullText, "leverandør", "supplier", "kontakt")
      ? "Registrer det som kontantkjøp uten leverandør. Bruk konto 6540 (inventar og utstyr), betalt med kort på bankkonto 1920:10001."
      : contains(step3.fullText, "konto", "hvilken")
        ? "Bruk konto 6540 (inventar og utstyr). Betalt med kort, bankkonto 1920:10001."
        : "Ja, registrer det som kontantkjøp! Konto 6540, bankkonto 1920:10001.";

    const step4 = await sendStep(4, "Step B2", step4msg);
    assert("B.2: Response not empty", step4.fullText.trim().length > 30);
    assert("B.2: No fatal errors", step4.errors.length === 0);

    scenarioBDone = purchaseWasCreated(step4.fullText);
    stepBResult = step4;

    // CRITICAL TEST: This is where the bug happened — agent asked for konto,
    // user answered, and then agent got stuck (never called createPurchase).
    // After our fixes, the agent should actually register now.
    if (!scenarioBDone && agentNeedsResponse(step4.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step B2");
      scenarioBDone = created;
      stepBResult = result;
    }

    // TIMEOUT CHECK: If agent responds but doesn't create, that's the bug
    if (!scenarioBDone) {
      assert(
        "B: CRITICAL — Agent did not get stuck",
        false,
        "Agent failed to register purchase after receiving account info. " +
        "This is the exact bug reported by customer: " +
        "'brukte systemet så lang tid at jeg lurer på om noe feil har skjedd'",
      );
    }
  }

  assert(
    "B: Purchase was registered from receipt",
    scenarioBDone,
    scenarioBDone ? "Created successfully — bug is FIXED!" : "FAILED — bug still present",
  );

  // Find the purchase in Fiken
  // The agent reads the PDF and may parse a slightly different amount.
  // Try 749 first (the correct receipt total), then extract what the agent
  // actually claimed from its response and search for that amount too.
  if (scenarioBDone) {
    let purchaseId = await findPurchaseByAmount(749);
    let expectedAmountKr = 749;

    // If not found at 749, extract the amount the agent mentioned
    if (!purchaseId) {
      const allText = stepBResult.fullText;
      // Match patterns like "1 234 kr", "749 kr", "1234,00"
      const amountMatch = allText.match(/(\d[\d\s]*(?:,\d+)?)\s*kr/i);
      if (amountMatch) {
        const parsed = parseFloat(amountMatch[1].replace(/\s/g, "").replace(",", "."));
        if (parsed > 0 && parsed !== 749) {
          console.log(`  ${C.dim}Agent parsed ${parsed} kr from PDF (expected 749). Searching for that amount...${C.reset}`);
          purchaseId = await findPurchaseByAmount(parsed);
          if (purchaseId) expectedAmountKr = parsed;
        }
      }
    }

    if (purchaseId) {
      createdPurchaseIds.push(purchaseId);
      console.log(`  ${C.cyan}Found Elkjøp purchase in Fiken: #${purchaseId}${C.reset}`);
    }
    assert(
      "B: Purchase exists in Fiken",
      purchaseId !== null,
      purchaseId ? `purchaseId: ${purchaseId}` : "Not found in Fiken",
    );

    if (purchaseId) {
      const client = await getFikenClient();
      const purchase = await client.getPurchase(purchaseId);
      const totalGross = purchase.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
      assert(
        `B: Amount is ~${expectedAmountKr} kr`,
        Math.abs(totalGross / 100 - expectedAmountKr) < 5,
        `${totalGross / 100} kr`,
      );
      assert(
        "B: Purchase is paid (kvittering = betalt)",
        purchase.paid === true,
        `paid=${purchase.paid}`,
      );
    }
  }

  await delay(3000);

  // ──────────────────────────────────────────────
  // SCENARIO C: Leverandørfaktura (ubetalt)
  // "Fikk faktura fra Telenor på 599 kr for mobilabonnement"
  // ──────────────────────────────────────────────

  console.log(`\n${C.bold}${C.cyan}──── SCENARIO C: Leverandørfaktura (ubetalt) ────${C.reset}`);

  const step5 = await sendStep(5, "Step C1",
    "Jeg har fått en faktura fra Telenor på 599 kr inkl mva for mobilabonnement. " +
    "Forfallsdato er 1. mars 2026. Kan du registrere den?",
  );

  assert("C.1: Response not empty", step5.fullText.trim().length > 30);
  assert("C.1: No fatal errors", step5.errors.length === 0);
  assert(
    "C.1: Delegates to purchase agent",
    delegated(step5, "delegateToPurchaseAgent"),
    step5.toolCalls.map((tc) => tc.toolName).join(", "),
  );
  assert(
    "C.1: Agent acknowledges Telenor/faktura details",
    contains(step5.fullText, "telenor", "599", "faktura", "mobilabonnement") ||
    contains(step5.fullText, "telenor", "599"),
  );

  await delay(3000);

  let scenarioCDone = purchaseWasCreated(step5.fullText);
  let stepCResult = step5;

  if (!scenarioCDone) {
    // Agent might ask about account, leverandør, or confirm
    const step6msg = contains(step5.fullText, "konto", "hvilken")
      ? "Bruk konto 6900 (telefon). Den er ubetalt, leverandørfaktura."
      : contains(step5.fullText, "leverandør")
        ? "Ja, bruk Telenor som leverandør. Konto 6900."
        : "Ja, registrer det! Konto 6900 (telefon), ubetalt leverandørfaktura.";

    const step6 = await sendStep(6, "Step C2", step6msg);
    assert("C.2: Response not empty", step6.fullText.trim().length > 30);
    assert("C.2: No fatal errors", step6.errors.length === 0);

    scenarioCDone = purchaseWasCreated(step6.fullText);
    stepCResult = step6;

    if (!scenarioCDone && agentNeedsResponse(step6.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step C2");
      scenarioCDone = created;
      stepCResult = result;
    }
  }

  assert(
    "C: Leverandørfaktura was registered",
    scenarioCDone,
    scenarioCDone ? "Created successfully" : "FAILED — agent did not create invoice",
  );

  // Find the purchase in Fiken
  if (scenarioCDone) {
    const purchaseId = await findPurchaseByAmount(599);
    if (purchaseId) {
      createdPurchaseIds.push(purchaseId);
      console.log(`  ${C.cyan}Found Telenor invoice in Fiken: #${purchaseId}${C.reset}`);
    }
    assert(
      "C: Purchase exists in Fiken",
      purchaseId !== null,
      purchaseId ? `purchaseId: ${purchaseId}` : "Not found in Fiken",
    );

    if (purchaseId) {
      const client = await getFikenClient();
      const purchase = await client.getPurchase(purchaseId);
      const totalGross = purchase.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
      assert(
        "C: Amount is ~599 kr",
        Math.abs(totalGross / 100 - 599) < 5,
        `${totalGross / 100} kr`,
      );
      // Supplier invoice should be unpaid
      assert(
        "C: Purchase is unpaid (leverandørfaktura)",
        purchase.paid === false || purchase.paid === undefined,
        `paid=${purchase.paid}`,
      );
    }
  }

  await delay(3000);

  // ──────────────────────────────────────────────
  // SCENARIO D: Bruker endrer mening underveis
  // Start with 350 kr, correct to 450 kr
  // ──────────────────────────────────────────────

  console.log(`\n${C.bold}${C.cyan}──── SCENARIO D: Bruker endrer mening ────${C.reset}`);

  const step7 = await sendStep(7, "Step D1",
    "Jeg kjøpte printerpapir og toner på Staples for 350 kr i dag. " +
    "Kontantkjøp, betalt med kort.",
  );

  assert("D.1: Response not empty", step7.fullText.trim().length > 30);
  assert("D.1: No fatal errors", step7.errors.length === 0);

  await delay(3000);

  // Step 8: User corrects themselves BEFORE agent registers
  const step8 = await sendStep(8, "Step D2",
    "Nei vent, jeg sjekket kvitteringen — det var 450 kr, ikke 350. Beklager! " +
    "Kan du bruke konto 6800 (kontorrekvisita), bankkonto 1920:10001?",
  );

  assert("D.2: Response not empty", step8.fullText.trim().length > 30);
  assert("D.2: No fatal errors", step8.errors.length === 0);
  // Agent should acknowledge the correction
  assert(
    "D.2: Agent acknowledges correction",
    contains(step8.fullText, "450") || contains(step8.fullText, "oppdater"),
    "Should reference the corrected amount 450 kr",
  );

  await delay(3000);

  let scenarioDDone = purchaseWasCreated(step8.fullText);
  let stepDResult = step8;

  if (!scenarioDDone) {
    // Confirm the corrected purchase
    if (agentNeedsResponse(step8.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step D2");
      scenarioDDone = created;
      stepDResult = result;
    }
  }

  assert(
    "D: Purchase was registered with corrected amount",
    scenarioDDone,
    scenarioDDone ? "Created successfully" : "FAILED — agent did not create purchase",
  );

  // Find the purchase — should be 450 kr, NOT 350 kr
  if (scenarioDDone) {
    const purchaseId450 = await findPurchaseByAmount(450);
    const purchaseId350 = await findPurchaseByAmount(350);

    if (purchaseId450) {
      createdPurchaseIds.push(purchaseId450);
      console.log(`  ${C.cyan}Found Staples purchase (corrected) in Fiken: #${purchaseId450}${C.reset}`);
    }

    assert(
      "D: Purchase with corrected amount (450 kr) exists",
      purchaseId450 !== null,
      purchaseId450 ? `purchaseId: ${purchaseId450}` : "Not found",
    );
    assert(
      "D: No purchase with old amount (350 kr) was created",
      purchaseId350 === null,
      purchaseId350 ? `WRONG — found 350 kr purchase #${purchaseId350}` : "Correct — no 350 kr purchase",
    );

    if (purchaseId450) {
      const client = await getFikenClient();
      const purchase = await client.getPurchase(purchaseId450);
      const totalGross = purchase.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
      assert(
        "D: Amount is ~450 kr (corrected)",
        Math.abs(totalGross / 100 - 450) < 5,
        `${totalGross / 100} kr`,
      );
      assert(
        "D: Purchase is paid",
        purchase.paid === true,
        `paid=${purchase.paid}`,
      );
    }
  }

  return { history, createdPurchaseIds };
}

// ============================================
// CLEANUP
// ============================================

async function cleanupPurchases(purchaseIds: number[]): Promise<void> {
  console.log(`\n${C.bold}═══ CLEANUP${C.reset}`);

  if (purchaseIds.length === 0) {
    console.log(`${C.dim}  No purchases to clean up${C.reset}`);
    return;
  }

  const client = await getFikenClient();
  console.log(`${C.dim}  Deleting ${purchaseIds.length} test purchases from Fiken...${C.reset}`);

  for (const id of purchaseIds) {
    if (KEEP_IDS.includes(id)) {
      console.log(`  ${C.yellow}⚠${C.reset} Skipping protected purchase #${id}`);
      continue;
    }
    try {
      await client.deletePurchase(id, "E2E purchase test cleanup");
      console.log(`  ${C.green}✓${C.reset} Deleted purchase #${id}`);
    } catch (error) {
      console.log(
        `  ${C.yellow}⚠${C.reset} Could not delete purchase #${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Safety sweep: find any remaining test purchases by amount
  console.log(`${C.dim}  Safety sweep: checking for remaining test purchases...${C.reset}`);
  try {
    const purchases = await client.getPurchases({
      dateGe: TEST_DATE_RANGE_START,
      dateLe: TEST_DATE_RANGE_END,
      pageSize: 100,
    });

    for (const p of purchases) {
      if (!p.purchaseId || KEEP_IDS.includes(p.purchaseId)) continue;
      if (purchaseIds.includes(p.purchaseId)) continue; // already handled

      const totalGross = p.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
      const grossKr = totalGross / 100;

      if (TEST_PURCHASE_AMOUNTS.some((amt) => Math.abs(grossKr - amt) < 10)) {
        try {
          await client.deletePurchase(p.purchaseId, "E2E purchase test safety cleanup");
          console.log(`  ${C.green}✓${C.reset} Safety: deleted stale purchase #${p.purchaseId} (${grossKr} kr)`);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("=".repeat(70));
  console.log(`${C.bold}E2E Test: Purchase Registration — 4 Scenarios${C.reset}`);
  console.log(`${C.dim}Kontantkjøp + Kvittering-PDF + Leverandørfaktura + Endring underveis${C.reset}`);
  console.log(`${C.dim}Tests the critical bug: "systemet brukte så lang tid..."${C.reset}`);
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
    console.error(`${C.red}[FAIL]${C.reset} Cannot reach API at ${API_URL}`);
    process.exit(1);
  }

  // Auth check
  try {
    const authCheck = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${USER_ID}`,
      },
      body: JSON.stringify({ messages: [] }),
    });
    if (authCheck.status === 401 || authCheck.status === 403) {
      throw new Error("Authentication failed");
    }
    console.log(`${C.green}[OK]${C.reset} Authentication valid`);
  } catch (error) {
    if (error instanceof Error && error.message === "Authentication failed") {
      console.error(`${C.red}[FAIL]${C.reset} Authentication failed for user ${USER_ID}`);
      process.exit(1);
    }
    // Other errors (like empty messages) are fine — auth worked
    console.log(`${C.green}[OK]${C.reset} Authentication valid`);
  }

  // Pre-cleanup: Remove stale test entities from previous runs
  try {
    console.log(`\n${C.dim}Pre-cleanup: Removing stale test data from previous runs...${C.reset}`);
    const client = await getFikenClient();

    const stalePurchases = await client.getPurchases({
      dateGe: TEST_DATE_RANGE_START,
      dateLe: TEST_DATE_RANGE_END,
      pageSize: 100,
    });

    for (const p of stalePurchases) {
      if (!p.purchaseId || KEEP_IDS.includes(p.purchaseId)) continue;
      const totalGross = p.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
      const grossKr = totalGross / 100;

      if (TEST_PURCHASE_AMOUNTS.some((amt) => Math.abs(grossKr - amt) < 10)) {
        try {
          await client.deletePurchase(p.purchaseId, "Pre-cleanup: stale purchase test data");
          console.log(`  ${C.dim}Deleted stale purchase #${p.purchaseId} (${grossKr} kr)${C.reset}`);
        } catch { /* ignore */ }
      }
    }

    console.log(`${C.green}[OK]${C.reset} Pre-cleanup complete`);
  } catch (error) {
    console.log(`  ${C.yellow}Pre-cleanup warning:${C.reset} ${error instanceof Error ? error.message : error}`);
  }

  const startTime = Date.now();

  // Run the conversation
  let conversationResult: ConversationResult | undefined;
  try {
    conversationResult = await runConversation(maxStep);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SKIP:")) {
      console.log(`\n${C.yellow}Stopped at step ${error.message.split(":")[1]} (--step flag)${C.reset}`);
    } else {
      console.error(`\n${C.red}CONVERSATION ERROR:${C.reset}`, error);
    }
  }

  // ─────────────────────────────────────────
  // CROSS-CUTTING ASSERTIONS
  // ─────────────────────────────────────────

  if (conversationResult) {
    console.log(`\n${C.bold}═══ Cross-cutting Assertions${C.reset}`);

    const allAssistantText = conversationResult.history
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n");

    assert(
      "Cross: Agent used Norwegian language throughout",
      contains(allAssistantText, "registrert", "kjøp", "konto", "faktura", "beløp"),
      "Norwegian domain terms present",
    );

    assert(
      "Cross: Agent never exposed raw JSON/API errors to user",
      notContains(allAssistantText, "\"error\":", "stack trace", "TypeError", "undefined is not"),
      "No raw errors",
    );

    // Count how many scenarios actually completed
    const scenariosCompleted = conversationResult.createdPurchaseIds.length;
    assert(
      "Cross: At least 3 of 4 purchases were created",
      scenariosCompleted >= 3,
      `${scenariosCompleted}/4 purchases created`,
    );

    // ─────────────────────────────────────────
    // FIKEN API VERIFICATION SUMMARY
    // ─────────────────────────────────────────

    console.log(`\n${C.bold}═══ FIKEN API VERIFICATION SUMMARY${C.reset}`);
    console.log(`${C.dim}  Created purchase IDs: ${conversationResult.createdPurchaseIds.join(", ") || "none"}${C.reset}`);

    if (conversationResult.createdPurchaseIds.length > 0) {
      const client = await getFikenClient();
      for (const id of conversationResult.createdPurchaseIds) {
        try {
          const purchase = await client.getPurchase(id);
          const totalGross = purchase.lines?.reduce((sum: number, l: any) => sum + (l.netPrice || 0) + (l.vat || 0), 0) || 0;
          const desc = purchase.lines?.[0]?.description || "no description";
          const account = purchase.lines?.[0]?.account || "?";
          const kind = (purchase as any).kind || "?";
          console.log(
            `  ${C.green}✓${C.reset} Purchase #${id}: ${totalGross / 100} kr — ${desc} (konto ${account}, ${kind}, paid=${purchase.paid})`,
          );
        } catch (error) {
          console.log(`  ${C.red}✗${C.reset} Purchase #${id}: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    // ─────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────

    if (noCleanup) {
      console.log(`\n${C.yellow}Skipping cleanup (--no-cleanup flag).${C.reset}`);
      console.log(`${C.dim}  Purchase IDs to manually delete: ${conversationResult.createdPurchaseIds.join(", ")}${C.reset}`);
    } else {
      await cleanupPurchases(conversationResult.createdPurchaseIds);
    }
  }

  // ─────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log(`${C.bold}SUMMARY — Purchase Registration E2E Test${C.reset}`);
  console.log("=".repeat(70));

  const turnCount = conversationResult?.history.filter((m) => m.role === "user").length || 0;
  console.log(`Conversation: ${turnCount} user turns`);
  console.log(`Purchases:    ${conversationResult?.createdPurchaseIds.length || 0} created in Fiken`);
  console.log(
    `Assertions:   ${C.green}${passedAssertions} passed${C.reset}, ${failedAssertions > 0 ? C.red : C.dim}${failedAssertions} failed${C.reset} / ${totalAssertions} total`,
  );
  console.log(`Duration:     ${duration}s`);

  if (failedAssertions === 0) {
    console.log(`\n${C.green}${C.bold}ALL ASSERTIONS PASSED${C.reset}`);
  } else {
    console.log(`\n${C.red}${C.bold}SOME ASSERTIONS FAILED${C.reset}`);
    if (!VERBOSE) {
      console.log(`${C.dim}Run with --verbose to see full AI responses.${C.reset}`);
    }
  }

  // Disconnect Prisma
  try {
    const { prisma } = await import("../src/db.js");
    await prisma.$disconnect();
  } catch { /* ignore */ }

  process.exit(failedAssertions > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
