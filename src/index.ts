import express from "express";
import cors from "cors";
import { openai } from "@ai-sdk/openai";
import { streamText, generateText } from "ai";
import dotenv from "dotenv";
import { ACCOUNTING_SYSTEM_PROMPT, FIKEN_SYSTEM_PROMPT, TRIPLETEX_SYSTEM_PROMPT } from "./prompts.js";
import { prisma } from "./db.js";
import chatRoutes from "./routes/chat.js";
import authRoutes from "./routes/auth.js";
import configRoutes from "./routes/config.js";
import stripeRoutes, { handleWebhook } from "./routes/stripe.js";
import subscribeRoutes from "./routes/subscribe.js";
import { requireAuth, requireAccountingConnection } from "./middleware/auth.js";
import { createFikenClient } from "./fiken/client.js";
import { createFikenTools } from "./fiken/tools/index.js";
import { 
  createFikenAgentSystem,
  ORCHESTRATOR_PROMPT,
  type FikenAgentType,
  type DelegationRequest,
} from "./fiken/tools/agents/index.js";
import { createTripletexClient } from "./tripletex/client.js";
import { createTripletexTools } from "./tripletex/tools/index.js";
import { convertPdfToImages } from "./utils/pdfToImage.js";

import type { ChatRequest } from "./types.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration
const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:8085", 
  "http://localhost:5173",
  "http://localhost:3000",
];

// Add production frontend URL if configured
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Stripe webhook needs raw body (before json parser)
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleWebhook);

app.use(express.json({ limit: "15mb" })); // Increased limit for file uploads (base64)

// Health check endpoint
app.get("/health", async (_req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      database: "connected",
    });
  } catch {
    res.status(503).json({ 
      status: "error", 
      timestamp: new Date().toISOString(),
      database: "disconnected",
    });
  }
});

// Auth routes (public)
app.use("/api/auth", authRoutes);

// Config routes (public - feature flags)
app.use("/api/config", configRoutes);

// Stripe routes (products is public, others require auth)
app.use("/api/stripe", stripeRoutes);

// Subscribe routes (public - email subscription for accounting system notifications)
app.use("/api/subscribe", subscribeRoutes);

// Chat CRUD routes
app.use("/api/chats", chatRoutes);

// Financial summary endpoint (requires auth + accounting connection)
// Note: Only supported for Fiken. Tripletex returns null (not implemented).
app.get("/api/financial-summary", requireAuth, requireAccountingConnection, async (req, res) => {
  try {
    const provider = req.accountingProvider;
    
    if (provider === "fiken") {
      // Create Fiken client for this user
      const fikenClient = createFikenClient(req.accountingAccessToken!, req.companyId!);
      
      // Get current year date range
      const year = new Date().getFullYear();
      const fromDate = `${year}-01-01`;
      const toDate = new Date().toISOString().split("T")[0];
      
      const summary = await fikenClient.getFinancialSummary(fromDate, toDate);
      res.json(summary);
    } else if (provider === "tripletex") {
      // Tripletex: Financial summary not implemented - return null
      res.json(null);
    } else {
      res.status(400).json({ error: "Ukjent regnskapssystem" });
    }
  } catch (error) {
    console.error("Financial summary error:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Kunne ikke hente finansoversikt" 
    });
  }
});

// Tripletex: Download payslip as PDF
app.get("/api/tripletex/payslip/:id/pdf", requireAuth, requireAccountingConnection, async (req, res) => {
  try {
    const provider = req.accountingProvider;
    
    if (provider !== "tripletex") {
      res.status(400).json({ error: "Dette endepunktet er kun for Tripletex" });
      return;
    }

    const payslipId = parseInt(req.params.id, 10);
    if (isNaN(payslipId)) {
      res.status(400).json({ error: "Ugyldig lønnsslipp-ID" });
      return;
    }

    const tripletexClient = createTripletexClient(req.accountingAccessToken!, req.companyId!);
    
    // Get payslip info for filename
    const payslipInfo = await tripletexClient.getPayslip(payslipId);
    const ps = payslipInfo.value;
    const employeeName = ps.employee 
      ? `${ps.employee.firstName}_${ps.employee.lastName}`.replace(/\s+/g, "_") 
      : "ukjent";
    const period = `${ps.year}-${String(ps.month).padStart(2, "0")}`;
    const filename = `lonnsslipp_${employeeName}_${period}.pdf`;

    // Download PDF
    const pdfBuffer = await tripletexClient.getPayslipPdf(payslipId);
    
    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Payslip PDF download error:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Kunne ikke laste ned lønnsslipp PDF" 
    });
  }
});

// Chat endpoint with accounting integration (requires auth + accounting connection)
// Supports both Fiken and Tripletex based on user's activeProvider
app.post("/api/chat", requireAuth, requireAccountingConnection, async (req, res) => {
  try {
    const { messages, chatId, files } = req.body as ChatRequest & { 
      chatId?: string;
      files?: Array<{ name: string; type: string; data: string }>;
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages array is required" });
      return;
    }

    const provider = req.accountingProvider;

    // Log file info for debugging
    if (files && files.length > 0) {
      console.log(`${files.length} file(s) attached:`, files.map(f => ({ name: f.name, type: f.type, dataLength: f.data?.length })));
    }

    // Get current date in Norwegian format
    const today = new Date();
    const dateStr = today.toLocaleDateString("no-NO", { 
      weekday: "long", 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });
    const isoDate = today.toISOString().split("T")[0];
    
    // Initialize provider-specific variables
    let tools;
    let baseSystemPrompt: string;
    
    if (provider === "fiken") {
      // Create Fiken client
      const fikenClient = createFikenClient(req.accountingAccessToken!, req.companyId!);
      
      // Use multi-agent system with orchestrator
      const agentSystem = createFikenAgentSystem({
        client: fikenClient,
        companySlug: req.companyId!,
        pendingFiles: files?.map(f => ({ name: f.name, type: f.type, data: f.data })),
      });
      
      // Wire up delegation handler - when orchestrator delegates to an agent,
      // we run a separate generateText() call with that agent's tools and prompt.
      // We pass the full conversation history so sub-agents retain context.
      agentSystem.setDelegationHandler(async (request: DelegationRequest) => {
        const agentType = request.toAgent;
        const agentTools = agentSystem.getAgentTools(agentType);
        const agentPrompt = agentSystem.getAgentPrompt(agentType);
        
        console.log(`[Agent] Delegating to ${agentType}: "${request.task}"`);
        
        // Build messages array with conversation history + delegation task
        // This gives the sub-agent full context of what the user has said
        const agentMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
        
        // Include conversation history (simplified to text only)
        for (const msg of processedMessages) {
          const content = typeof msg.content === "string" 
            ? msg.content 
            : Array.isArray(msg.content)
              ? msg.content.filter((p: { type: string }) => p.type === "text").map((p: { type: string; text?: string }) => p.text || "").join("\n")
              : String(msg.content);
          if (content.trim()) {
            agentMessages.push({
              role: msg.role as "user" | "assistant",
              content,
            });
          }
        }
        
        // Add the delegation task as final user message
        agentMessages.push({
          role: "user",
          content: `[Delegert oppgave fra orchestrator]: ${request.task}${request.context ? `\n\nKontekst: ${JSON.stringify(request.context)}` : ""}`,
        });
        
        try {
          const agentResult = await generateText({
            model: openai("gpt-4.1-mini"),
            system: `${agentPrompt}

## DAGENS DATO
I dag er ${dateStr} (${isoDate}).
Bruk denne datoen som referanse for alle datoer.

## KONTEKST FRA ORCHESTRATOR
Du ble delegert en oppgave av hovedagenten. Du har tilgang til hele samtalehistorikken for kontekst.
Bruk informasjon fra tidligere meldinger for å fullføre oppgaven.`,
            messages: agentMessages,
            tools: agentTools as Parameters<typeof generateText>[0]["tools"],
            maxSteps: 15,
            toolChoice: "auto",
            onStepFinish: ({ stepType, toolCalls, toolResults }) => {
              console.log(`[Agent:${agentType}] Step: ${stepType}`);
              if (toolCalls?.length) {
                // Emit tool call info to the stream so frontend can show it
                const toolNames = toolCalls.map((tc: { toolName: string }) => tc.toolName).join(", ");
                console.log(`[Agent:${agentType}] Tools: ${toolNames}`);
              }
            },
          });
          
          console.log(`[Agent:${agentType}] Completed. Response length: ${agentResult.text.length}`);
          
          // Check if any tool results indicate the operation is complete
          // or that files were uploaded — propagate both to the orchestrator result
          const completedOps: string[] = [];
          let filesUploaded = false;
          for (const step of (agentResult as any).steps || []) {
            for (const result of step.toolResults || []) {
              const r = result.result as Record<string, unknown> | undefined;
              if (r && r._operationComplete) {
                completedOps.push(result.toolName as string);
              }
              if (r && r.fileUploaded) {
                filesUploaded = true;
              }
            }
          }
          
          const resultText = completedOps.length > 0
            ? `${agentResult.text}\n\n[Operasjoner fullført: ${completedOps.join(", ")}. Ikke deleger denne oppgaven på nytt.]`
            : agentResult.text;
          
          return {
            success: true,
            result: resultText,
            fromAgent: agentType,
            // Propagate fileUploaded so the frontend can clear pending files
            ...(filesUploaded && { fileUploaded: true }),
          };
        } catch (error) {
          console.error(`[Agent:${agentType}] Error:`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Agent-feil",
            fromAgent: agentType,
          };
        }
      });
      
      tools = agentSystem.orchestrator.tools;
      baseSystemPrompt = agentSystem.orchestrator.prompt;
    } else if (provider === "tripletex") {
      // Create Tripletex client and tools
      const tripletexClient = createTripletexClient(req.accountingAccessToken!, req.companyId!);
      tools = createTripletexTools(tripletexClient, req.companyId!, files);
      baseSystemPrompt = TRIPLETEX_SYSTEM_PROMPT;
    } else {
      res.status(400).json({ error: "Ukjent regnskapssystem" });
      return;
    }

    // Add current date to system prompt
    let systemPromptWithDate = `${baseSystemPrompt}

## DAGENS DATO
I dag er ${dateStr} (${isoDate}).
Bruk denne datoen som referanse for alle datoer (f.eks. "i dag", "denne måneden", "i år").`;

    // If there are files attached, tell the AI about them
    if (files && files.length > 0) {
      if (provider === "fiken") {
        const fileList = files.map((f, i) => `${i + 1}. ${f.name} (${f.type})`).join('\n');
        systemPromptWithDate += `

## VEDLAGTE FILER (${files.length} stk) - HANDLING PÅKREVD!
Brukeren har vedlagt følgende fil${files.length > 1 ? 'er' : ''} til DENNE meldingen:
${fileList}

**DU MÅ SØRGE FOR AT ${files.length > 1 ? 'ALLE FILENE' : 'FILEN'} BLIR LASTET OPP!**
Deleger HELE oppgaven (opprettelse + filopplasting) til riktig agent i ÉN ENKELT delegering.
Agenten har verktøy for å både opprette (createPurchase, createSale, etc.) og laste opp vedlegg (uploadAttachmentToPurchase, etc.).
⚠️ VIKTIG: IKKE deleger to ganger (én for opprettelse, én for opplasting) - det vil opprette duplikater!

IKKE spør brukeren om å sende fil${files.length > 1 ? 'ene' : 'en'} på nytt - ${files.length > 1 ? 'filene ER' : 'filen ER'} allerede vedlagt og klar${files.length > 1 ? 'e' : ''} til opplasting!`;
      }
    }

    // Set headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Process messages - add file info and images to user message if files are attached
    type MessageContent = 
      | string 
      | Array<{ type: "text"; text: string } | { type: "image"; image: string }>;
    
    let processedMessages: Array<{
      role: "user" | "assistant";
      content: MessageContent;
    }> = messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    // If files are attached, convert to vision format for AI to "see" the content
    if (files && files.length > 0) {
      const lastIndex = processedMessages.length - 1;
      if (lastIndex >= 0 && processedMessages[lastIndex].role === "user") {
        
        const imageDataUrls: string[] = [];
        
        // Process each file - convert PDFs to images, keep images as-is
        for (const file of files) {
          if (file.type.startsWith("image/") && file.data) {
            // Images can be used directly
            imageDataUrls.push(file.data);
            console.log(`[Vision] Added image: ${file.name}`);
          } else if (file.type === "application/pdf" && file.data) {
            // Convert PDF to images (max 2 pages)
            try {
              const pdfImages = await convertPdfToImages(file.data);
              imageDataUrls.push(...pdfImages);
              console.log(`[Vision] Converted PDF ${file.name} to ${pdfImages.length} image(s)`);
            } catch (err) {
              console.error(`[Vision] Failed to convert PDF ${file.name}:`, err);
              // Continue without this file's images
            }
          }
        }
        
        const fileNames = files.map(f => f.name).join(", ");
        const textContent = processedMessages[lastIndex].content as string;
        
        if (imageDataUrls.length > 0) {
          // Convert to multi-modal format for vision
          const contentParts: Array<
            | { type: "text"; text: string }
            | { type: "image"; image: string }
          > = [];
          
          // Provider-specific file instructions
          let fileInstructions: string;
          if (provider === "fiken") {
            // Fiken: Ask user about accounts, bank accounts, etc.
            fileInstructions = `[ANALYSER ALLE vedlagte bilder/filer. Hvis FLERE kvitteringer/fakturaer: 1) Les av info fra HVER fil separat 2) Presenter ALLE i nummerert oversikt (Fil 1, Fil 2, osv.) 3) Sjekk om noen filer ser ut til å være SAMME kvittering - spør brukeren! 4) Spør om alle skal registreres som separate kjøp 5) La brukeren velge om alle skal ha samme konto. For HVER fil: Identifiser leverandør, dato, beløp, MVA, beskrivelse, betalingsstatus. ⛔ IKKE spør om inkl/ekskl MVA hvis du ser MVA-info! 📌 ALLTID spør hvilken bankkonto for betalte kjøp!]`;
          } else if (provider === "tripletex") {
            // Tripletex: Smart bank reconciliation + automatic processing
            fileInstructions = `[ANALYSER ALLE ${files.length} vedlagte kvitteringer GRUNDIG.

🏦 STEG 1 - SØK BANKMATCH (for HVER kvittering):
Kall get_unmatched_bank_postings(amount=X, date="YYYY-MM-DD") for å finne matchende banktransaksjoner.

📋 STEG 2 - HÅNDTER RESULTAT:
- INGEN MATCH: Spør "Er dette betalt eller ubetalt?"
- ÉN MATCH: Spør "Fant [dato, beløp, beskrivelse]. Er dette samme kjøp?"
- FLERE MATCHER: Vis nummerert liste, la bruker velge

📝 STEG 3 - REGISTRER:
Kall register_expense med:
- matchedPostingId (hvis bankmatch bekreftet)
- isPaid=true (betalt) eller isPaid=false (ubetalt/faktura)
- counterAccountId (hvis flere bankkontoer og bruker har valgt)

📎 STEG 4 - LAST OPP:
Kall upload_attachment_to_voucher(voucherId, fileIndex=N)

KONTOVALG:
- Taxi/transport/fly/tog → 7140, 12% MVA
- Hotell/overnatting → 7140, 12% MVA  
- Restaurant (internt) → 7350, 15% MVA
- Kundemiddag/representasjon → 7320, 0% MVA
- Kontor/utstyr/rekvisita → 6800, 25% MVA
- Programvare/IT → 6860, 25% MVA
- Telefon/internett → 7700, 25% MVA

${files.length > 1 ? `VIKTIG - DU HAR ${files.length} FILER:
Behandle HVER fil separat!
Fil 1 = fileIndex 1, Fil 2 = fileIndex 2, osv.` : ''}

ALDRI spør om kostnadskonto eller MVA-sats - velg selv!
MEN spør om bankmatch og betalt/ubetalt status.]`;
          } else {
            fileInstructions = `[Analyser vedlagte filer]`;
          }
          
          contentParts.push({ 
            type: "text", 
            text: `${textContent}\n\n📎 **Vedlagte filer (${files.length} stk):** ${fileNames}\n${fileInstructions}` 
          });
          
          // Add images (max 4 to avoid token limits)
          const maxImages = Math.min(imageDataUrls.length, 4);
          for (let i = 0; i < maxImages; i++) {
            contentParts.push({
              type: "image",
              image: imageDataUrls[i]
            });
          }
          
          processedMessages[lastIndex] = {
            role: "user",
            content: contentParts
          };
          
          console.log(`[Vision] Added ${maxImages} image(s) to message for AI analysis`);
        } else {
          // No images could be extracted, just add file info as text
          processedMessages[lastIndex] = {
            ...processedMessages[lastIndex],
            content: `${textContent}\n\n📎 **Vedlagte filer (${files.length} stk):** ${fileNames}\n[Filene er klare til opplasting etter at kjøp/salg er opprettet]`
          };
          console.log("[AI] Added file info to user message (no images for vision):", fileNames);
        }
      }
    }

    const result = streamText({
      model: openai("gpt-4.1-mini"),
      system: systemPromptWithDate,
      messages: processedMessages as Parameters<typeof streamText>[0]["messages"],
      tools,
      maxSteps: 25, // Increased to support multiple receipts (each needs register + upload)
      toolChoice: "auto", // Ensure tool calling is enabled
      onStepFinish: ({ stepType, toolCalls, toolResults }) => {
        console.log(`[AI] Step finished: ${stepType}`);
        if (toolCalls && toolCalls.length > 0) {
          console.log(`[AI] Tool calls:`, JSON.stringify(toolCalls, null, 2));
        }
        if (toolResults && toolResults.length > 0) {
          console.log(`[AI] Tool results:`, JSON.stringify(toolResults, null, 2).substring(0, 1000));
        }
      },
    });

    // Stream the response using Vercel AI SDK format
    const stream = result.toDataStream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);

      // Extract text content from the stream for saving to DB
      const lines = chunk.split("\n").filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^0:"(.*)"/);
        if (match) {
          const content = match[1]
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
          fullResponse += content;
        }
      }
    }

    // Save assistant response to database if chatId is provided
    if (chatId && fullResponse) {
      try {
        await prisma.message.create({
          data: {
            chatId,
            role: "assistant",
            content: fullResponse,
          },
        });
        
        // Update chat timestamp
        await prisma.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });
      } catch (dbError) {
        console.error("Failed to save assistant message to DB:", dbError);
      }
    }

    res.end();
  } catch (error) {
    console.error("Chat error:", error);
    
    // If headers haven't been sent, send JSON error
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Failed to process chat request",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    } else {
      // Headers already sent (streaming started), send error in stream format
      const errorMsg = error instanceof Error ? error.message : "Ukjent feil";
      const escapedError = errorMsg.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      // Send error as text content so the user sees it, plus an error event for the frontend
      res.write(`0:"\\n\\nBeklager, det oppstod en feil. Prøv gjerne igjen."\n`);
      res.write(`e:{"error":"${escapedError}"}\n`);
      res.end();
    }
  }
});

// Simple chat endpoint without Fiken (for general accounting questions)
app.post("/api/chat/simple", async (req, res) => {
  try {
    const { messages, chatId } = req.body as ChatRequest & { chatId?: string };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages array is required" });
      return;
    }

    // Get current date in Norwegian format
    const today = new Date();
    const dateStr = today.toLocaleDateString("no-NO", { 
      weekday: "long", 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });
    const isoDate = today.toISOString().split("T")[0];
    
    // Add current date to system prompt
    const systemPromptWithDate = `${ACCOUNTING_SYSTEM_PROMPT}

## DAGENS DATO
I dag er ${dateStr} (${isoDate}).
Bruk denne datoen som referanse for alle datoer.`;

    // Set headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const result = streamText({
      model: openai("gpt-4.1-mini"),
      system: systemPromptWithDate,
      messages: messages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      maxSteps: 5,
    });

    // Stream the response using Vercel AI SDK format
    const stream = result.toDataStream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);

      // Extract text content from the stream for saving to DB
      const lines = chunk.split("\n").filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^0:"(.*)"/);
        if (match) {
          const content = match[1]
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
          fullResponse += content;
        }
      }
    }

    // Save assistant response to database if chatId is provided
    if (chatId && fullResponse) {
      try {
        await prisma.message.create({
          data: {
            chatId,
            role: "assistant",
            content: fullResponse,
          },
        });
        
        // Update chat timestamp
        await prisma.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });
      } catch (dbError) {
        console.error("Failed to save assistant message to DB:", dbError);
      }
    }

    res.end();
  } catch (error) {
    console.error("Chat error:", error);
    
    // If headers haven't been sent, send JSON error
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Failed to process chat request",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    } else {
      // Headers already sent (streaming started), send error in stream format
      const errorMsg = error instanceof Error ? error.message : "Ukjent feil";
      const escapedError = errorMsg.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      res.write(`0:"\\n\\nBeklager, det oppstod en feil. Prøv gjerne igjen."\n`);
      res.write(`e:{"error":"${escapedError}"}\n`);
      res.end();
    }
  }
});

// Non-streaming chat endpoint (for testing)
app.post("/api/chat/sync", async (req, res) => {
  try {
    const { messages, chatId } = req.body as ChatRequest & { chatId?: string };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages array is required" });
      return;
    }

    // Get current date in Norwegian format
    const today = new Date();
    const dateStr = today.toLocaleDateString("no-NO", { 
      weekday: "long", 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });
    const isoDate = today.toISOString().split("T")[0];
    
    // Add current date to system prompt
    const systemPromptWithDate = `${ACCOUNTING_SYSTEM_PROMPT}

## DAGENS DATO
I dag er ${dateStr} (${isoDate}).
Bruk denne datoen som referanse for alle datoer.`;

    const result = await streamText({
      model: openai("gpt-4.1-mini"),
      system: systemPromptWithDate,
      messages: messages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      maxSteps: 5,
    });

    const text = await result.text;

    // Save to database if chatId is provided
    if (chatId) {
      await prisma.message.create({
        data: {
          chatId,
          role: "assistant",
          content: text,
        },
      });
    }

    res.json({ 
      role: "assistant",
      content: text 
    });
  } catch (error) {
    console.error("Chat sync error:", error);
    res.status(500).json({ 
      error: "Failed to process chat request",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Knud API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Auth endpoints: http://localhost:${PORT}/api/auth/*`);
  console.log(`Stripe endpoints: http://localhost:${PORT}/api/stripe/*`);
  console.log(`Chat endpoint (with Fiken): POST http://localhost:${PORT}/api/chat`);
  console.log(`Chat endpoint (simple): POST http://localhost:${PORT}/api/chat/simple`);
  console.log(`Chats CRUD: http://localhost:${PORT}/api/chats`);
});
