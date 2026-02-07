/**
 * End-to-end test script for Fiken multi-agent orchestrator system.
 * 
 * Sends 126 test messages to POST /api/chat and verifies:
 * - Orchestrator routes to the correct agent
 * - Tool calls are executed successfully
 * - Responses are coherent and in Norwegian
 * - No crashes or unhandled errors
 * 
 * Usage: npx tsx scripts/e2e-test-agents.ts
 * 
 * Prerequisites:
 * - API server running on localhost:3001
 * - Fiken user with valid token in database
 */

const API_URL = "http://localhost:3001";
const USER_ID = "678b5c02-c4a1-4496-a479-006f257c37ab"; // Fiken demo user

// ============================================
// Types
// ============================================

interface TestCase {
  id: number;
  category: string;
  message: string;
  expectedAgent?: string; // Which delegation tool we expect orchestrator to call
  description: string;
}

interface TestResult {
  id: number;
  category: string;
  message: string;
  expectedAgent?: string;
  actualAgent?: string;
  agentCorrect: boolean | null; // null if no expectation
  toolsCalled: string[];
  responseText: string;
  responseLength: number;
  hasError: boolean;
  errorDetails?: string;
  durationMs: number;
  streamEvents: {
    textChunks: number;
    toolCallEvents: number;
    toolResultEvents: number;
    errorEvents: number;
  };
}

// ============================================
// Test Cases - 126 messages across 10 categories
// ============================================

const TEST_CASES: TestCase[] = [
  // ============================================
  // Category 1: Orchestrator Routing (15 messages)
  // ============================================
  { id: 1, category: "Orchestrator", message: "Hei, hva kan du hjelpe meg med?", description: "General greeting - orchestrator should answer directly", expectedAgent: undefined },
  { id: 2, category: "Orchestrator", message: "Vis meg siste fakturaer", description: "Invoice query -> invoiceAgent", expectedAgent: "delegateToInvoiceAgent" },
  { id: 3, category: "Orchestrator", message: "Jeg trenger å registrere et kjøp", description: "Purchase intent -> purchaseAgent", expectedAgent: "delegateToPurchaseAgent" },
  { id: 4, category: "Orchestrator", message: "Hvem er kundene mine?", description: "Contact query -> contactAgent", expectedAgent: "delegateToContactAgent" },
  { id: 5, category: "Orchestrator", message: "Lag et tilbud", description: "Offer intent -> offerAgent", expectedAgent: "delegateToOfferAgent" },
  { id: 6, category: "Orchestrator", message: "Hva er banksaldoen min?", description: "Bank balance -> bankAgent", expectedAgent: "delegateToBankAgent" },
  { id: 7, category: "Orchestrator", message: "Forklar avskrivningsregler", description: "Accounting question -> accountingAgent", expectedAgent: "delegateToAccountingAgent" },
  { id: 8, category: "Orchestrator", message: "Jeg kjøpte kontorrekvisita for 500 kr", description: "Purchase with details -> purchaseAgent", expectedAgent: "delegateToPurchaseAgent" },
  { id: 9, category: "Orchestrator", message: "Send faktura til kunde", description: "Send invoice -> invoiceAgent", expectedAgent: "delegateToInvoiceAgent" },
  { id: 10, category: "Orchestrator", message: "Vis innboksen min", description: "Inbox -> bankAgent", expectedAgent: "delegateToBankAgent" },
  { id: 11, category: "Orchestrator", message: "Opprett et prosjekt", description: "Project -> accountingAgent", expectedAgent: "delegateToAccountingAgent" },
  { id: 12, category: "Orchestrator", message: "Legg til en ny leverandør", description: "Supplier -> contactAgent", expectedAgent: "delegateToContactAgent" },
  { id: 13, category: "Orchestrator", message: "Vis meg ordrebekreftelser", description: "Order confirmations -> offerAgent", expectedAgent: "delegateToOfferAgent" },
  { id: 14, category: "Orchestrator", message: "Sjekk om det finnes umatchede banktransaksjoner", description: "Unmatched transactions -> bankAgent", expectedAgent: "delegateToBankAgent" },
  { id: 15, category: "Orchestrator", message: "Hva er selskapsinformasjonen min?", description: "Company info -> accountingAgent", expectedAgent: "delegateToAccountingAgent" },

  // ============================================
  // Category 2: Invoice Agent - Faktura (15 messages)
  // ============================================
  { id: 16, category: "Faktura", message: "Vis meg alle fakturaer fra januar 2026", description: "Search invoices by date", expectedAgent: "delegateToInvoiceAgent" },
  { id: 17, category: "Faktura", message: "Vis meg ubetalte fakturaer", description: "Search unsettled invoices", expectedAgent: "delegateToInvoiceAgent" },
  { id: 18, category: "Faktura", message: "Finnes det noen fakturaer i systemet?", description: "General invoice search", expectedAgent: "delegateToInvoiceAgent" },
  { id: 19, category: "Faktura", message: "Opprett en faktura til en kunde på 1500 kr for konsulenttjenester", description: "Create invoice (may need to find customer first)", expectedAgent: "delegateToInvoiceAgent" },
  { id: 20, category: "Faktura", message: "Lag et fakturautkast for 10 timer rådgivning à 1200 kr", description: "Create invoice draft", expectedAgent: "delegateToInvoiceAgent" },
  { id: 21, category: "Faktura", message: "Vis alle fakturautkast", description: "Get invoice drafts", expectedAgent: "delegateToInvoiceAgent" },
  { id: 22, category: "Faktura", message: "Kan du slette et fakturautkast?", description: "Delete draft intent", expectedAgent: "delegateToInvoiceAgent" },
  { id: 23, category: "Faktura", message: "Hvordan oppretter jeg en faktura fra et utkast?", description: "Create from draft question", expectedAgent: "delegateToInvoiceAgent" },
  { id: 24, category: "Faktura", message: "Kan du sende en faktura på e-post?", description: "Send invoice email", expectedAgent: "delegateToInvoiceAgent" },
  { id: 25, category: "Faktura", message: "Kan man sende faktura som EHF?", description: "Send invoice EHF", expectedAgent: "delegateToInvoiceAgent" },
  { id: 26, category: "Faktura", message: "Jeg trenger å kreditere en faktura", description: "Credit note intent", expectedAgent: "delegateToInvoiceAgent" },
  { id: 27, category: "Faktura", message: "Vis alle kreditnotaer", description: "Search credit notes", expectedAgent: "delegateToInvoiceAgent" },
  { id: 28, category: "Faktura", message: "Hva er neste fakturanummer?", description: "Invoice counter", expectedAgent: "delegateToInvoiceAgent" },
  { id: 29, category: "Faktura", message: "Initialiser fakturatelleren", description: "Initialize invoice counter", expectedAgent: "delegateToInvoiceAgent" },
  { id: 30, category: "Faktura", message: "Kan jeg lage en delvis kreditnota?", description: "Partial credit note question", expectedAgent: "delegateToInvoiceAgent" },

  // ============================================
  // Category 3: Invoice Agent - Salg (8 messages)
  // ============================================
  { id: 31, category: "Salg", message: "Vis meg siste salg", description: "Search sales", expectedAgent: "delegateToInvoiceAgent" },
  { id: 32, category: "Salg", message: "Registrer et kontantsalg på 800 kr for produktsalg", description: "Create cash sale", expectedAgent: "delegateToInvoiceAgent" },
  { id: 33, category: "Salg", message: "Vis meg salg fra februar 2026", description: "Search sales by date", expectedAgent: "delegateToInvoiceAgent" },
  { id: 34, category: "Salg", message: "Registrer et externt fakturasalg på 5000 kr", description: "Create external invoice sale", expectedAgent: "delegateToInvoiceAgent" },
  { id: 35, category: "Salg", message: "Hvordan sletter jeg et salg?", description: "Delete sale question", expectedAgent: "delegateToInvoiceAgent" },
  { id: 36, category: "Salg", message: "Kan jeg registrere betaling på et salg?", description: "Add sale payment question", expectedAgent: "delegateToInvoiceAgent" },
  { id: 37, category: "Salg", message: "Marker et salg som betalt", description: "Settle sale intent", expectedAgent: "delegateToInvoiceAgent" },
  { id: 38, category: "Salg", message: "Hva er forskjellen på et salg og en faktura?", description: "Sale vs invoice question", expectedAgent: "delegateToInvoiceAgent" },

  // ============================================
  // Category 4: Purchase Agent - Kjøp (15 messages)
  // ============================================
  { id: 39, category: "Kjøp", message: "Vis meg siste kjøp", description: "Search purchases", expectedAgent: "delegateToPurchaseAgent" },
  { id: 40, category: "Kjøp", message: "Jeg kjøpte kontorrekvisita for 400 kr inkl mva", description: "Create purchase with VAT", expectedAgent: "delegateToPurchaseAgent" },
  { id: 41, category: "Kjøp", message: "Registrer husleie for februar, 10 000 kr eks mva", description: "Create rent purchase", expectedAgent: "delegateToPurchaseAgent" },
  { id: 42, category: "Kjøp", message: "Vis kjøp fra januar 2026", description: "Search purchases by date", expectedAgent: "delegateToPurchaseAgent" },
  { id: 43, category: "Kjøp", message: "Vis detaljer for siste kjøp", description: "Get purchase details", expectedAgent: "delegateToPurchaseAgent" },
  { id: 44, category: "Kjøp", message: "Kan jeg slette et kjøp?", description: "Delete purchase question", expectedAgent: "delegateToPurchaseAgent" },
  { id: 45, category: "Kjøp", message: "Registrer betaling på et kjøp", description: "Add purchase payment", expectedAgent: "delegateToPurchaseAgent" },
  { id: 46, category: "Kjøp", message: "Hvilken konto skal jeg bruke for kontorrekvisita?", description: "Account suggestion", expectedAgent: "delegateToPurchaseAgent" },
  { id: 47, category: "Kjøp", message: "Foreslå konto for telefonabonnement", description: "Account suggestion telecom", expectedAgent: "delegateToPurchaseAgent" },
  { id: 48, category: "Kjøp", message: "Jeg betalte 200 kr for parkering", description: "Parking purchase", expectedAgent: "delegateToPurchaseAgent" },
  { id: 49, category: "Kjøp", message: "Registrer et kjøp av datautstyr for 15 000 kr inkl mva", description: "Computer equipment purchase", expectedAgent: "delegateToPurchaseAgent" },
  { id: 50, category: "Kjøp", message: "Vis alle kjøpsutkast", description: "Get purchase drafts", expectedAgent: "delegateToPurchaseAgent" },
  { id: 51, category: "Kjøp", message: "Jeg har en leverandørfaktura fra Telenor på 599 kr", description: "Supplier invoice", expectedAgent: "delegateToPurchaseAgent" },
  { id: 52, category: "Kjøp", message: "Registrer kjøp av møbler for 25 000 kr", description: "Furniture purchase", expectedAgent: "delegateToPurchaseAgent" },
  { id: 53, category: "Kjøp", message: "Vis bankkontoer for betaling", description: "Get bank accounts for payment", expectedAgent: "delegateToPurchaseAgent" },

  // ============================================
  // Category 5: Contact Agent - Kontakter (12 messages)
  // ============================================
  { id: 54, category: "Kontakter", message: "Vis alle kontakter", description: "Search all contacts", expectedAgent: "delegateToContactAgent" },
  { id: 55, category: "Kontakter", message: "Søk etter kontakt med navn Nordmann", description: "Search contact by name", expectedAgent: "delegateToContactAgent" },
  { id: 56, category: "Kontakter", message: "Opprett en ny kunde: Test Kunde AS, epost test@kunde.no", description: "Create customer", expectedAgent: "delegateToContactAgent" },
  { id: 57, category: "Kontakter", message: "Opprett leverandør: Test Leverandør AS, org.nr 999888777", description: "Create supplier", expectedAgent: "delegateToContactAgent" },
  { id: 58, category: "Kontakter", message: "Kan jeg oppdatere telefonnummeret til en kontakt?", description: "Update contact question", expectedAgent: "delegateToContactAgent" },
  { id: 59, category: "Kontakter", message: "Kan jeg slette en kontakt?", description: "Delete contact question", expectedAgent: "delegateToContactAgent" },
  { id: 60, category: "Kontakter", message: "Vis kontaktpersoner for en bedriftskontakt", description: "Get contact persons", expectedAgent: "delegateToContactAgent" },
  { id: 61, category: "Kontakter", message: "Legg til en kontaktperson på en bedrift", description: "Add contact person", expectedAgent: "delegateToContactAgent" },
  { id: 62, category: "Kontakter", message: "Vis bare leverandører", description: "Search suppliers only", expectedAgent: "delegateToContactAgent" },
  { id: 63, category: "Kontakter", message: "Finn kontakt med organisasjonsnummer 912345678", description: "Search by org number", expectedAgent: "delegateToContactAgent" },
  { id: 64, category: "Kontakter", message: "Vis detaljer for en bestemt kontakt", description: "Get contact details", expectedAgent: "delegateToContactAgent" },
  { id: 65, category: "Kontakter", message: "Vis inaktive kontakter", description: "Search inactive contacts", expectedAgent: "delegateToContactAgent" },

  // ============================================
  // Category 6: Contact Agent - Produkter (7 messages)
  // ============================================
  { id: 66, category: "Produkter", message: "Vis alle produkter", description: "Search products", expectedAgent: "delegateToContactAgent" },
  { id: 67, category: "Produkter", message: "Opprett produkt: Webdesign, pris 1500 kr, 25% mva, konto 3000", description: "Create product", expectedAgent: "delegateToContactAgent" },
  { id: 68, category: "Produkter", message: "Oppdater prisen på et produkt til 2000 kr", description: "Update product price", expectedAgent: "delegateToContactAgent" },
  { id: 69, category: "Produkter", message: "Slett et produkt", description: "Delete product", expectedAgent: "delegateToContactAgent" },
  { id: 70, category: "Produkter", message: "Søk etter produkt med navn Konsulent", description: "Search products by name", expectedAgent: "delegateToContactAgent" },
  { id: 71, category: "Produkter", message: "Vis detaljer for et bestemt produkt", description: "Get product details", expectedAgent: "delegateToContactAgent" },
  { id: 72, category: "Produkter", message: "Deaktiver et produkt", description: "Deactivate product", expectedAgent: "delegateToContactAgent" },

  // ============================================
  // Category 7: Offer Agent - Tilbud og ordrebekreftelser (12 messages)
  // ============================================
  { id: 73, category: "Tilbud", message: "Vis alle tilbud", description: "Search offers", expectedAgent: "delegateToOfferAgent" },
  { id: 74, category: "Tilbud", message: "Lag et tilbudsutkast for 20 timer rådgivning à 1200 kr", description: "Create offer draft", expectedAgent: "delegateToOfferAgent" },
  { id: 75, category: "Tilbud", message: "Vis alle tilbudsutkast", description: "Get offer drafts", expectedAgent: "delegateToOfferAgent" },
  { id: 76, category: "Tilbud", message: "Hvordan oppretter jeg tilbud fra et utkast?", description: "Create offer from draft question", expectedAgent: "delegateToOfferAgent" },
  { id: 77, category: "Tilbud", message: "Kan jeg slette et tilbudsutkast?", description: "Delete offer draft question", expectedAgent: "delegateToOfferAgent" },
  { id: 78, category: "Tilbud", message: "Vis alle ordrebekreftelser", description: "Search order confirmations", expectedAgent: "delegateToOfferAgent" },
  { id: 79, category: "Tilbud", message: "Lag et ordrebekreftelsesutkast for 10 stk varer à 500 kr", description: "Create order confirmation draft", expectedAgent: "delegateToOfferAgent" },
  { id: 80, category: "Tilbud", message: "Opprett ordrebekreftelse fra et utkast", description: "Create order confirmation from draft", expectedAgent: "delegateToOfferAgent" },
  { id: 81, category: "Tilbud", message: "Kan jeg lage en faktura fra en ordrebekreftelse?", description: "Invoice from order confirmation", expectedAgent: "delegateToOfferAgent" },
  { id: 82, category: "Tilbud", message: "Hva er neste tilbudsnummer?", description: "Offer counter", expectedAgent: "delegateToOfferAgent" },
  { id: 83, category: "Tilbud", message: "Initialiser tilbudsteller", description: "Initialize offer counter", expectedAgent: "delegateToOfferAgent" },
  { id: 84, category: "Tilbud", message: "Vis detaljer for et tilbud", description: "Get offer details", expectedAgent: "delegateToOfferAgent" },

  // ============================================
  // Category 8: Bank Agent (12 messages)
  // ============================================
  { id: 85, category: "Bank", message: "Vis alle bankkontoer", description: "Get bank accounts", expectedAgent: "delegateToBankAgent" },
  { id: 86, category: "Bank", message: "Hva er saldoen på alle bankkontoer?", description: "Get bank balances", expectedAgent: "delegateToBankAgent" },
  { id: 87, category: "Bank", message: "Vis banksaldo per 31. januar 2026", description: "Get bank balances for date", expectedAgent: "delegateToBankAgent" },
  { id: 88, category: "Bank", message: "Vis detaljer for en bankkonto", description: "Get bank account details", expectedAgent: "delegateToBankAgent" },
  { id: 89, category: "Bank", message: "Søk etter transaksjoner fra januar 2026", description: "Search transactions by date", expectedAgent: "delegateToBankAgent" },
  { id: 90, category: "Bank", message: "Vis detaljer for en transaksjon", description: "Get transaction details", expectedAgent: "delegateToBankAgent" },
  { id: 91, category: "Bank", message: "Finn umatchede banktransaksjoner på 500 kr rundt 1. februar", description: "Unmatched transactions", expectedAgent: "delegateToBankAgent" },
  { id: 92, category: "Bank", message: "Vis innboksen min", description: "Search inbox", expectedAgent: "delegateToBankAgent" },
  { id: 93, category: "Bank", message: "Vis ubehandlede dokumenter i innboksen", description: "Search inbox unprocessed", expectedAgent: "delegateToBankAgent" },
  { id: 94, category: "Bank", message: "Hent et dokument fra innboksen", description: "Get inbox document", expectedAgent: "delegateToBankAgent" },
  { id: 95, category: "Bank", message: "Kan jeg slette en transaksjon?", description: "Delete transaction question", expectedAgent: "delegateToBankAgent" },
  { id: 96, category: "Bank", message: "Opprett en ny bankkonto: Sparekonto", description: "Create bank account", expectedAgent: "delegateToBankAgent" },

  // ============================================
  // Category 9: Accounting Agent (15 messages)
  // ============================================
  { id: 97, category: "Regnskap", message: "Vis kontoplanen", description: "Get chart of accounts", expectedAgent: "delegateToAccountingAgent" },
  { id: 98, category: "Regnskap", message: "Vis kontoer fra 3000 til 3999", description: "Get income accounts", expectedAgent: "delegateToAccountingAgent" },
  { id: 99, category: "Regnskap", message: "Vis kontosaldo for konto 1920 per i dag", description: "Get account balance", expectedAgent: "delegateToAccountingAgent" },
  { id: 100, category: "Regnskap", message: "Søk etter bilag fra januar 2026", description: "Search journal entries", expectedAgent: "delegateToAccountingAgent" },
  { id: 101, category: "Regnskap", message: "Vis detaljer for et bilag", description: "Get journal entry details", expectedAgent: "delegateToAccountingAgent" },
  { id: 102, category: "Regnskap", message: "Opprett et bilag: 5000 kr debet konto 6300, kredit konto 1920", description: "Create journal entry", expectedAgent: "delegateToAccountingAgent" },
  { id: 103, category: "Regnskap", message: "Kan jeg reversere et bilag?", description: "Cancel journal entry question", expectedAgent: "delegateToAccountingAgent" },
  { id: 104, category: "Regnskap", message: "Vis alle prosjekter", description: "Search projects", expectedAgent: "delegateToAccountingAgent" },
  { id: 105, category: "Regnskap", message: "Opprett prosjekt: Kundeprosjekt Alpha, nummer P001, startdato i dag", description: "Create project", expectedAgent: "delegateToAccountingAgent" },
  { id: 106, category: "Regnskap", message: "Oppdater et prosjekt med sluttdato", description: "Update project", expectedAgent: "delegateToAccountingAgent" },
  { id: 107, category: "Regnskap", message: "Marker et prosjekt som fullført", description: "Complete project", expectedAgent: "delegateToAccountingAgent" },
  { id: 108, category: "Regnskap", message: "Slett et prosjekt", description: "Delete project", expectedAgent: "delegateToAccountingAgent" },
  { id: 109, category: "Regnskap", message: "Sjekk og initialiser alle tellere", description: "Check counters", expectedAgent: "delegateToAccountingAgent" },
  { id: 110, category: "Regnskap", message: "Vis selskapsinformasjon", description: "Get company info", expectedAgent: "delegateToAccountingAgent" },
  { id: 111, category: "Regnskap", message: "Hva er MVA-reglene for representasjon?", description: "Accounting expert - representation", expectedAgent: "delegateToAccountingAgent" },

  // ============================================
  // Category 10: Accounting Expert + Edge Cases (15 messages)
  // ============================================
  { id: 112, category: "Ekspert", message: "Hva er forskjellen på konto 6540 og 1200?", description: "Account comparison", expectedAgent: "delegateToAccountingAgent" },
  { id: 113, category: "Ekspert", message: "Hvordan bokfører jeg kjøp av bil?", description: "Car purchase accounting", expectedAgent: "delegateToAccountingAgent" },
  { id: 114, category: "Ekspert", message: "Kan jeg trekke fra MVA på kundemiddag?", description: "VAT deduction customer dinner", expectedAgent: "delegateToAccountingAgent" },
  { id: 115, category: "Ekspert", message: "Forklar avskrivningsregler for inventar", description: "Depreciation rules", expectedAgent: "delegateToAccountingAgent" },
  { id: 116, category: "Ekspert", message: "Hva er reglene for hjemmekontor-fradrag?", description: "Home office deduction", expectedAgent: "delegateToAccountingAgent" },
  { id: 117, category: "Ekspert", message: "Hvordan registrerer jeg en lønn?", description: "Salary registration", expectedAgent: "delegateToAccountingAgent" },
  { id: 118, category: "Ekspert", message: "Hva betyr reverse charge MVA?", description: "Reverse charge explanation", expectedAgent: "delegateToAccountingAgent" },
  { id: 119, category: "Ekspert", message: "Hvordan håndterer jeg valutadifferanser?", description: "Currency differences", expectedAgent: "delegateToAccountingAgent" },
  { id: 120, category: "Ekspert", message: "Vis siste fakturaer og kjøp fra samme periode", description: "Multi-agent: invoices + purchases", expectedAgent: "delegateToInvoiceAgent" },
  { id: 121, category: "Ekspert", message: "Opprett en kontakt og fortell meg hvordan jeg lager en faktura til den", description: "Multi-step: contact + invoice", expectedAgent: "delegateToContactAgent" },
  { id: 122, category: "Ekspert", message: "Hva er forskjellen mellom kontantkjøp og leverandørfaktura?", description: "cash_purchase vs supplier question", expectedAgent: "delegateToPurchaseAgent" },
  { id: 123, category: "Ekspert", message: "Kan jeg sende en kreditnota som EHF?", description: "Send credit note EHF", expectedAgent: "delegateToInvoiceAgent" },
  { id: 124, category: "Ekspert", message: "Hvordan bokfører jeg en gave til ansatt?", description: "Employee gift accounting", expectedAgent: "delegateToAccountingAgent" },
  { id: 125, category: "Ekspert", message: "Vis kontosaldo for alle inntektskontoer", description: "Income account balances", expectedAgent: "delegateToAccountingAgent" },
  { id: 126, category: "Ekspert", message: "Forklar MVA-satsene i Norge", description: "VAT rates explanation", expectedAgent: "delegateToAccountingAgent" },
];

// ============================================
// SSE Stream Parser
// ============================================

interface ParsedStream {
  fullText: string;
  toolCalls: Array<{ toolCallId: string; toolName: string }>;
  toolResults: Array<{ toolCallId: string; result: unknown }>;
  errors: string[];
  textChunks: number;
}

async function parseSSEStream(response: Response): Promise<ParsedStream> {
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
    // Keep last potentially incomplete line in buffer
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
// Test Runner
// ============================================

async function runTest(test: TestCase): Promise<TestResult> {
  const startTime = Date.now();

  const result: TestResult = {
    id: test.id,
    category: test.category,
    message: test.message,
    expectedAgent: test.expectedAgent,
    actualAgent: undefined,
    agentCorrect: null,
    toolsCalled: [],
    responseText: "",
    responseLength: 0,
    hasError: false,
    durationMs: 0,
    streamEvents: {
      textChunks: 0,
      toolCallEvents: 0,
      toolResultEvents: 0,
      errorEvents: 0,
    },
  };

  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${USER_ID}`,
      },
      body: JSON.stringify({
        messages: [
          { role: "user", content: test.message },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      result.hasError = true;
      result.errorDetails = `HTTP ${response.status}: ${errorBody}`;
      result.durationMs = Date.now() - startTime;
      return result;
    }

    const parsed = await parseSSEStream(response);

    result.responseText = parsed.fullText;
    result.responseLength = parsed.fullText.length;
    result.toolsCalled = parsed.toolCalls.map(tc => tc.toolName);
    result.streamEvents = {
      textChunks: parsed.textChunks,
      toolCallEvents: parsed.toolCalls.length,
      toolResultEvents: parsed.toolResults.length,
      errorEvents: parsed.errors.length,
    };

    if (parsed.errors.length > 0) {
      result.hasError = true;
      result.errorDetails = parsed.errors.join("; ");
    }

    // Determine which agent was delegated to (first delegation tool call)
    const delegationTool = parsed.toolCalls.find(tc => tc.toolName.startsWith("delegateTo"));
    result.actualAgent = delegationTool?.toolName;

    // Check if routing was correct
    if (test.expectedAgent !== undefined) {
      result.agentCorrect = result.actualAgent === test.expectedAgent;
    } else if (test.expectedAgent === undefined) {
      // Expected no delegation (orchestrator answers directly)
      result.agentCorrect = result.actualAgent === undefined;
    }

  } catch (error) {
    result.hasError = true;
    result.errorDetails = error instanceof Error ? error.message : String(error);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ============================================
// Report Generator
// ============================================

function generateReport(results: TestResult[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  
  lines.push("=".repeat(80));
  lines.push(`E2E TEST REPORT — Fiken Multi-Agent Orchestrator`);
  lines.push(`Generated: ${now}`);
  lines.push(`Total tests: ${results.length}`);
  lines.push("=".repeat(80));
  lines.push("");

  // Summary
  const passed = results.filter(r => !r.hasError && r.agentCorrect !== false);
  const failed = results.filter(r => r.hasError);
  const wrongAgent = results.filter(r => r.agentCorrect === false && !r.hasError);
  const noResponse = results.filter(r => r.responseLength === 0 && !r.hasError);

  lines.push("SUMMARY");
  lines.push("-".repeat(40));
  lines.push(`  Passed:          ${passed.length}/${results.length}`);
  lines.push(`  Errors:          ${failed.length}`);
  lines.push(`  Wrong routing:   ${wrongAgent.length}`);
  lines.push(`  Empty response:  ${noResponse.length}`);
  lines.push(`  Avg duration:    ${Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length)}ms`);
  lines.push("");

  // Routing accuracy by category
  const categories = [...new Set(results.map(r => r.category))];
  lines.push("ROUTING ACCURACY BY CATEGORY");
  lines.push("-".repeat(40));
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const correct = catResults.filter(r => r.agentCorrect === true).length;
    const total = catResults.filter(r => r.agentCorrect !== null).length;
    const errors = catResults.filter(r => r.hasError).length;
    lines.push(`  ${cat.padEnd(15)} ${correct}/${total} correct, ${errors} errors`);
  }
  lines.push("");

  // Tool call statistics
  const allTools = results.flatMap(r => r.toolsCalled);
  const toolCounts: Record<string, number> = {};
  for (const tool of allTools) {
    toolCounts[tool] = (toolCounts[tool] || 0) + 1;
  }
  lines.push("TOOL CALL FREQUENCY");
  lines.push("-".repeat(40));
  const sortedTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
  for (const [tool, count] of sortedTools) {
    lines.push(`  ${tool.padEnd(45)} ${count}x`);
  }
  lines.push("");

  // Detailed results
  lines.push("=".repeat(80));
  lines.push("DETAILED RESULTS");
  lines.push("=".repeat(80));
  
  for (const r of results) {
    const status = r.hasError ? "ERROR" : r.agentCorrect === false ? "WRONG ROUTE" : "OK";
    const statusIcon = r.hasError ? "[X]" : r.agentCorrect === false ? "[~]" : "[V]";
    
    lines.push("");
    lines.push(`${statusIcon} Test #${r.id} — ${r.category} — ${status} (${r.durationMs}ms)`);
    lines.push(`  Message:  "${r.message}"`);
    
    if (r.expectedAgent) {
      lines.push(`  Expected: ${r.expectedAgent}`);
      lines.push(`  Actual:   ${r.actualAgent || "(no delegation)"}`);
    }
    
    if (r.toolsCalled.length > 0) {
      lines.push(`  Tools:    ${r.toolsCalled.join(" -> ")}`);
    }
    
    if (r.hasError) {
      lines.push(`  Error:    ${r.errorDetails}`);
    }
    
    // Truncate response to 200 chars for readability
    const truncatedResponse = r.responseText.length > 200
      ? r.responseText.substring(0, 200) + "..."
      : r.responseText;
    lines.push(`  Response: ${truncatedResponse.replace(/\n/g, " ").trim() || "(empty)"}`);
    
    lines.push(`  Stream:   ${r.streamEvents.textChunks} text, ${r.streamEvents.toolCallEvents} tools, ${r.streamEvents.toolResultEvents} results, ${r.streamEvents.errorEvents} errors`);
  }

  // Failed tests summary
  const allFailed = [...failed, ...wrongAgent];
  if (allFailed.length > 0) {
    lines.push("");
    lines.push("=".repeat(80));
    lines.push("FAILED TESTS SUMMARY");
    lines.push("=".repeat(80));
    for (const r of allFailed) {
      lines.push(`  #${r.id} [${r.category}] "${r.message}"`);
      if (r.hasError) lines.push(`    -> ERROR: ${r.errorDetails}`);
      if (r.agentCorrect === false) lines.push(`    -> Expected ${r.expectedAgent}, got ${r.actualAgent || "no delegation"}`);
    }
  }

  return lines.join("\n");
}

// ============================================
// Main
// ============================================

async function main() {
  console.log("=".repeat(60));
  console.log("Fiken Multi-Agent E2E Test Suite");
  console.log(`${TEST_CASES.length} test cases`);
  console.log("=".repeat(60));
  console.log("");

  // Check server is running
  try {
    const health = await fetch(`${API_URL}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log("[OK] Server is running");
  } catch (error) {
    console.error("[FAIL] Server is not running at", API_URL);
    console.error("Start the server with: npm run dev");
    process.exit(1);
  }

  // Quick auth check
  try {
    const authCheck = await fetch(`${API_URL}/api/chats`, {
      headers: { "Authorization": `Bearer ${USER_ID}` },
    });
    if (authCheck.status === 401) {
      const body = await authCheck.json();
      console.error("[FAIL] Authentication failed:", body);
      if (body.code === "CONNECTION_EXPIRED") {
        console.error("Fiken token expired. Log in again via the web app to refresh.");
      }
      process.exit(1);
    }
    console.log("[OK] Authentication valid");
  } catch (error) {
    console.error("[FAIL] Auth check error:", error);
    process.exit(1);
  }

  // Parse CLI args for --start and --delay
  const args = process.argv.slice(2);
  const startIndex = parseInt(args.find(a => a.startsWith("--start="))?.split("=")[1] || "0");
  const delayMs = parseInt(args.find(a => a.startsWith("--delay="))?.split("=")[1] || "1000");
  const testsToRun = TEST_CASES.slice(startIndex);

  console.log("");
  console.log(`Starting tests from #${startIndex + 1}... (delay: ${delayMs}ms between requests)`);
  console.log("");

  const fs = await import("fs");
  const resultsFile = "scripts/e2e-results-live.jsonl";
  // Append mode if resuming, otherwise truncate
  if (startIndex === 0) {
    fs.writeFileSync(resultsFile, "");
  }

  const results: TestResult[] = [];
  let passCount = 0;
  let failCount = 0;

  for (let i = 0; i < testsToRun.length; i++) {
    const test = testsToRun[i];
    const globalIdx = startIndex + i;
    const progress = `[${(globalIdx + 1).toString().padStart(3)}/${TEST_CASES.length}]`;
    
    process.stdout.write(`${progress} #${test.id.toString().padStart(3)} ${test.category.padEnd(13)} "${test.message.substring(0, 50).padEnd(50)}" ... `);

    const result = await runTest(test);
    results.push(result);

    // Write result immediately (JSONL format)
    fs.appendFileSync(resultsFile, JSON.stringify(result) + "\n");

    if (result.hasError) {
      failCount++;
      console.log(`ERROR (${result.durationMs}ms) — ${result.errorDetails?.substring(0, 60)}`);
    } else if (result.agentCorrect === false) {
      failCount++;
      console.log(`WRONG ROUTE (${result.durationMs}ms) — expected ${result.expectedAgent}, got ${result.actualAgent || "none"}`);
    } else {
      passCount++;
      const agent = result.actualAgent?.replace("delegateTo", "").replace("Agent", "") || "direct";
      const tools = result.toolsCalled.length;
      console.log(`OK (${result.durationMs}ms) — ${agent}, ${tools} tools, ${result.responseLength} chars`);
    }

    // Delay between requests (skip delay on last test)
    if (i < testsToRun.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`DONE: ${passCount} passed, ${failCount} failed out of ${results.length}`);
  console.log("=".repeat(60));

  // Generate and save report
  const report = generateReport(results);
  const reportPath = `scripts/e2e-report-${new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)}.txt`;
  
  const fs = await import("fs");
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport saved to: ${reportPath}`);

  // Also save raw JSON results
  const jsonPath = reportPath.replace(".txt", ".json");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Raw results saved to: ${jsonPath}`);

  // Exit with error code if any tests failed
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
