import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

// GET /api/chats - List all chats
router.get("/", async (_req, res) => {
  try {
    const chats = await prisma.chat.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    res.json(chats);
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// GET /api/chats/:id - Get a single chat with messages
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const chat = await prisma.chat.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    res.json(chat);
  } catch (error) {
    console.error("Error fetching chat:", error);
    res.status(500).json({ error: "Failed to fetch chat" });
  }
});

// POST /api/chats - Create a new chat
router.post("/", async (req, res) => {
  try {
    const { title, userId } = req.body;

    const chat = await prisma.chat.create({
      data: {
        title: title || "Ny samtale",
        userId: userId || null,
      },
    });

    res.status(201).json(chat);
  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({ error: "Failed to create chat" });
  }
});

// PATCH /api/chats/:id - Update a chat (e.g., title)
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const chat = await prisma.chat.update({
      where: { id },
      data: { title },
    });

    res.json(chat);
  } catch (error) {
    console.error("Error updating chat:", error);
    res.status(500).json({ error: "Failed to update chat" });
  }
});

// DELETE /api/chats/:id - Delete a chat
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.chat.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

// POST /api/chats/:id/messages - Add a message to a chat
router.post("/:id/messages", async (req, res) => {
  try {
    const { id } = req.params;
    const { role, content } = req.body;

    if (!role || !content) {
      res.status(400).json({ error: "Role and content are required" });
      return;
    }

    const message = await prisma.message.create({
      data: {
        chatId: id,
        role,
        content,
      },
    });

    // Update chat's updatedAt timestamp
    await prisma.chat.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    res.status(201).json(message);
  } catch (error) {
    console.error("Error adding message:", error);
    res.status(500).json({ error: "Failed to add message" });
  }
});

// POST /api/chats/:id/messages/batch - Add multiple messages at once
router.post("/:id/messages/batch", async (req, res) => {
  try {
    const { id } = req.params;
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages array is required" });
      return;
    }

    const createdMessages = await prisma.message.createMany({
      data: messages.map((msg: { role: string; content: string }) => ({
        chatId: id,
        role: msg.role,
        content: msg.content,
      })),
    });

    // Update chat's updatedAt timestamp
    await prisma.chat.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    res.status(201).json({ count: createdMessages.count });
  } catch (error) {
    console.error("Error adding messages:", error);
    res.status(500).json({ error: "Failed to add messages" });
  }
});

export default router;
