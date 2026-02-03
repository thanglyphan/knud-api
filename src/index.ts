import express from "express";
import cors from "cors";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import dotenv from "dotenv";
import { ACCOUNTING_SYSTEM_PROMPT, FIKEN_SYSTEM_PROMPT, TRIPLETEX_SYSTEM_PROMPT } from "./prompts.js";
import { prisma } from "./db.js";
import chatRoutes from "./routes/chat.js";
import authRoutes from "./routes/auth.js";
import configRoutes from "./routes/config.js";
import stripeRoutes, { handleWebhook } from "./routes/stripe.js";
import { requireAuth, requireAccountingConnection } from "./middleware/auth.js";
import { createFikenClient } from "./fiken/client.js";
import { createFikenTools } from "./fiken/tools/index.js";
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

// Chat CRUD routes
app.use("/api/chats", chatRoutes);

// Financial summary endpoint (requires auth + accounting connection)
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
      // Tripletex financial summary - show payroll summary for current month
      const tripletexClient = createTripletexClient(req.accountingAccessToken!, req.companyId!);
      
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1; // JavaScript months are 0-indexed
      
      try {
        const payrollSummary = await tripletexClient.getPayrollSummary(year, month);
        res.json({
          provider: "tripletex",
          period: `${year}-${String(month).padStart(2, '0')}`,
          payroll: {
            grossSalary: payrollSummary.totals.grossSalary,
            taxDeduction: payrollSummary.totals.taxDeduction,
            payrollTax: payrollSummary.totals.payrollTax,
            netPaid: payrollSummary.totals.netPaid,
            employeeCount: payrollSummary.employees.length,
          },
        });
      } catch {
        // If no payroll data, return empty summary
        res.json({
          provider: "tripletex",
          period: `${year}-${String(month).padStart(2, '0')}`,
          payroll: null,
          message: "Ingen lønnsdata for denne perioden",
        });
      }
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
      // Create Fiken client and tools
      const fikenClient = createFikenClient(req.accountingAccessToken!, req.companyId!);
      tools = createFikenTools(fikenClient, req.companyId!, files);
      baseSystemPrompt = FIKEN_SYSTEM_PROMPT;
    } else if (provider === "tripletex") {
      // Create Tripletex client and tools
      const tripletexClient = createTripletexClient(req.accountingAccessToken!, req.companyId!);
      tools = createTripletexTools(tripletexClient, req.companyId!);
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

**DU MÅ LASTE OPP ${files.length > 1 ? 'ALLE FILENE' : 'FILEN'}!** Følg disse stegene:
1. Først: Opprett kjøpet/salget/bilaget med riktig verktøy (createPurchase, createSale, etc.)
2. Deretter: Last opp ${files.length > 1 ? 'alle filene' : 'filen'} med uploadAttachmentToPurchase(purchaseId), uploadAttachmentToSale(saleId), etc.
   - Verktøyet laster opp ALLE vedlagte filer automatisk i én operasjon.

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
          > = [
            { 
              type: "text", 
              text: `${textContent}\n\n📎 **Vedlagte filer (${files.length} stk):** ${fileNames}\n[ANALYSER ALLE vedlagte bilder/filer. Hvis FLERE kvitteringer/fakturaer: 1) Les av info fra HVER fil separat 2) Presenter ALLE i nummerert oversikt (Fil 1, Fil 2, osv.) 3) Sjekk om noen filer ser ut til å være SAMME kvittering - spør brukeren! 4) Spør om alle skal registreres som separate kjøp 5) La brukeren velge om alle skal ha samme konto. For HVER fil: Identifiser leverandør, dato, beløp, MVA, beskrivelse, betalingsstatus. ⛔ IKKE spør om inkl/ekskl MVA hvis du ser MVA-info! 📌 ALLTID spør hvilken bankkonto for betalte kjøp!]` 
            }
          ];
          
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
      maxSteps: 10,
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
      res.write(`0:"\\n\\n❌ Det oppstod en feil: ${escapedError}"\n`);
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
      res.write(`0:"\\n\\n❌ Det oppstod en feil: ${escapedError}"\n`);
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
