import express from "express";
import cors from "cors";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import dotenv from "dotenv";
import { ACCOUNTING_SYSTEM_PROMPT, FIKEN_SYSTEM_PROMPT, TRIPLETEX_SYSTEM_PROMPT } from "./prompts.js";
import { prisma } from "./db.js";
import chatRoutes from "./routes/chat.js";
import authRoutes from "./routes/auth.js";
import stripeRoutes, { handleWebhook } from "./routes/stripe.js";
import { requireAuth, requireAccountingConnection } from "./middleware/auth.js";
import { createFikenClient } from "./fiken/client.js";
import { createFikenTools } from "./fiken/tools/index.js";
import { createTripletexClient } from "./tripletex/client.js";
import { createTripletexCapabilities } from "./tripletex/capabilities/index.js";
import type { ChatRequest } from "./types.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ["http://localhost:8080", "http://localhost:8085", "http://localhost:5173", "http://localhost:3000"],
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
      // Tripletex doesn't have a direct financial summary endpoint
      // TODO: Implement aggregated summary from Tripletex data
      res.json({
        message: "Finansoversikt er ikke tilgjengelig for Tripletex ennå",
        provider: "tripletex",
      });
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

// Chat endpoint with accounting integration (requires auth + accounting connection)
// Supports both Fiken and Tripletex based on user's activeProvider
app.post("/api/chat", requireAuth, requireAccountingConnection, async (req, res) => {
  try {
    const { messages, chatId, file } = req.body as ChatRequest & { 
      chatId?: string;
      file?: { name: string; type: string; data: string };
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages array is required" });
      return;
    }

    const provider = req.accountingProvider;

    // Log file info for debugging
    if (file) {
      console.log("File attached:", { name: file.name, type: file.type, dataLength: file.data?.length });
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
      tools = createFikenTools(fikenClient, req.companyId!, file);
      baseSystemPrompt = FIKEN_SYSTEM_PROMPT;
    } else if (provider === "tripletex") {
      // Create Tripletex client and capabilities
      const tripletexClient = createTripletexClient(req.accountingAccessToken!, req.companyId!);
      
      // Create Tripletex capabilities (capability-based architecture: 2 tools instead of 29)
      tools = createTripletexCapabilities(tripletexClient);
      
      console.log(`[Tripletex] Loaded ${Object.keys(tools).length} capabilities: ${Object.keys(tools).join(", ")}`);
      
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

    // If there's a file attached, tell the AI about it
    if (file) {
      if (provider === "fiken") {
        systemPromptWithDate += `

## VEDLAGT FIL - HANDLING PÅKREVD!
Brukeren har vedlagt en fil til DENNE meldingen:
- Filnavn: ${file.name}
- Filtype: ${file.type}

**DU MÅ LASTE OPP DENNE FILEN!** Følg disse stegene:
1. Først: Opprett kjøpet/salget/bilaget med riktig verktøy (createPurchase, createSale, etc.)
2. Deretter: Last opp filen med uploadAttachmentToPurchase(purchaseId), uploadAttachmentToSale(saleId), etc.

IKKE spør brukeren om å sende filen på nytt - filen ER allerede vedlagt og klar til opplasting!`;
      } else if (provider === "tripletex") {
        systemPromptWithDate += `

## VEDLAGT FIL - HANDLING PÅKREVD!
Brukeren har vedlagt en fil til DENNE meldingen:
- Filnavn: ${file.name}
- Filtype: ${file.type}

**DU MÅ LASTE OPP DENNE FILEN!** Følg disse stegene:
1. Først: Opprett leverandørfakturaen/ordren/bilaget med riktig verktøy
2. Deretter: Last opp dokumentet med uploadDocument-verktøyet

IKKE spør brukeren om å sende filen på nytt - filen ER allerede vedlagt og klar til opplasting!`;
      }
    }

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
  console.log(`Chat endpoint (with Fiken/Tripletex): POST http://localhost:${PORT}/api/chat`);
  console.log(`Chat endpoint (simple): POST http://localhost:${PORT}/api/chat/simple`);
  console.log(`Chats CRUD: http://localhost:${PORT}/api/chats`);
});
