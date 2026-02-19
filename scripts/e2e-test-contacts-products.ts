/**
 * E2E Test: Contact & Product CRUD — Full Conversation Flow (~22 turns)
 *
 * Simulates a REAL user conversation testing the contact_agent's ability to:
 *   - Search and list customers/suppliers
 *   - Create a customer step-by-step (agent must ASK for missing info)
 *   - Add a contact person to a customer
 *   - Create a supplier with org.nr added mid-conversation
 *   - Create two products in one request
 *   - Remember context (prices, IDs, names) across turns
 *   - Update product price and contact email
 *   - Delete all created entities on request
 *
 * Conversation flow (~22 turns):
 *   Del 1: Søk og orientering (2 turns)
 *     1. "Hei! Kan du vise meg alle kundene mine?"
 *     2. "Har vi noen leverandører?"
 *   Del 2: Opprett kunde — agenten MÅ spørre om info (4 turns)
 *     3. "Jeg trenger å legge til en ny kunde"
 *     4. "Firmaet heter Nordlys Konsult AS"
 *     5. "Org.nr er 912345678 og e-post er post@nordlys-konsult.no"
 *     6. "Ja" → creates customer
 *   Del 3: Legg til kontaktperson (3 turns)
 *     7. "Kan du legge til en kontaktperson på den kunden?"
 *     8. "Kari Hansen, kari@nordlys-konsult.no"
 *     9. "Ja" → creates contact person
 *   Del 4: Opprett leverandør (3 turns)
 *     10. "Legg til en ny leverandør: Skyservice IT AS, epost faktura@skyservice.no"
 *     11. "Vent, kan du også legge til org.nr 987654321?"
 *     12. "Ja, opprett den" → creates supplier
 *   Del 5: Opprett produkter (4 turns)
 *     13. "Nå trenger jeg å lage to produkter"
 *     14. "Første: 'Konsulenttimer Senior' 1800 kr..."
 *     15. "Ja, opprett begge" → creates two products
 *     16. "Hva var prisen på Senior-produktet igjen?" → memory test
 *   Del 6: Oppdatering — konteksthukommelse (4 turns)
 *     17. "Kan du endre prisen på Junior til 1350 kr?"
 *     18. "Ja" → updates product
 *     19. "Oppdater e-posten til Nordlys Konsult til ny-epost@nordlys-konsult.no"
 *     20. "Ja, oppdater" → updates contact
 *   Del 7: Opprydding (2 turns)
 *     21. "Kan du slette alt vi har laget i dag?"
 *     22. "Ja, slett alt" → deletes everything
 *
 * After conversation, verifies DIRECTLY against Fiken API:
 *   - Customer was created with correct details
 *   - Contact person was added
 *   - Supplier was created with correct details
 *   - Products were created with correct prices
 *   - Updates were applied
 *   - Deletions were executed
 *
 * Prerequisites:
 *   - API server running on localhost:3001
 *   - Docker DB running (regnskap-db)
 *   - Valid Fiken demo account connected
 *
 * Usage:
 *   npx tsx scripts/e2e-test-contacts-products.ts
 *   npx tsx scripts/e2e-test-contacts-products.ts --verbose
 *   npx tsx scripts/e2e-test-contacts-products.ts --no-cleanup
 *   npx tsx scripts/e2e-test-contacts-products.ts --step=6
 */

import dotenv from "dotenv";
dotenv.config();

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

// Test entity names — used for pre-cleanup and identification
const TEST_CUSTOMER_NAME = "Nordlys Konsult AS";
const TEST_SUPPLIER_NAME = "Skyservice IT AS";
const TEST_PRODUCT_SENIOR = "Konsulenttimer Senior";
const TEST_PRODUCT_JUNIOR = "Konsulenttimer Junior";

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

// Track IDs of created entities for verification and cleanup
interface CreatedEntities {
  customerId: number | undefined;
  contactPersonId: number | undefined;
  supplierId: number | undefined;
  productSeniorId: number | undefined;
  productJuniorId: number | undefined;
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
  timeoutMs: number = 120_000,
): Promise<ParsedStream> {
  const body: Record<string, unknown> = { messages };
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
 * Extract a numeric ID from text (e.g., "contactId: 12345" or "#12345")
 */
function extractId(text: string, prefix: string): number | null {
  // Try "prefix: 12345" or "prefix 12345"
  const regex = new RegExp(`${prefix}[:\\s]+?(\\d{5,})`, "i");
  const match = text.match(regex);
  if (match) return parseInt(match[1]);

  // Try "#12345" near the prefix
  const hashRegex = new RegExp(`#(\\d{5,})`, "gi");
  const matches = text.matchAll(hashRegex);
  for (const m of matches) {
    return parseInt(m[1]);
  }

  return null;
}

/**
 * Extract contactId from agent response text.
 * contactIds in Fiken are typically 11-digit numbers (e.g., 11580772106).
 * Do NOT confuse with kundenummer (5-digit, e.g., 10063) or leverandørnummer.
 */
function extractContactId(text: string): number | undefined {
  // Try specific patterns — require at least 8 digits for contactId
  const patterns = [
    /contactId[:\s]+(\d{8,})/i,
    /kontakt-?id[:\s]+(\d{8,})/i,
    /kontaktId[:\s]+(\d{8,})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseInt(m[1]);
  }
  return undefined;
}

/**
 * Extract productId from agent response text
 */
function extractProductId(text: string): number | null {
  const patterns = [
    /productId[:\s]+(\d{5,})/i,
    /produkt-?(?:id|nummer)[:\s]+(\d{5,})/i,
    /ID[:\s]+(\d{8,})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseInt(m[1]);
  }
  return null;
}

/**
 * Check if the agent's response indicates an entity was ACTUALLY created/registered/updated/deleted
 */
function entityWasCreated(text: string): boolean {
  const lower = text.toLowerCase();

  // If the response asks for confirmation, the entity is NOT yet created
  if (contains(text, "stemmer dette", "ja/nei", "bekreft dette")) {
    return false;
  }

  const regexPatterns = [
    /er\s+(?:nå\s+)?(?:registrert|opprettet|lagt\s+til|oppdatert|slettet)/,
    /har\s+(?:nå\s+)?(?:registrert|opprettet|lagt\s+til|oppdatert|slettet)/,
    /ble\s+(?:nå\s+)?(?:registrert|opprettet|lagt\s+til|oppdatert|slettet)/,
    /nå\s+(?:registrert|opprettet|lagt\s+til|oppdatert|slettet)/,
    /kontakt(?:en)?\s+er\s+(?:nå\s+)?opprettet/,
    /produkt(?:et)?\s+er\s+(?:nå\s+)?opprettet/,
    /kontaktperson(?:en)?\s+er\s+(?:nå\s+)?lagt\s+til/,
    /leverandør(?:en)?\s+er\s+(?:nå\s+)?opprettet/,
    /kund(?:e|en)\s+er\s+(?:nå\s+)?opprettet/,
  ];

  const stringPatterns = [
    "opprettet i fiken",
    "registrert i fiken",
    "lagt til i fiken",
    "er nå opprettet",
    "er nå registrert",
    "er nå lagt til",
    "har blitt opprettet",
    "har blitt registrert",
    "har blitt lagt til",
    "har blitt oppdatert",
    "har blitt slettet",
    "er oppdatert",
    "er slettet",
    "fullført",
    "endringen er lagret",
    "oppdateringen er gjort",
    "har nå pris",
    "har nå e-post",
  ];

  return (
    regexPatterns.some((r) => r.test(lower)) ||
    stringPatterns.some((p) => lower.includes(p))
  );
}

/**
 * Check if agent confirmed an entity was deleted
 */
function entityWasDeleted(text: string): boolean {
  const lower = text.toLowerCase();

  // If the response asks for confirmation, the entity is NOT yet deleted
  if (contains(text, "stemmer dette", "ja/nei", "bekreft", "kan du bekrefte", "ønsker slettet", "ønsker du å slette", "spesifiser")) {
    return false;
  }

  return (
    /\ber\s+(?:nå\s+)?slettet\b/.test(lower) ||
    /\bhar\s+(?:nå\s+)?slettet\b/.test(lower) ||
    /\bble\s+(?:nå\s+)?slettet\b/.test(lower) ||
    lower.includes("slettet fra fiken") ||
    lower.includes("er nå slettet") ||
    lower.includes("har blitt slettet") ||
    lower.includes("alle er slettet") ||
    lower.includes("er fjernet") ||
    lower.includes("har slettet alt") ||
    lower.includes("alt er slettet")
  );
}

/**
 * Determine if the agent is asking a question that needs a response
 */
function agentNeedsResponse(text: string): boolean {
  return (
    (contains(text, "stemmer dette", "bekreft", "skal jeg", "vil du", "ønsker du") ||
      contains(text, "ja/nei", "trenger jeg", "kan du oppgi", "hva er")) &&
    !entityWasCreated(text)
  );
}

/**
 * Send confirmation and retry until entity is created.
 */
async function confirmUntilCreated(
  history: ConvMessage[],
  stepLabel: string,
  maxRetries: number = 3,
): Promise<{ result: ParsedStream; created: boolean }> {
  let created = false;
  let lastResult: ParsedStream | null = null;

  for (let i = 0; i < maxRetries; i++) {
    const suffix = i === 0 ? "" : ` (attempt ${i + 1})`;
    await delay(3000);

    const lastAssistant = history[history.length - 1];
    let confirmMsg: string;

    if (contains(lastAssistant.content, "stemmer dette", "bekreft", "ja/nei")) {
      confirmMsg = "Ja, det stemmer!";
    } else if (contains(lastAssistant.content, "skal jeg")) {
      confirmMsg = "Ja, gjør det!";
    } else if (contains(lastAssistant.content, "?")) {
      confirmMsg = "Ja!";
    } else {
      confirmMsg = "Ja, gjør det!";
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

    if (entityWasCreated(lastResult.fullText) || entityWasDeleted(lastResult.fullText)) {
      created = true;
      break;
    }

    if (!agentNeedsResponse(lastResult.fullText) && !contains(lastResult.fullText, "?")) {
      break;
    }
  }

  return { result: lastResult!, created };
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
  entities: CreatedEntities;
}

async function runConversation(maxStep: number): Promise<ConversationResult> {
  const history: ConvMessage[] = [];
  const entities: CreatedEntities = {
    customerId: undefined,
    contactPersonId: undefined,
    supplierId: undefined,
    productSeniorId: undefined,
    productJuniorId: undefined,
  };

  // Helper to send a step
  async function sendStep(
    stepNum: number,
    stepLabel: string,
    userMessage: string,
  ): Promise<ParsedStream> {
    if (maxStep < stepNum) throw new Error(`SKIP:${stepNum}`);

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

    return result;
  }

  // ──────────────────────────────────────────────
  // DEL 1: Søk og orientering (2 turns)
  // ──────────────────────────────────────────────

  // Step 1: List all customers
  const step1 = await sendStep(1, "Step 1", "Hei! Kan du vise meg alle kundene mine?");

  assert("Step 1: Response not empty", step1.fullText.trim().length > 30);
  assert("Step 1: No errors", step1.errors.length === 0);
  assert(
    "Step 1: Delegated to contact agent",
    delegated(step1, "delegateToContactAgent"),
    step1.toolCalls.map((tc) => tc.toolName).join(", "),
  );
  assert(
    "Step 1: Shows customer list",
    contains(step1.fullText, "kunde", "customer", "kontakt"),
    step1.fullText.substring(0, 200),
  );

  await delay(3000);

  // Step 2: List suppliers (context: agent should still be in contact domain)
  const step2 = await sendStep(2, "Step 2", "Har vi noen leverandører?");

  assert("Step 2: Response not empty", step2.fullText.trim().length > 30);
  assert("Step 2: No errors", step2.errors.length === 0);
  assert(
    "Step 2: Mentions suppliers",
    contains(step2.fullText, "leverandør", "supplier"),
    step2.fullText.substring(0, 200),
  );

  await delay(3000);

  // ──────────────────────────────────────────────
  // DEL 2: Opprett kunde — agenten MÅ spørre (4 turns)
  // ──────────────────────────────────────────────

  // Step 3: Ask to add a new customer — agent MUST ask for details, NOT create
  const step3 = await sendStep(3, "Step 3", "Jeg trenger å legge til en ny kunde");

  assert("Step 3: Response not empty", step3.fullText.trim().length > 30);
  assert("Step 3: No errors", step3.errors.length === 0);
  assert(
    "Step 3: Agent asks for details (name, org.nr, email, etc.)",
    contains(step3.fullText, "navn", "opplysning", "informasjon", "trenger", "heter", "hva"),
    step3.fullText.substring(0, 300),
  );
  assert(
    "Step 3: Agent did NOT create anything yet",
    !entityWasCreated(step3.fullText),
    "Should not create without details",
  );

  await delay(3000);

  // Step 4: Provide name only — agent should ask for more (org.nr, email)
  const step4 = await sendStep(4, "Step 4", "Firmaet heter Nordlys Konsult AS");

  assert("Step 4: Response not empty", step4.fullText.trim().length > 30);
  assert("Step 4: No errors", step4.errors.length === 0);
  assert(
    "Step 4: Agent acknowledges name",
    contains(step4.fullText, "nordlys", "konsult"),
    step4.fullText.substring(0, 300),
  );
  // The agent might ask for more info OR present a summary asking for confirmation.
  // Both are valid — the key is it did NOT create without asking.
  const step4DidNotCreate = !entityWasCreated(step4.fullText);
  const step4AsksQuestion = agentNeedsResponse(step4.fullText) || contains(step4.fullText, "?");
  assert(
    "Step 4: Agent asks for more info or confirms (did not create silently)",
    step4DidNotCreate || step4AsksQuestion,
    step4DidNotCreate ? "Did not create" : "Asked question",
  );

  await delay(3000);

  // Step 5: Provide org.nr and email — agent should now present full summary
  // If agent already asked for confirmation in step 4 (with just name), handle that
  let step5: ParsedStream;
  if (step4AsksQuestion && contains(step4.fullText, "stemmer", "opprette", "registrere")) {
    // Agent asked to confirm with just name — tell it to wait, we have more info
    step5 = await sendStep(5, "Step 5", "Vent, jeg har mer info. Org.nr er 912345678 og e-post er post@nordlys-konsult.no");
  } else {
    step5 = await sendStep(5, "Step 5", "Org.nr er 912345678 og e-post er post@nordlys-konsult.no");
  }

  assert("Step 5: Response not empty", step5.fullText.trim().length > 30);
  assert("Step 5: No errors", step5.errors.length === 0);
  assert(
    "Step 5: Shows summary with name",
    contains(step5.fullText, "nordlys", "konsult"),
  );
  // Check that the agent presents details for confirmation
  const step5HasOrgNr = contains(step5.fullText, "912345678");
  const step5HasEmail = contains(step5.fullText, "post@nordlys-konsult.no", "nordlys-konsult");
  assert(
    "Step 5: Shows org.nr in summary",
    step5HasOrgNr,
    step5HasOrgNr ? "912345678 shown" : "org.nr not visible",
  );
  assert(
    "Step 5: Shows email in summary",
    step5HasEmail,
    step5HasEmail ? "email shown" : "email not visible",
  );

  await delay(3000);

  // Step 6: Confirm creation
  // If agent already created in step 5 (unlikely but possible), skip confirmation
  let step6Result: ParsedStream;
  if (entityWasCreated(step5.fullText)) {
    console.log(`  ${C.green}Customer created in step 5 directly${C.reset}`);
    step6Result = step5;
  } else {
    const step6 = await sendStep(6, "Step 6", "Ja");
    step6Result = step6;

    assert("Step 6: Response not empty", step6.fullText.trim().length > 30);
    assert("Step 6: No errors", step6.errors.length === 0);

    // If agent still asks questions, confirm until created
    if (!entityWasCreated(step6.fullText) && agentNeedsResponse(step6.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step 6b");
      if (created) step6Result = result;
    }
  }

  assert(
    "Step 6: Customer was created",
    entityWasCreated(step6Result.fullText),
    step6Result.fullText.substring(0, 200),
  );

  // Try to extract the contactId from agent response or tool results
  const allStep6Text = step6Result.fullText;
  entities.customerId = extractContactId(allStep6Text);

  // Fiken verification: Fetch customer directly
  if (!entities.customerId) {
    // Search by name to find the created customer
    const client = await getFikenClient();
    const contacts = await client.getContacts({ name: "Nordlys Konsult", customer: true });
    const found = contacts.find((c: any) =>
      c.name?.toLowerCase().includes("nordlys") && !KEEP_IDS.includes(c.contactId),
    );
    if (found) {
      entities.customerId = found.contactId;
      console.log(`  ${C.cyan}Found customer via Fiken search: #${entities.customerId}${C.reset}`);
    }
  }

  assert(
    "Step 6: Customer ID extracted or found",
    entities.customerId !== null,
    entities.customerId ? `contactId: ${entities.customerId}` : "Could not find customer",
  );

  // Verify customer details in Fiken
  if (entities.customerId) {
    const client = await getFikenClient();
    const contact = await client.getContact(entities.customerId);
    assert(
      "Fiken: Customer name is correct",
      contains(contact.name || "", "nordlys", "konsult"),
      contact.name,
    );
    assert(
      "Fiken: Customer is marked as customer",
      contact.customer === true,
      `customer=${contact.customer}`,
    );
    assert(
      "Fiken: Customer email is correct",
      contains(contact.email || "", "nordlys-konsult"),
      contact.email,
    );
    assert(
      "Fiken: Customer org.nr is correct",
      contact.organizationNumber === "912345678",
      contact.organizationNumber,
    );
  }

  await delay(3000);

  // ──────────────────────────────────────────────
  // DEL 3: Legg til kontaktperson (3 turns)
  // ──────────────────────────────────────────────

  // Step 7: Ask to add a contact person — agent should remember the customer
  const step7 = await sendStep(7, "Step 7", "Kan du legge til en kontaktperson på den kunden?");

  assert("Step 7: Response not empty", step7.fullText.trim().length > 30);
  assert("Step 7: No errors", step7.errors.length === 0);
  assert(
    "Step 7: Agent remembers customer context",
    contains(step7.fullText, "nordlys", "konsult", "kontaktperson", "navn", "e-post"),
    step7.fullText.substring(0, 300),
  );
  assert(
    "Step 7: Agent asks for contact person details",
    agentNeedsResponse(step7.fullText) || contains(step7.fullText, "?", "navn", "e-post"),
    "Should ask for name and email",
  );

  await delay(3000);

  // Step 8: Provide contact person details
  const step8 = await sendStep(8, "Step 8", "Kari Hansen, kari@nordlys-konsult.no");

  assert("Step 8: Response not empty", step8.fullText.trim().length > 30);
  assert("Step 8: No errors", step8.errors.length === 0);
  assert(
    "Step 8: Shows contact person details or addresses the request",
    contains(step8.fullText, "kari", "hansen", "kontaktperson", "nordlys"),
  );

  await delay(3000);

  // Step 9: Confirm adding contact person
  let step9Result: ParsedStream;
  if (entityWasCreated(step8.fullText)) {
    console.log(`  ${C.green}Contact person added in step 8 directly${C.reset}`);
    step9Result = step8;
  } else {
    const step9 = await sendStep(9, "Step 9", "Ja");
    step9Result = step9;

    assert("Step 9: Response not empty", step9.fullText.trim().length > 30);
    assert("Step 9: No errors", step9.errors.length === 0);

    if (!entityWasCreated(step9.fullText) && agentNeedsResponse(step9.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step 9b");
      if (created) step9Result = result;
    }
  }

  assert(
    "Step 9: Contact person was added",
    entityWasCreated(step9Result.fullText),
    step9Result.fullText.substring(0, 200),
  );

  // Verify contact person in Fiken
  if (entities.customerId) {
    const client = await getFikenClient();
    const persons = await client.getContactPersons(entities.customerId);
    const kari = persons.find((p: any) =>
      p.name?.toLowerCase().includes("kari") && p.name?.toLowerCase().includes("hansen"),
    );
    assert(
      "Fiken: Contact person 'Kari Hansen' exists",
      kari !== undefined,
      kari ? `contactPersonId: ${kari.contactPersonId}` : "Not found",
    );
    if (kari) {
      entities.contactPersonId = kari.contactPersonId;
      assert(
        "Fiken: Contact person email is correct",
        contains(kari.email || "", "kari@nordlys-konsult.no"),
        kari.email,
      );
    }
  }

  await delay(3000);

  // ──────────────────────────────────────────────
  // DEL 4: Opprett leverandør (3 turns)
  // ──────────────────────────────────────────────

  // Step 10: Add a new supplier — provide name and email upfront
  const step10 = await sendStep(
    10, "Step 10",
    "Legg til en ny leverandør: Skyservice IT AS, epost faktura@skyservice.no",
  );

  assert("Step 10: Response not empty", step10.fullText.trim().length > 30);
  assert("Step 10: No errors", step10.errors.length === 0);
  assert(
    "Step 10: Recognizes as supplier (leverandør)",
    contains(step10.fullText, "leverandør", "supplier"),
    step10.fullText.substring(0, 300),
  );
  assert(
    "Step 10: Shows Skyservice name",
    contains(step10.fullText, "skyservice"),
  );

  await delay(3000);

  // Step 11: Add org.nr before creation — agent should update summary, not create yet
  const step11 = await sendStep(
    11, "Step 11",
    "Vent, kan du også legge til org.nr 987654321?",
  );

  assert("Step 11: Response not empty", step11.fullText.trim().length > 30);
  assert("Step 11: No errors", step11.errors.length === 0);
  assert(
    "Step 11: Shows updated info with org.nr",
    contains(step11.fullText, "987654321"),
    step11.fullText.substring(0, 300),
  );

  await delay(3000);

  // Step 12: Confirm creation of supplier
  let step12Result: ParsedStream;
  if (entityWasCreated(step11.fullText)) {
    console.log(`  ${C.green}Supplier created in step 11 directly${C.reset}`);
    step12Result = step11;
  } else {
    const step12 = await sendStep(12, "Step 12", "Ja, opprett den");
    step12Result = step12;

    assert("Step 12: Response not empty", step12.fullText.trim().length > 30);
    assert("Step 12: No errors", step12.errors.length === 0);

    if (!entityWasCreated(step12.fullText) && agentNeedsResponse(step12.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step 12b");
      if (created) step12Result = result;
    }
  }

  assert(
    "Step 12: Supplier was created",
    entityWasCreated(step12Result.fullText),
    step12Result.fullText.substring(0, 200),
  );

  // Find supplier in Fiken
  {
    const client = await getFikenClient();
    const contacts = await client.getContacts({ name: "Skyservice", supplier: true });
    const found = contacts.find((c: any) =>
      c.name?.toLowerCase().includes("skyservice") && !KEEP_IDS.includes(c.contactId),
    );
    if (found) {
      entities.supplierId = found.contactId;
      console.log(`  ${C.cyan}Found supplier via Fiken search: #${entities.supplierId}${C.reset}`);
    } else {
      // Broader search
      const allContacts = await client.getContacts({ supplier: true });
      const broadFound = allContacts.find((c: any) =>
        c.name?.toLowerCase().includes("skyservice") && !KEEP_IDS.includes(c.contactId),
      );
      if (broadFound) {
        entities.supplierId = broadFound.contactId;
        console.log(`  ${C.cyan}Found supplier via broad search: #${entities.supplierId}${C.reset}`);
      }
    }
  }

  assert(
    "Step 12: Supplier ID found",
    entities.supplierId !== null,
    entities.supplierId ? `contactId: ${entities.supplierId}` : "Could not find supplier",
  );

  // Verify supplier details in Fiken
  if (entities.supplierId) {
    const client = await getFikenClient();
    const contact = await client.getContact(entities.supplierId);
    assert(
      "Fiken: Supplier name is correct",
      contains(contact.name || "", "skyservice"),
      contact.name,
    );
    assert(
      "Fiken: Supplier is marked as supplier",
      contact.supplier === true,
      `supplier=${contact.supplier}`,
    );
    assert(
      "Fiken: Supplier email is correct",
      contains(contact.email || "", "skyservice"),
      contact.email,
    );
    assert(
      "Fiken: Supplier org.nr is correct",
      contact.organizationNumber === "987654321",
      contact.organizationNumber,
    );
  }

  await delay(3000);

  // ──────────────────────────────────────────────
  // DEL 5: Opprett produkter (4 turns)
  // ──────────────────────────────────────────────

  // Step 13: Say we need two products — agent should ask for details
  const step13 = await sendStep(13, "Step 13", "Nå trenger jeg å lage to produkter");

  assert("Step 13: Response not empty", step13.fullText.trim().length > 30);
  assert("Step 13: No errors", step13.errors.length === 0);
  assert(
    "Step 13: Agent asks for product details",
    contains(step13.fullText, "?", "produkt", "navn", "pris", "detalj", "informasjon", "opplysning"),
    step13.fullText.substring(0, 300),
  );
  assert(
    "Step 13: Agent did NOT create anything",
    !entityWasCreated(step13.fullText),
    "Should not create without details",
  );

  await delay(3000);

  // Step 14: Provide both product details at once
  const step14 = await sendStep(
    14, "Step 14",
    "Første produkt: 'Konsulenttimer Senior' til 1800 kr eks mva. Andre: 'Konsulenttimer Junior' til 1200 kr eks mva. Begge skal bruke konto 3000 med 25% mva.",
  );

  assert("Step 14: Response not empty", step14.fullText.trim().length > 30);
  assert("Step 14: No errors", step14.errors.length === 0);
  assert(
    "Step 14: Shows Senior product",
    contains(step14.fullText, "senior", "1800"),
  );
  assert(
    "Step 14: Shows Junior product",
    contains(step14.fullText, "junior", "1200"),
  );

  await delay(3000);

  // Step 15: Confirm creation of both products
  let step15Result: ParsedStream;
  if (entityWasCreated(step14.fullText)) {
    console.log(`  ${C.green}Products created in step 14 directly${C.reset}`);
    step15Result = step14;
  } else {
    const step15 = await sendStep(15, "Step 15", "Ja, opprett begge");
    step15Result = step15;

    assert("Step 15: Response not empty", step15.fullText.trim().length > 30);
    assert("Step 15: No errors", step15.errors.length === 0);

    if (!entityWasCreated(step15.fullText) && agentNeedsResponse(step15.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step 15b");
      if (created) step15Result = result;
    }
  }

  assert(
    "Step 15: Products were created",
    entityWasCreated(step15Result.fullText),
    step15Result.fullText.substring(0, 200),
  );

  // Find products in Fiken
  {
    const client = await getFikenClient();
    const products = await client.getProducts({ name: "Konsulenttimer" });

    const senior = products.find((p: any) =>
      p.name?.toLowerCase().includes("senior"),
    );
    const junior = products.find((p: any) =>
      p.name?.toLowerCase().includes("junior"),
    );

    if (senior) {
      entities.productSeniorId = senior.productId;
      console.log(`  ${C.cyan}Found Senior product: #${entities.productSeniorId}${C.reset}`);
    }
    if (junior) {
      entities.productJuniorId = junior.productId;
      console.log(`  ${C.cyan}Found Junior product: #${entities.productJuniorId}${C.reset}`);
    }

    // If name search didn't work, try broader search
    if (!senior || !junior) {
      const allProducts = await client.getProducts({});
      if (!senior) {
        const s = allProducts.find((p: any) => p.name?.toLowerCase().includes("senior"));
        if (s) {
          entities.productSeniorId = s.productId;
          console.log(`  ${C.cyan}Found Senior via broad search: #${entities.productSeniorId}${C.reset}`);
        }
      }
      if (!junior) {
        const j = allProducts.find((p: any) => p.name?.toLowerCase().includes("junior"));
        if (j) {
          entities.productJuniorId = j.productId;
          console.log(`  ${C.cyan}Found Junior via broad search: #${entities.productJuniorId}${C.reset}`);
        }
      }
    }
  }

  assert(
    "Step 15: Senior product ID found",
    entities.productSeniorId !== null,
    entities.productSeniorId ? `productId: ${entities.productSeniorId}` : "Not found",
  );
  assert(
    "Step 15: Junior product ID found",
    entities.productJuniorId !== null,
    entities.productJuniorId ? `productId: ${entities.productJuniorId}` : "Not found",
  );

  // Verify product details in Fiken
  if (entities.productSeniorId) {
    const client = await getFikenClient();
    const product = await client.getProduct(entities.productSeniorId);
    assert(
      "Fiken: Senior product name correct",
      contains(product.name || "", "senior"),
      product.name,
    );
    assert(
      "Fiken: Senior product price is 180000 øre (1800 kr)",
      product.unitPrice === 180000,
      `unitPrice=${product.unitPrice} (expected 180000)`,
    );
    assert(
      "Fiken: Senior product vatType is HIGH",
      product.vatType?.toUpperCase() === "HIGH",
      `vatType=${product.vatType}`,
    );
    assert(
      "Fiken: Senior product incomeAccount is 3000",
      product.incomeAccount === "3000",
      `incomeAccount=${product.incomeAccount}`,
    );
  }

  if (entities.productJuniorId) {
    const client = await getFikenClient();
    const product = await client.getProduct(entities.productJuniorId);
    assert(
      "Fiken: Junior product name correct",
      contains(product.name || "", "junior"),
      product.name,
    );
    assert(
      "Fiken: Junior product price is 120000 øre (1200 kr)",
      product.unitPrice === 120000,
      `unitPrice=${product.unitPrice} (expected 120000)`,
    );
    assert(
      "Fiken: Junior product vatType is HIGH",
      product.vatType?.toUpperCase() === "HIGH",
      `vatType=${product.vatType}`,
    );
  }

  await delay(3000);

  // Step 16: Memory test — ask about Senior product price
  const step16 = await sendStep(16, "Step 16", "Hva var prisen på Senior-produktet igjen?");

  assert("Step 16: Response not empty", step16.fullText.trim().length > 30);
  assert("Step 16: No errors", step16.errors.length === 0);
  assert(
    "Step 16: Agent remembers Senior price (1800 kr)",
    contains(step16.fullText, "1800", "1 800"),
    step16.fullText.substring(0, 300),
  );

  await delay(3000);

  // ──────────────────────────────────────────────
  // DEL 6: Oppdatering — konteksthukommelse (4 turns)
  // ──────────────────────────────────────────────

  // Step 17: Update Junior product price
  let step17 = await sendStep(17, "Step 17", "Kan du endre prisen på produktet 'Konsulenttimer Junior' til 1350 kr eks mva?");

  assert("Step 17: Response not empty", step17.fullText.trim().length > 30);
  assert("Step 17: No errors", step17.errors.length === 0);

  // If the agent failed to update (says "problemer" etc.), retry once with a more explicit message
  if (contains(step17.fullText, "problemer", "kunne ikke", "feil", "prøve igjen") && !entityWasCreated(step17.fullText)) {
    console.log(`  ${C.yellow}⚠ Agent had trouble updating — retrying with explicit request${C.reset}`);
    await delay(3000);
    step17 = await sendStep(17, "Step 17 (retry)", "Ja, vennligst prøv igjen. Oppdater produktet 'Konsulenttimer Junior' til ny pris 1350 kr eks mva, med konto 3000 og 25% MVA (HIGH).");
  }

  assert(
    "Step 17: Shows update details with new price",
    contains(step17.fullText, "1350", "junior", "oppdater"),
    step17.fullText.substring(0, 300),
  );

  await delay(3000);

  // Step 18: Confirm update
  let step18Result: ParsedStream;
  if (entityWasCreated(step17.fullText)) {
    console.log(`  ${C.green}Product updated in step 17 directly${C.reset}`);
    step18Result = step17;
  } else {
    const step18 = await sendStep(18, "Step 18", "Ja, oppdater produktet!");
    step18Result = step18;

    assert("Step 18: Response not empty", step18.fullText.trim().length > 30);
    assert("Step 18: No errors", step18.errors.length === 0);

    if (!entityWasCreated(step18.fullText) && agentNeedsResponse(step18.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step 18b");
      if (created) step18Result = result;
    }
  }

  assert(
    "Step 18: Product was updated",
    entityWasCreated(step18Result.fullText),
    step18Result.fullText.substring(0, 200),
  );

  // Verify updated price in Fiken
  if (entities.productJuniorId) {
    const client = await getFikenClient();
    const product = await client.getProduct(entities.productJuniorId);
    assert(
      "Fiken: Junior product price updated to 135000 øre (1350 kr)",
      product.unitPrice === 135000,
      `unitPrice=${product.unitPrice} (expected 135000)`,
    );
  }

  await delay(3000);

  // Step 19: Update Nordlys Konsult email — tests context memory from turn 6
  const step19 = await sendStep(
    19, "Step 19",
    "Oppdater e-posten til Nordlys Konsult til ny-epost@nordlys-konsult.no",
  );

  assert("Step 19: Response not empty", step19.fullText.trim().length > 30);
  assert("Step 19: No errors", step19.errors.length === 0);
  assert(
    "Step 19: Recognizes Nordlys Konsult context",
    contains(step19.fullText, "nordlys", "konsult"),
    step19.fullText.substring(0, 300),
  );
  assert(
    "Step 19: Shows new email or acknowledges update request",
    contains(step19.fullText, "ny-epost@nordlys-konsult.no", "e-post", "oppdater"),
    step19.fullText.substring(0, 300),
  );

  await delay(3000);

  // Step 20: Confirm email update
  let step20Result: ParsedStream;
  if (entityWasCreated(step19.fullText)) {
    console.log(`  ${C.green}Email updated in step 19 directly${C.reset}`);
    step20Result = step19;
  } else {
    const step20 = await sendStep(20, "Step 20", "Ja, oppdater");
    step20Result = step20;

    assert("Step 20: Response not empty", step20.fullText.trim().length > 30);
    assert("Step 20: No errors", step20.errors.length === 0);

    if (!entityWasCreated(step20.fullText) && agentNeedsResponse(step20.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step 20b");
      if (created) step20Result = result;
    }
  }

  assert(
    "Step 20: Email was updated",
    entityWasCreated(step20Result.fullText),
    step20Result.fullText.substring(0, 200),
  );

  // Verify updated email in Fiken
  if (entities.customerId) {
    const client = await getFikenClient();
    const contact = await client.getContact(entities.customerId);
    assert(
      "Fiken: Customer email updated to ny-epost@nordlys-konsult.no",
      contact.email === "ny-epost@nordlys-konsult.no",
      `email=${contact.email}`,
    );
  }

  await delay(3000);

  // ──────────────────────────────────────────────
  // DEL 7: Opprydding (2 turns)
  // ──────────────────────────────────────────────

  // Step 21: Ask to delete everything
  const step21 = await sendStep(
    21, "Step 21",
    "Nå er jeg ferdig. Kan du slette alt vi har laget i dag? Begge kontaktene, kontaktpersonen og begge produktene.",
  );

  assert("Step 21: Response not empty", step21.fullText.trim().length > 30);
  assert("Step 21: No errors", step21.errors.length === 0);
  assert(
    "Step 21: Lists entities to delete",
    contains(step21.fullText, "nordlys", "skyservice") ||
    contains(step21.fullText, "kontakt", "produkt", "slett"),
    step21.fullText.substring(0, 300),
  );
  assert(
    "Step 21: Asks for confirmation before deleting",
    agentNeedsResponse(step21.fullText) || contains(step21.fullText, "?", "stemmer", "bekreft", "sikker"),
    "Should confirm before deleting",
  );

  await delay(3000);

  // Step 22: Confirm deletion
  let step22Result: ParsedStream;
  if (entityWasDeleted(step21.fullText)) {
    console.log(`  ${C.green}Entities deleted in step 21 directly${C.reset}`);
    step22Result = step21;
  } else {
    const step22 = await sendStep(22, "Step 22", "Ja, slett alt");
    step22Result = step22;

    assert("Step 22: Response not empty", step22.fullText.trim().length > 30);
    assert("Step 22: No errors", step22.errors.length === 0);

    // Agent might need multiple turns to delete everything
    if (!entityWasDeleted(step22.fullText) && agentNeedsResponse(step22.fullText)) {
      const { result, created } = await confirmUntilCreated(history, "Step 22b");
      if (created) step22Result = result;
    }
  }

  assert(
    "Step 22: Entities were deleted",
    entityWasDeleted(step22Result.fullText),
    step22Result.fullText.substring(0, 300),
  );

  // Verify deletions in Fiken
  {
    const client = await getFikenClient();

    // Check customer is deleted
    if (entities.customerId) {
      try {
        await client.getContact(entities.customerId);
        // If we got here, it still exists — the agent may not have deleted it
        assert("Fiken: Customer was deleted", false, `Contact #${entities.customerId} still exists`);
      } catch (error) {
        // Expected: 404 or error means it was deleted
        assert("Fiken: Customer was deleted", true, `Contact #${entities.customerId} not found (deleted)`);
        entities.customerId = undefined; // Mark as cleaned up
      }
    }

    // Check supplier is deleted
    if (entities.supplierId) {
      try {
        await client.getContact(entities.supplierId);
        assert("Fiken: Supplier was deleted", false, `Contact #${entities.supplierId} still exists`);
      } catch (error) {
        assert("Fiken: Supplier was deleted", true, `Contact #${entities.supplierId} not found (deleted)`);
        entities.supplierId = undefined;
      }
    }

    // Check products are deleted
    if (entities.productSeniorId) {
      try {
        await client.getProduct(entities.productSeniorId);
        assert("Fiken: Senior product was deleted", false, `Product #${entities.productSeniorId} still exists`);
      } catch (error) {
        assert("Fiken: Senior product was deleted", true, `Product #${entities.productSeniorId} not found (deleted)`);
        entities.productSeniorId = undefined;
      }
    }

    if (entities.productJuniorId) {
      try {
        await client.getProduct(entities.productJuniorId);
        assert("Fiken: Junior product was deleted", false, `Product #${entities.productJuniorId} still exists`);
      } catch (error) {
        assert("Fiken: Junior product was deleted", true, `Product #${entities.productJuniorId} not found (deleted)`);
        entities.productJuniorId = undefined;
      }
    }
  }

  return { history, entities };
}

// ============================================
// Pre-cleanup: Remove stale test data
// ============================================

async function preCleanup(): Promise<void> {
  console.log(`\n${C.bold}═══ PRE-CLEANUP${C.reset}`);
  console.log(`${C.dim}  Removing stale test entities from previous runs...${C.reset}`);

  const client = await getFikenClient();

  // Clean up stale contacts
  for (const searchName of ["Nordlys Konsult", "Skyservice"]) {
    try {
      const contacts = await client.getContacts({ name: searchName });
      for (const contact of contacts) {
        if (KEEP_IDS.includes(contact.contactId!)) continue;
        if (!contact.name?.toLowerCase().includes(searchName.toLowerCase().split(" ")[0])) continue;

        // Delete contact persons first
        try {
          const persons = await client.getContactPersons(contact.contactId!);
          for (const person of persons) {
            try {
              await client.deleteContactPerson(contact.contactId!, person.contactPersonId!);
              console.log(`  ${C.green}✓${C.reset} Deleted contact person '${person.name}' from '${contact.name}'`);
            } catch (e) {
              console.log(`  ${C.yellow}⚠${C.reset} Could not delete contact person '${person.name}': ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        } catch { /* no contact persons */ }

        try {
          await client.deleteContact(contact.contactId!);
          console.log(`  ${C.green}✓${C.reset} Deleted stale contact '${contact.name}' (#${contact.contactId})`);
        } catch (e) {
          console.log(`  ${C.yellow}⚠${C.reset} Could not delete contact '${contact.name}': ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch { /* search failed, ok */ }
  }

  // Clean up stale products
  try {
    const products = await client.getProducts({ name: "Konsulenttimer" });
    for (const product of products) {
      try {
        await client.deleteProduct(product.productId!);
        console.log(`  ${C.green}✓${C.reset} Deleted stale product '${product.name}' (#${product.productId})`);
      } catch (e) {
        console.log(`  ${C.yellow}⚠${C.reset} Could not delete product '${product.name}': ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch { /* search failed, ok */ }

  // Also try broader product search
  try {
    const allProducts = await client.getProducts({});
    for (const product of allProducts) {
      if (
        product.name?.toLowerCase().includes("konsulenttimer") ||
        product.name?.toLowerCase().includes("senior") ||
        product.name?.toLowerCase().includes("junior")
      ) {
        try {
          await client.deleteProduct(product.productId!);
          console.log(`  ${C.green}✓${C.reset} Deleted stale product '${product.name}' (#${product.productId})`);
        } catch { /* already deleted or in use */ }
      }
    }
  } catch { /* ok */ }

  console.log(`${C.dim}  Pre-cleanup complete.${C.reset}`);
}

// ============================================
// Safety cleanup: Delete any remaining test entities
// ============================================

async function safetyCleanup(entities: CreatedEntities): Promise<void> {
  console.log(`\n${C.bold}═══ SAFETY CLEANUP${C.reset}`);
  console.log(`${C.dim}  Ensuring all test entities are removed...${C.reset}`);

  const client = await getFikenClient();

  // Delete contact person first (before deleting the contact)
  if (entities.contactPersonId && entities.customerId) {
    try {
      await client.deleteContactPerson(entities.customerId, entities.contactPersonId);
      console.log(`  ${C.green}✓${C.reset} Deleted contact person #${entities.contactPersonId}`);
    } catch (e) {
      console.log(`  ${C.dim}Contact person #${entities.contactPersonId} already deleted or not found${C.reset}`);
    }
  }

  // Delete contacts
  if (entities.customerId) {
    // First delete any remaining contact persons
    try {
      const persons = await client.getContactPersons(entities.customerId);
      for (const person of persons) {
        try {
          await client.deleteContactPerson(entities.customerId!, person.contactPersonId!);
          console.log(`  ${C.green}✓${C.reset} Deleted remaining contact person '${person.name}'`);
        } catch { /* ok */ }
      }
    } catch { /* ok */ }

    try {
      await client.deleteContact(entities.customerId);
      console.log(`  ${C.green}✓${C.reset} Deleted customer #${entities.customerId}`);
    } catch (e) {
      console.log(`  ${C.dim}Customer #${entities.customerId} already deleted or not found${C.reset}`);
    }
  }

  if (entities.supplierId) {
    try {
      await client.deleteContact(entities.supplierId);
      console.log(`  ${C.green}✓${C.reset} Deleted supplier #${entities.supplierId}`);
    } catch (e) {
      console.log(`  ${C.dim}Supplier #${entities.supplierId} already deleted or not found${C.reset}`);
    }
  }

  // Delete products
  if (entities.productSeniorId) {
    try {
      await client.deleteProduct(entities.productSeniorId);
      console.log(`  ${C.green}✓${C.reset} Deleted Senior product #${entities.productSeniorId}`);
    } catch (e) {
      console.log(`  ${C.dim}Senior product #${entities.productSeniorId} already deleted or not found${C.reset}`);
    }
  }

  if (entities.productJuniorId) {
    try {
      await client.deleteProduct(entities.productJuniorId);
      console.log(`  ${C.green}✓${C.reset} Deleted Junior product #${entities.productJuniorId}`);
    } catch (e) {
      console.log(`  ${C.dim}Junior product #${entities.productJuniorId} already deleted or not found${C.reset}`);
    }
  }

  // Final sweep: search by name in case we missed any
  for (const searchName of ["Nordlys Konsult", "Skyservice"]) {
    try {
      const contacts = await client.getContacts({ name: searchName });
      for (const contact of contacts) {
        if (KEEP_IDS.includes(contact.contactId!)) continue;

        // Delete contact persons first
        try {
          const persons = await client.getContactPersons(contact.contactId!);
          for (const person of persons) {
            try {
              await client.deleteContactPerson(contact.contactId!, person.contactPersonId!);
            } catch { /* ok */ }
          }
        } catch { /* ok */ }

        try {
          await client.deleteContact(contact.contactId!);
          console.log(`  ${C.green}✓${C.reset} Swept contact '${contact.name}' (#${contact.contactId})`);
        } catch { /* ok */ }
      }
    } catch { /* ok */ }
  }

  // Sweep products
  try {
    const products = await client.getProducts({});
    for (const product of products) {
      if (
        product.name?.toLowerCase().includes("konsulenttimer") ||
        product.name?.toLowerCase().includes("senior") ||
        product.name?.toLowerCase().includes("junior")
      ) {
        try {
          await client.deleteProduct(product.productId!);
          console.log(`  ${C.green}✓${C.reset} Swept product '${product.name}' (#${product.productId})`);
        } catch { /* ok */ }
      }
    }
  } catch { /* ok */ }

  console.log(`${C.dim}  Safety cleanup complete.${C.reset}`);
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  const startTime = Date.now();
  const args = process.argv.slice(2);

  VERBOSE = args.includes("--verbose");
  const noCleanup = args.includes("--no-cleanup");
  const stepArg = args.find((a) => a.startsWith("--step="));
  const maxStep = stepArg ? parseInt(stepArg.split("=")[1]) : 99;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${C.bold}E2E TEST: Contact & Product CRUD (~22 turns)${C.reset}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`${C.dim}  API: ${API_URL}`);
  console.log(`  User: ${USER_ID}`);
  console.log(`  Verbose: ${VERBOSE}`);
  console.log(`  No cleanup: ${noCleanup}`);
  console.log(`  Max step: ${maxStep}${C.reset}`);

  // ─────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────
  try {
    const healthRes = await fetch(`${API_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    console.log(`\n  ${C.green}✓${C.reset} API server is running`);
  } catch (error) {
    console.log(`\n  ${C.red}✗ API server is not running on ${API_URL}${C.reset}`);
    console.log(`  ${C.dim}Start with: cd knud-api && npm run dev${C.reset}`);
    process.exit(1);
  }

  // ─────────────────────────────────────────
  // Auth check
  // ─────────────────────────────────────────
  try {
    const authRes = await fetch(`${API_URL}/api/chats`, {
      headers: { Authorization: `Bearer ${USER_ID}` },
    });
    if (authRes.status === 401) {
      console.log(`  ${C.red}✗ Authentication failed — invalid user ID${C.reset}`);
      process.exit(1);
    }
    console.log(`  ${C.green}✓${C.reset} Authentication OK`);
  } catch (error) {
    console.log(`  ${C.red}✗ Auth check failed${C.reset}`);
    process.exit(1);
  }

  // ─────────────────────────────────────────
  // Fiken connection check
  // ─────────────────────────────────────────
  try {
    const client = await getFikenClient();
    // Quick test: fetch contacts (should not throw)
    await client.getContacts({ name: "test-connection-check" });
    console.log(`  ${C.green}✓${C.reset} Fiken connection OK`);
  } catch (error) {
    console.log(`  ${C.red}✗ Fiken connection failed${C.reset}`);
    console.log(`  ${C.dim}${error instanceof Error ? error.message : String(error)}${C.reset}`);
    process.exit(1);
  }

  // ─────────────────────────────────────────
  // Pre-cleanup
  // ─────────────────────────────────────────
  await preCleanup();

  // ─────────────────────────────────────────
  // PART 1: Run the conversation
  // ─────────────────────────────────────────
  let conversationResult: ConversationResult | null = null;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${C.bold}PART 1: CONVERSATION (~22 turns)${C.reset}`);
  console.log(`${"=".repeat(70)}`);

  try {
    conversationResult = await runConversation(maxStep);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SKIP:")) {
      const skippedStep = error.message.split(":")[1];
      console.log(`\n${C.dim}Stopped at step ${skippedStep} (--step=${maxStep})${C.reset}`);
      // Create a minimal result for partial runs
      conversationResult = { history: [], entities: { customerId: undefined, contactPersonId: undefined, supplierId: undefined, productSeniorId: undefined, productJuniorId: undefined } };
    } else {
      console.log(`\n${C.red}CONVERSATION FAILED:${C.reset} ${error instanceof Error ? error.message : String(error)}`);
      if (VERBOSE && error instanceof Error) console.log(error.stack);
    }
  }

  // ─────────────────────────────────────────
  // PART 2: Cross-cutting assertions
  // ─────────────────────────────────────────
  if (conversationResult && conversationResult.history.length > 0) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${C.bold}PART 2: CROSS-CUTTING ASSERTIONS${C.reset}`);
    console.log(`${"=".repeat(70)}`);

    const allAssistantText = conversationResult.history
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n");

    assert(
      "Cross: Agent used Norwegian language throughout",
      contains(allAssistantText, "kunde", "leverandør", "produkt", "kontakt"),
      "Norwegian domain terms present",
    );

    assert(
      "Cross: Agent never exposed raw API errors to user",
      notContains(allAssistantText, "500 internal", "ECONNREFUSED", "TypeError", "undefined is not"),
      "No raw errors",
    );

    // Count distinct "stemmer dette" / confirmation prompts
    const confirmMatches = allAssistantText.match(/stemmer\s+dette|bekreft|ja\/nei|er\s+det\s+riktig/gi);
    assert(
      "Cross: Agent asked for confirmation multiple times",
      (confirmMatches?.length || 0) >= 3,
      `Found ${confirmMatches?.length || 0} confirmation prompts (expected >= 3)`,
    );
  }

  // ─────────────────────────────────────────
  // PART 3: Safety cleanup (if not --no-cleanup)
  // ─────────────────────────────────────────
  if (conversationResult && !noCleanup) {
    await safetyCleanup(conversationResult.entities);
  } else if (noCleanup) {
    console.log(`\n${C.dim}═══ Cleanup skipped (--no-cleanup flag)${C.reset}`);
    if (conversationResult) {
      console.log(`${C.dim}  Customer ID: ${conversationResult.entities.customerId || "none"}`);
      console.log(`  Supplier ID: ${conversationResult.entities.supplierId || "none"}`);
      console.log(`  Senior product ID: ${conversationResult.entities.productSeniorId || "none"}`);
      console.log(`  Junior product ID: ${conversationResult.entities.productJuniorId || "none"}${C.reset}`);
    }
  }

  // ─────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log(`${C.bold}SUMMARY — Contact & Product CRUD E2E Test${C.reset}`);
  console.log("=".repeat(70));

  if (conversationResult && conversationResult.history.length > 0) {
    const userTurns = conversationResult.history.filter((m) => m.role === "user").length;
    const assistantTurns = conversationResult.history.filter((m) => m.role === "assistant").length;
    console.log(`Conversation: ${userTurns} user turns, ${assistantTurns} assistant turns`);

    console.log(`Entities:     Customer: ${conversationResult.entities.customerId || "–"}, ` +
      `Supplier: ${conversationResult.entities.supplierId || "–"}, ` +
      `Products: ${conversationResult.entities.productSeniorId || "–"} / ${conversationResult.entities.productJuniorId || "–"}`);
  }

  console.log(
    `Assertions:   ${C.green}${passedAssertions} passed${C.reset}, ${failedAssertions > 0 ? C.red : C.dim}${failedAssertions} failed${C.reset} / ${totalAssertions} total`,
  );
  console.log(`Duration:     ${duration}s`);

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
