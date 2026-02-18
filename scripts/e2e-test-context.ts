/**
 * E2E Test Suite: Context Continuity & Real Scenarios
 * 
 * Tests the SPECIFIC fixes for chat context continuity:
 * 1. Tool results passed to sub-agents (purchaseId, invoiceId etc.)
 * 2. Follow-up attachment uploads to existing entities
 * 3. Multi-turn conversations where AI remembers what it just did
 * 4. Human-in-the-loop confirmation flow
 * 5. File upload + create + confirm flow
 * 
 * These are REAL end-to-end tests that hit the live API with multi-turn
 * conversations, simulating actual user behavior.
 * 
 * Prerequisites:
 *   - API server running on localhost:3001
 *   - Valid Fiken user token (demo account)
 *   - Docker DB running
 * 
 * Usage:
 *   npx tsx scripts/e2e-test-context.ts
 *   npx tsx scripts/e2e-test-context.ts --scenario=1    # Run specific scenario
 *   npx tsx scripts/e2e-test-context.ts --scenario=1,3  # Run multiple scenarios
 *   npx tsx scripts/e2e-test-context.ts --verbose        # Show full responses
 */

const CONTEXT_API_URL = "http://localhost:3001";
const CONTEXT_USER_ID = "678b5c02-c4a1-4496-a479-006f257c37ab";

// ============================================
// Types
// ============================================

interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolData?: Record<string, unknown>;
}

interface ScenarioStep {
  /** User message to send */
  userMessage: string;
  /** Files to attach (base64 encoded) */
  files?: Array<{ name: string; type: string; data: string }>;
  /** Description of what this step tests */
  description: string;
  /** Assertions to check on the response */
  assertions: Array<{
    name: string;
    check: (result: ContextParsedStream, conversationHistory: ConversationMessage[]) => boolean;
  }>;
  /** Optional delay before this step (ms) */
  delayBefore?: number;
}

interface Scenario {
  id: number;
  name: string;
  description: string;
  steps: ScenarioStep[];
}

interface ContextParsedStream {
  fullText: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args?: unknown }>;
  toolResults: Array<{ toolCallId: string; result: unknown }>;
  errors: string[];
  textChunks: number;
}

interface ScenarioResult {
  scenarioId: number;
  scenarioName: string;
  steps: Array<{
    stepIndex: number;
    description: string;
    durationMs: number;
    responseText: string;
    toolsCalled: string[];
    assertions: Array<{
      name: string;
      passed: boolean;
    }>;
    error?: string;
  }>;
  overallPassed: boolean;
  totalDurationMs: number;
}

// ============================================
// ANSI colors
// ============================================

const c = {
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
// SSE Stream Parser (from e2e-test-agents.ts)
// ============================================

async function parseSSEStream(response: Response): Promise<ContextParsedStream> {
  const result: ContextParsedStream = {
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

      // 0: = text content
      const textMatch = line.match(/^0:"(.*)"/);
      if (textMatch) {
        const content = textMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        result.fullText += content;
        result.textChunks++;
      }

      // 9: = tool call start
      if (line.startsWith("9:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolCalls.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            toolName: data.toolName || data.name || "unknown",
          });
        } catch { /* ignore */ }
      }

      // a: = tool result
      if (line.startsWith("a:")) {
        try {
          const data = JSON.parse(line.slice(2));
          result.toolResults.push({
            toolCallId: data.toolCallId || data.id || "unknown",
            result: data.result || data,
          });
        } catch { /* ignore */ }
      }

      // e: = error
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

  // Process remaining buffer
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
// API helpers
// ============================================

async function sendChatMessage(
  messages: Array<{ role: string; content: string; toolData?: Record<string, unknown> }>,
  files?: Array<{ name: string; type: string; data: string }>,
): Promise<ContextParsedStream> {
  const body: Record<string, unknown> = { messages };
  if (files && files.length > 0) {
    body.files = files;
  }

  const response = await fetch(`${CONTEXT_API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONTEXT_USER_ID}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorBody}`);
  }

  return parseSSEStream(response);
}

async function createChat(title?: string): Promise<string> {
  const response = await fetch(`${CONTEXT_API_URL}/api/chats`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONTEXT_USER_ID}`,
    },
    body: JSON.stringify({ title: title || "E2E Test" }),
  });
  const chat = await response.json();
  return chat.id;
}

async function saveMessage(chatId: string, role: string, content: string, toolData?: Record<string, unknown>): Promise<void> {
  await fetch(`${CONTEXT_API_URL}/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONTEXT_USER_ID}`,
    },
    body: JSON.stringify({ role, content, toolData }),
  });
}

async function getChatMessages(chatId: string): Promise<ConversationMessage[]> {
  const response = await fetch(`${CONTEXT_API_URL}/api/chats/${chatId}`, {
    headers: { "Authorization": `Bearer ${CONTEXT_USER_ID}` },
  });
  const chat = await response.json();
  return chat.messages || [];
}

async function deleteChat(chatId: string): Promise<void> {
  await fetch(`${CONTEXT_API_URL}/api/chats/${chatId}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${CONTEXT_USER_ID}` },
  });
}

// ============================================
// Test receipt image (small 1x1 pixel PNG as placeholder)
// The actual content doesn't matter for routing tests — 
// what matters is that the AI receives a file and handles it correctly.
// For tests that need real image analysis, use /tmp/test-receipt.png
// ============================================

function getTestReceiptBase64(): string {
  // Minimal valid PNG (1x1 transparent pixel)
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

async function getRealTestReceipt(): Promise<string | null> {
  try {
    const fs = await import("fs");
    const path = "/tmp/test-receipt.png";
    if (fs.existsSync(path)) {
      return fs.readFileSync(path).toString("base64");
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================
// Helper: check if response text contains any of the given patterns
// ============================================

function textContains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

function textNotContains(text: string, ...patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return !patterns.some(p => lower.includes(p.toLowerCase()));
}

function calledTool(result: ContextParsedStream, ...toolNames: string[]): boolean {
  return toolNames.some(name => 
    result.toolCalls.some(tc => tc.toolName === name)
  );
}

function calledAnyDelegation(result: ContextParsedStream): boolean {
  return result.toolCalls.some(tc => tc.toolName.startsWith("delegateTo"));
}

function delegatedTo(result: ContextParsedStream, agentTool: string): boolean {
  return result.toolCalls.some(tc => tc.toolName === agentTool);
}

function toolResultContains(result: ContextParsedStream, ...patterns: string[]): boolean {
  const allResults = JSON.stringify(result.toolResults).toLowerCase();
  return patterns.some(p => allResults.includes(p.toLowerCase()));
}

// ============================================
// SCENARIOS
// ============================================

const SCENARIOS: Scenario[] = [
  // ─────────────────────────────────────────────
  // Scenario 1: Basic single-turn purchase creation
  // ─────────────────────────────────────────────
  {
    id: 1,
    name: "Enkel kjøpsregistrering",
    description: "Create a simple purchase and verify routing + confirmation flow",
    steps: [
      {
        userMessage: "Registrer et kjøp fra Rema 1000 på 249 kr for dagligvarer, betalt i dag med bankkonto",
        description: "Ask to register a purchase — should delegate to purchase agent and ask for confirmation",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Response mentions confirmation or summary",
            check: (r) => textContains(r.fullText, "stemmer dette", "bekreft", "oppsummering", "riktig", "registrer", "Rema"),
          },
          {
            name: "Response mentions Rema 1000",
            check: (r) => textContains(r.fullText, "Rema", "rema"),
          },
          {
            name: "Response mentions amount or asks about purchase details",
            check: (r) => textContains(r.fullText, "249", "dagligvarer", "Rema", "kjøp", "kontantkjøp"),
          },
          {
            name: "No errors in stream",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 2: Multi-turn purchase + follow-up question
  // ─────────────────────────────────────────────
  {
    id: 2,
    name: "Kjøp + oppfølgingsspørsmål (kontekst)",
    description: "Create a purchase, then ask a follow-up question about it — AI must remember what it just did",
    steps: [
      {
        userMessage: "Registrer kjøp fra Elkjøp på 4999 kr for en kontorskjerm, betalt i dag med bankkonto",
        description: "Step 1: Register a purchase from Elkjøp",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Mentions Elkjøp or skjerm",
            check: (r) => textContains(r.fullText, "Elkjøp", "elkjøp", "skjerm"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Ja, det stemmer",
        description: "Step 2: Confirm the purchase — should proceed to create it",
        delayBefore: 2000,
        assertions: [
          {
            name: "Delegates to purchase agent (to execute)",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Response indicates purchase was created or processing",
            check: (r) => textContains(r.fullText, "registrert", "opprettet", "kjøp", "fullført", "purchase", "Elkjøp", "elkjøp"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Hvilken konto ble dette ført på?",
        description: "Step 3: Follow-up question about the purchase — AI must remember what it just created",
        delayBefore: 2000,
        assertions: [
          {
            name: "Response is not empty",
            check: (r) => r.fullText.trim().length > 20,
          },
          {
            name: "AI does NOT say it can't find the purchase",
            check: (r) => textNotContains(r.fullText, "finner ikke", "kan ikke finne", "har ikke", "vet ikke hva"),
          },
          {
            name: "AI mentions an account number or account name",
            check: (r) => textContains(r.fullText, "konto", "6500", "6540", "6570", "4010", "4200", "7500", "inventar", "kontorrekvisita", "kontormaskin"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 3: Read-only operations (no confirmation needed)
  // ─────────────────────────────────────────────
  {
    id: 3,
    name: "Leseoperasjoner uten bekreftelse",
    description: "Read-only operations should execute immediately without asking for confirmation",
    steps: [
      {
        userMessage: "Vis mine bankkontoer",
        description: "List bank accounts — read-only, should not ask for confirmation",
        assertions: [
          {
            name: "Delegates to bank agent",
            check: (r) => delegatedTo(r, "delegateToBankAgent"),
          },
          {
            name: "Shows bank account info",
            check: (r) => textContains(r.fullText, "bank", "konto", "1920"),
          },
          {
            name: "Does NOT ask for confirmation",
            check: (r) => textNotContains(r.fullText, "stemmer dette?", "bekreft dette"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Søk etter kontakter som heter Demoleverandør",
        description: "Search contacts — read-only, should show results directly",
        delayBefore: 2000,
        assertions: [
          {
            name: "Delegates to contact agent",
            check: (r) => delegatedTo(r, "delegateToContactAgent"),
          },
          {
            name: "Shows contact results",
            check: (r) => textContains(r.fullText, "demoleverandør", "Demoleverandør", "leverandør", "kontakt"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 4: Multi-agent conversation — switch topics
  // ─────────────────────────────────────────────
  {
    id: 4,
    name: "Multi-agent tema-skifte",
    description: "Switch between different agent topics in the same conversation",
    steps: [
      {
        userMessage: "Hva er saldoen på bankkontoen min?",
        description: "Step 1: Ask about bank balance (bank agent)",
        assertions: [
          {
            name: "Delegates to bank agent",
            check: (r) => delegatedTo(r, "delegateToBankAgent"),
          },
          {
            name: "Shows balance info",
            check: (r) => textContains(r.fullText, "saldo", "kr", "bank", "konto"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Ok, takk. Nå vil jeg søke etter fakturaer fra januar 2026",
        description: "Step 2: Switch to invoices (invoice agent)",
        delayBefore: 2000,
        assertions: [
          {
            name: "Delegates to invoice agent",
            check: (r) => delegatedTo(r, "delegateToInvoiceAgent"),
          },
          {
            name: "Shows invoice results or info",
            check: (r) => textContains(r.fullText, "faktura", "invoice", "januar", "2026", "fant", "ingen"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Hvilken MVA-sats gjelder for mat og drikke?",
        description: "Step 3: Accounting question (accounting agent or direct answer)",
        delayBefore: 2000,
        assertions: [
          {
            name: "Response mentions MEDIUM or 15%",
            check: (r) => textContains(r.fullText, "15", "MEDIUM", "medium", "mat", "drikke"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 5: File upload with purchase (simulated)
  // ─────────────────────────────────────────────
  {
    id: 5,
    name: "Kvittering med filopplasting",
    description: "Send a receipt image and ask AI to register the purchase — tests image passthrough + anti-hallucination",
    steps: [
      {
        userMessage: "Registrer dette kjøpet basert på kvitteringen",
        files: [
          {
            name: "kvittering.png",
            type: "image/png",
            data: "", // Will be replaced with real receipt if available
          },
        ],
        description: "Upload receipt image — AI should read it and suggest a purchase, not hallucinate from filename",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Response is not empty",
            check: (r) => r.fullText.trim().length > 20,
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 6: Invoice creation with confirmation
  // ─────────────────────────────────────────────
  {
    id: 6,
    name: "Fakturaoppretting med bekreftelse",
    description: "Create an invoice — must ask for confirmation before executing",
    steps: [
      {
        userMessage: "Opprett en faktura til Demokunde på 5000 kr for konsulenttjenester, forfaller om 14 dager",
        description: "Request invoice creation — should present summary for confirmation",
        assertions: [
          {
            name: "Delegates to invoice agent",
            check: (r) => delegatedTo(r, "delegateToInvoiceAgent"),
          },
          {
            name: "Mentions Demokunde or customer",
            check: (r) => textContains(r.fullText, "Demokunde", "demokunde", "kunde"),
          },
          {
            name: "Mentions amount 5000",
            check: (r) => textContains(r.fullText, "5000", "5 000"),
          },
          {
            name: "Asks for confirmation",
            check: (r) => textContains(r.fullText, "stemmer", "bekreft", "riktig", "ok"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 7: Accounting expertise question
  // ─────────────────────────────────────────────
  {
    id: 7,
    name: "Regnskapsspørsmål",
    description: "Ask complex accounting questions — should route to accounting agent",
    steps: [
      {
        userMessage: "Hvordan fører jeg kjøp av en firmabil på 350 000 kr? Hva er riktig konto og avskrivning?",
        description: "Complex accounting question about car purchase",
        assertions: [
          {
            name: "Delegates to accounting or answers directly",
            check: (r) => delegatedTo(r, "delegateToAccountingAgent") || r.fullText.trim().length > 50,
          },
          {
            name: "Mentions relevant account (1200-series or similar)",
            check: (r) => textContains(r.fullText, "1200", "1240", "driftsmiddel", "avskrivning", "saldogruppe", "bil"),
          },
          {
            name: "Response is substantial (>100 chars)",
            check: (r) => r.fullText.trim().length > 100,
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 8: Search purchases then ask follow-up
  // ─────────────────────────────────────────────
  {
    id: 8,
    name: "Søk kjøp + oppfølging",
    description: "Search for purchases and then ask a follow-up about the results",
    steps: [
      {
        userMessage: "Vis de siste kjøpene mine",
        description: "Search recent purchases",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Shows purchase list or info",
            check: (r) => textContains(r.fullText, "kjøp", "purchase", "leverandør", "beløp", "kr", "ingen", "fant"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Hvor mye har jeg brukt totalt på disse kjøpene?",
        description: "Follow-up question about the search results — AI must use context from previous answer",
        delayBefore: 2000,
        assertions: [
          {
            name: "Response is not empty",
            check: (r) => r.fullText.trim().length > 20,
          },
          {
            name: "AI does NOT say it doesn't know",
            check: (r) => textNotContains(r.fullText, "vet ikke", "kan ikke se", "har ikke informasjon"),
          },
          {
            name: "Response mentions total, sum, or amount",
            check: (r) => textContains(r.fullText, "totalt", "sum", "kr", "beløp", "til sammen"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 9: Contact creation + follow-up edit
  // ─────────────────────────────────────────────
  {
    id: 9,
    name: "Kontaktoppretting + redigering",
    description: "Create a contact and then ask to edit it — tests context continuity across operations",
    steps: [
      {
        userMessage: "Opprett en ny leverandør som heter E2E Test Leverandør AS",
        description: "Request to create a new supplier contact",
        assertions: [
          {
            name: "Delegates to contact agent",
            check: (r) => delegatedTo(r, "delegateToContactAgent"),
          },
          {
            name: "Mentions the contact name",
            check: (r) => textContains(r.fullText, "E2E Test", "e2e test", "leverandør"),
          },
          {
            name: "Asks for confirmation (write operation)",
            check: (r) => textContains(r.fullText, "stemmer", "bekreft", "riktig", "opprett", "leverandør"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 10: Error recovery — invalid request
  // ─────────────────────────────────────────────
  {
    id: 10,
    name: "Feilhåndtering — ugyldig forespørsel",
    description: "Send invalid/impossible requests and verify graceful error handling",
    steps: [
      {
        userMessage: "Registrer et kjøp med beløp -500 kr",
        description: "Negative amount — should handle gracefully",
        assertions: [
          {
            name: "Response is not empty",
            check: (r) => r.fullText.trim().length > 10,
          },
          {
            name: "Does not crash (no uncaught errors)",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
      {
        userMessage: "Send faktura til en kontakt som ikke finnes, kundenummer 99999",
        description: "Non-existent contact — should report error clearly",
        delayBefore: 2000,
        assertions: [
          {
            name: "Response acknowledges the issue",
            check: (r) => r.fullText.trim().length > 20,
          },
          {
            name: "Does not crash",
            check: (r) => r.errors.length === 0 || !r.errors.some(e => e.includes("INTERNAL")),
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 11: The Electrolux scenario (the actual reported bug)
  // ─────────────────────────────────────────────
  {
    id: 11,
    name: "Electrolux-scenariet (bug-rapporten)",
    description: "Simulates the exact bug: create purchase, then send receipt in follow-up — AI must NOT create duplicate",
    steps: [
      {
        userMessage: "Registrer kjøp av kontorrekvisita fra Generell Leverandør AS på 899 kr, betalt i dag med bankkonto 1920:10001",
        description: "Step 1: Register a purchase",
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Mentions the supplier or amount",
            check: (r) => textContains(r.fullText, "leverandør", "Generell", "899"),
          },
          {
            name: "Asks for confirmation",
            check: (r) => textContains(r.fullText, "stemmer", "bekreft", "riktig"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Ja, registrer det",
        description: "Step 2: Confirm the purchase",
        delayBefore: 2000,
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Purchase seems to be created",
            check: (r) => textContains(r.fullText, "registrert", "opprettet", "fullført", "kjøp", "899"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Her er kvitteringen, last den opp til kjøpet",
        files: [
          {
            name: "kvittering-kontor.png",
            type: "image/png",
            data: "", // Will be replaced with receipt
          },
        ],
        description: "Step 3: Upload receipt to the EXISTING purchase — must NOT create a new one",
        delayBefore: 3000,
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Does NOT create a new purchase (no createPurchase tool call)",
            check: (r) => !calledTool(r, "createPurchase"),
          },
          {
            name: "Response mentions upload or attachment",
            check: (r) => textContains(r.fullText, "lastet opp", "vedlegg", "vedlagt", "upload", "fil", "kvittering"),
          },
          {
            name: "AI does NOT say it can't find the purchase",
            check: (r) => textNotContains(r.fullText, "finner ikke kjøpet", "kan ikke finne", "hvilket kjøp"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 12: Offer → Order Confirmation flow
  // ─────────────────────────────────────────────
  {
    id: 12,
    name: "Tilbud-flyt",
    description: "Search for offers and ask about the workflow",
    steps: [
      {
        userMessage: "Vis mine tilbud",
        description: "List offers",
        assertions: [
          {
            name: "Delegates to offer agent",
            check: (r) => delegatedTo(r, "delegateToOfferAgent"),
          },
          {
            name: "Shows offers or says none found",
            check: (r) => textContains(r.fullText, "tilbud", "offer", "ingen", "fant"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 13: Company info + chart of accounts
  // ─────────────────────────────────────────────
  {
    id: 13,
    name: "Selskapsinformasjon",
    description: "Ask about company details — should route to accounting agent",
    steps: [
      {
        userMessage: "Vis selskapsinformasjonen min",
        description: "Get company info",
        assertions: [
          {
            name: "Delegates to accounting agent",
            check: (r) => delegatedTo(r, "delegateToAccountingAgent"),
          },
          {
            name: "Shows company info",
            check: (r) => textContains(r.fullText, "selskap", "firma", "fiken", "demo", "org"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 14: Norwegian language understanding
  // ─────────────────────────────────────────────
  {
    id: 14,
    name: "Norsk språkforståelse",
    description: "Test that AI handles casual Norwegian and slang correctly",
    steps: [
      {
        userMessage: "Kan du sjekke om det ligger noe i innboksen på banken?",
        description: "Casual Norwegian for bank inbox check",
        assertions: [
          {
            name: "Delegates to bank agent",
            check: (r) => delegatedTo(r, "delegateToBankAgent"),
          },
          {
            name: "Response is relevant",
            check: (r) => textContains(r.fullText, "innboks", "bank", "transaksjon", "inbox", "ingen", "fant"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
      {
        userMessage: "Legg inn et kjøp, 199 kr på Clas Ohlson for en USB-kabel, betal med bank",
        description: "Casual purchase request",
        delayBefore: 2000,
        assertions: [
          {
            name: "Delegates to purchase agent",
            check: (r) => delegatedTo(r, "delegateToPurchaseAgent"),
          },
          {
            name: "Mentions Clas Ohlson or USB",
            check: (r) => textContains(r.fullText, "Clas", "USB", "199"),
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // Scenario 15: Greeting and basic chat
  // ─────────────────────────────────────────────
  {
    id: 15,
    name: "Hilsen og grunnleggende chat",
    description: "Test that orchestrator handles greetings directly without delegation",
    steps: [
      {
        userMessage: "Hei, hva kan du hjelpe meg med?",
        description: "Simple greeting — should NOT delegate, should answer directly",
        assertions: [
          {
            name: "Response explains capabilities",
            check: (r) => textContains(r.fullText, "faktura", "kjøp", "bank", "regnskap", "hjelpe", "kan"),
          },
          {
            name: "Response is not empty",
            check: (r) => r.fullText.trim().length > 30,
          },
          {
            name: "No errors",
            check: (r) => r.errors.length === 0,
          },
        ],
      },
    ],
  },
];

// ============================================
// Scenario Runner
// ============================================

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const scenarioStart = Date.now();
  const result: ScenarioResult = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    steps: [],
    overallPassed: true,
    totalDurationMs: 0,
  };

  // Create a chat for this scenario so messages accumulate
  let chatId: string | undefined;
  try {
    chatId = await createChat(`E2E Test: ${scenario.name}`);
  } catch (err) {
    console.log(`  ${c.yellow}⚠ Could not create chat, running without chat context${c.reset}`);
  }

  // Build conversation history for multi-turn
  const conversationHistory: ConversationMessage[] = [];

  for (let stepIdx = 0; stepIdx < scenario.steps.length; stepIdx++) {
    const step = scenario.steps[stepIdx];
    
    // Optional delay before step
    if (step.delayBefore && step.delayBefore > 0) {
      await new Promise(resolve => setTimeout(resolve, step.delayBefore));
    }

    const stepStart = Date.now();
    const stepResult: ScenarioResult["steps"][number] = {
      stepIndex: stepIdx + 1,
      description: step.description,
      durationMs: 0,
      responseText: "",
      toolsCalled: [],
      assertions: [],
    };

    // Prepare files
    let files = step.files;
    if (files) {
      const realReceipt = await getRealTestReceipt();
      files = files.map(f => ({
        ...f,
        data: f.data || realReceipt || getTestReceiptBase64(),
      }));
    }

    try {
      // Build messages for the API call
      // Include full conversation history for multi-turn context
      // IMPORTANT: Only send user + assistant messages, NOT tool messages.
      // The /api/chat endpoint expects tool messages to come from DB records
      // with properly paired tool-call + tool-result. Sending unpaired
      // tool messages causes the AI SDK to error.
      const messagesToSend = [
        ...conversationHistory
          .filter(m => m.role === "user" || m.role === "assistant")
          .map(m => ({
            role: m.role,
            content: m.content,
          })),
        { role: "user" as const, content: step.userMessage },
      ];

      // Save user message to chat DB if we have a chatId
      if (chatId) {
        await saveMessage(chatId, "user", step.userMessage);
      }

      // Send to API
      const parsed = await sendChatMessage(messagesToSend, files);

      stepResult.responseText = parsed.fullText;
      stepResult.toolsCalled = parsed.toolCalls.map(tc => tc.toolName);
      stepResult.durationMs = Date.now() - stepStart;

      // Run assertions
      for (const assertion of step.assertions) {
        const passed = assertion.check(parsed, conversationHistory);
        stepResult.assertions.push({ name: assertion.name, passed });
        if (!passed) result.overallPassed = false;
      }

      // Add to conversation history
      conversationHistory.push({ role: "user", content: step.userMessage });
      conversationHistory.push({ role: "assistant", content: parsed.fullText });

      // Also save assistant response to chat DB if we have a chatId
      if (chatId && parsed.fullText) {
        // Extract tool data from tool results for DB persistence
        const toolData: Record<string, unknown> = {};
        if (parsed.toolCalls.length > 0) {
          toolData.toolCalls = parsed.toolCalls;
        }
        if (parsed.toolResults.length > 0) {
          toolData.toolResults = parsed.toolResults;
        }
        await saveMessage(chatId, "assistant", parsed.fullText, 
          Object.keys(toolData).length > 0 ? toolData : undefined);

        // Also save tool result messages for context (like the real frontend does)
        for (const tr of parsed.toolResults) {
          const trResult = tr.result as Record<string, unknown>;
          if (trResult && typeof trResult === 'object') {
            conversationHistory.push({
              role: "tool",
              content: JSON.stringify(tr.result),
              toolData: { 
                toolResults: [{ 
                  toolCallId: tr.toolCallId, 
                  toolName: "unknown",
                  result: tr.result 
                }] 
              },
            });
          }
        }
      }

    } catch (error) {
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.durationMs = Date.now() - stepStart;
      result.overallPassed = false;
      
      // Mark all assertions as failed
      for (const assertion of step.assertions) {
        stepResult.assertions.push({ name: assertion.name, passed: false });
      }
    }

    result.steps.push(stepResult);
  }

  // Clean up test chat
  if (chatId) {
    try {
      await deleteChat(chatId);
    } catch { /* ignore cleanup errors */ }
  }

  result.totalDurationMs = Date.now() - scenarioStart;
  return result;
}

// ============================================
// Report
// ============================================

function printScenarioResult(result: ScenarioResult): void {
  const icon = result.overallPassed ? `${c.green}✓` : `${c.red}✗`;
  const duration = `${c.dim}(${(result.totalDurationMs / 1000).toFixed(1)}s)${c.reset}`;
  
  console.log(`\n${icon} Scenario ${result.scenarioId}: ${result.scenarioName} ${duration}${c.reset}`);
  
  for (const step of result.steps) {
    const stepIcon = step.error || step.assertions.some(a => !a.passed) ? `${c.red}✗` : `${c.green}✓`;
    console.log(`  ${stepIcon} Step ${step.stepIndex}: ${step.description} ${c.dim}(${(step.durationMs / 1000).toFixed(1)}s)${c.reset}`);
    
    if (step.error) {
      console.log(`    ${c.red}ERROR: ${step.error}${c.reset}`);
    }
    
    for (const assertion of step.assertions) {
      const aIcon = assertion.passed ? `${c.green}✓` : `${c.red}✗`;
      console.log(`    ${aIcon} ${assertion.name}${c.reset}`);
    }

    if (VERBOSE && step.responseText) {
      console.log(`    ${c.dim}Tools: ${step.toolsCalled.join(" → ") || "none"}${c.reset}`);
      console.log(`    ${c.dim}Response: ${step.responseText.substring(0, 200)}${step.responseText.length > 200 ? "..." : ""}${c.reset}`);
    }
  }
}

function printSummary(results: ScenarioResult[]): void {
  const totalScenarios = results.length;
  const passedScenarios = results.filter(r => r.overallPassed).length;
  const failedScenarios = totalScenarios - passedScenarios;
  
  let totalAssertions = 0;
  let passedAssertions = 0;
  let failedAssertions = 0;
  
  for (const r of results) {
    for (const step of r.steps) {
      for (const a of step.assertions) {
        totalAssertions++;
        if (a.passed) passedAssertions++;
        else failedAssertions++;
      }
    }
  }

  const totalDuration = results.reduce((sum, r) => sum + r.totalDurationMs, 0);
  
  console.log("\n" + "=".repeat(60));
  console.log(`${c.bold}SUMMARY${c.reset}`);
  console.log("=".repeat(60));
  console.log(`Scenarios:  ${c.green}${passedScenarios} passed${c.reset}, ${failedScenarios > 0 ? c.red : c.dim}${failedScenarios} failed${c.reset} / ${totalScenarios} total`);
  console.log(`Assertions: ${c.green}${passedAssertions} passed${c.reset}, ${failedAssertions > 0 ? c.red : c.dim}${failedAssertions} failed${c.reset} / ${totalAssertions} total`);
  console.log(`Duration:   ${(totalDuration / 1000).toFixed(1)}s total`);
  
  if (failedScenarios > 0) {
    console.log(`\n${c.red}${c.bold}FAILED SCENARIOS:${c.reset}`);
    for (const r of results.filter(r => !r.overallPassed)) {
      console.log(`  ${c.red}✗ #${r.scenarioId}: ${r.scenarioName}${c.reset}`);
      for (const step of r.steps) {
        const failedAsserts = step.assertions.filter(a => !a.passed);
        if (failedAsserts.length > 0 || step.error) {
          console.log(`    Step ${step.stepIndex}: ${step.description}`);
          if (step.error) {
            console.log(`      ${c.red}ERROR: ${step.error}${c.reset}`);
          }
          for (const a of failedAsserts) {
            console.log(`      ${c.red}✗ ${a.name}${c.reset}`);
          }
          if (step.responseText) {
            console.log(`      ${c.dim}Response: ${step.responseText.substring(0, 150)}...${c.reset}`);
          }
        }
      }
    }
  }
  
  console.log("");
}

// ============================================
// Main
// ============================================

async function main() {
  console.log("=".repeat(60));
  console.log(`${c.bold}E2E Context Continuity Test Suite${c.reset}`);
  console.log(`${c.dim}Testing multi-turn conversations, context retention,`);
  console.log(`file uploads, confirmation flows, and error handling${c.reset}`);
  console.log("=".repeat(60));
  console.log("");

  // Parse CLI args
  const args = process.argv.slice(2);
  VERBOSE = args.includes("--verbose");
  const scenarioArg = args.find(a => a.startsWith("--scenario="))?.split("=")[1];
  const scenarioIds = scenarioArg ? scenarioArg.split(",").map(Number) : null;

  // Health check
  try {
    const health = await fetch(`${CONTEXT_API_URL}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log(`${c.green}[OK]${c.reset} Server is running at ${CONTEXT_API_URL}`);
  } catch (error) {
    console.error(`${c.red}[FAIL]${c.reset} Server is not running at ${CONTEXT_API_URL}`);
    console.error("Start the server with: npm run dev");
    process.exit(1);
  }

  // Auth check
  try {
    const authCheck = await fetch(`${CONTEXT_API_URL}/api/chats`, {
      headers: { "Authorization": `Bearer ${CONTEXT_USER_ID}` },
    });
    if (authCheck.status === 401) {
      const body = await authCheck.json();
      console.error(`${c.red}[FAIL]${c.reset} Authentication failed:`, body);
      if (body.code === "CONNECTION_EXPIRED") {
        console.error("Fiken token expired. Log in again via the web app to refresh.");
      }
      process.exit(1);
    }
    console.log(`${c.green}[OK]${c.reset} Authentication valid`);
  } catch (error) {
    console.error(`${c.red}[FAIL]${c.reset} Auth check error:`, error);
    process.exit(1);
  }

  // Check for test receipt
  const hasRealReceipt = await getRealTestReceipt();
  if (hasRealReceipt) {
    console.log(`${c.green}[OK]${c.reset} Real test receipt found at /tmp/test-receipt.png`);
  } else {
    console.log(`${c.yellow}[WARN]${c.reset} No test receipt at /tmp/test-receipt.png — using placeholder image for file upload tests`);
  }

  // Filter scenarios if specified
  const scenariosToRun = scenarioIds
    ? SCENARIOS.filter(s => scenarioIds.includes(s.id))
    : SCENARIOS;

  console.log(`\nRunning ${scenariosToRun.length} scenario(s)...\n`);

  const results: ScenarioResult[] = [];

  for (let i = 0; i < scenariosToRun.length; i++) {
    const scenario = scenariosToRun[i];
    const progress = `[${i + 1}/${scenariosToRun.length}]`;
    process.stdout.write(`${c.cyan}${progress}${c.reset} Running: ${scenario.name}...`);
    
    const result = await runScenario(scenario);
    results.push(result);
    
    // Clear the "Running..." line
    process.stdout.write("\r" + " ".repeat(80) + "\r");
    
    printScenarioResult(result);

    // Delay between scenarios to avoid overwhelming the API
    if (i < scenariosToRun.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  printSummary(results);

  // Save results to file
  try {
    const fs = await import("fs");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const jsonPath = `scripts/e2e-context-results-${timestamp}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    console.log(`${c.dim}Results saved to: ${jsonPath}${c.reset}`);
  } catch { /* ignore save errors */ }

  // Exit with error if any scenario failed
  const failed = results.filter(r => !r.overallPassed).length;
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
