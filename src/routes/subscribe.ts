import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

// List of accounting systems (excluding Fiken which is already available)
const ACCOUNTING_SYSTEMS = [
  { id: "tripletex", name: "Tripletex", available: false },
  { id: "visma", name: "Visma eAccounting", available: false },
  { id: "poweroffice", name: "PowerOffice Go", available: false },
  { id: "24sevenoffice", name: "24SevenOffice", available: false },
  { id: "dnb", name: "DNB Regnskap", available: false },
  { id: "sparebank1", name: "SpareBank 1 Regnskap", available: false },
  { id: "uni", name: "Uni Economy", available: false },
  { id: "other", name: "Annet", available: false },
];

// GET /api/subscribe/systems - Get list of accounting systems
router.get("/systems", (_req, res) => {
  res.json({ systems: ACCOUNTING_SYSTEMS });
});

// POST /api/subscribe - Subscribe to notifications for an accounting system
router.post("/", async (req, res) => {
  try {
    const { email, accountingSystem, otherSystem } = req.body;

    // Validate email
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "E-postadresse er påkrevd" });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: "Ugyldig e-postadresse" });
      return;
    }

    // Validate accounting system
    if (!accountingSystem || typeof accountingSystem !== "string") {
      res.status(400).json({ error: "Regnskapssystem er påkrevd" });
      return;
    }

    const validSystem = ACCOUNTING_SYSTEMS.find((s) => s.id === accountingSystem);
    if (!validSystem) {
      res.status(400).json({ error: "Ugyldig regnskapssystem" });
      return;
    }

    // If "other" is selected, require otherSystem to be provided
    if (accountingSystem === "other" && (!otherSystem || typeof otherSystem !== "string" || otherSystem.trim() === "")) {
      res.status(400).json({ error: "Vennligst oppgi hvilket regnskapssystem du bruker" });
      return;
    }

    // Check if already subscribed
    const existing = await prisma.emailSubscription.findUnique({
      where: {
        email_accountingSystem: {
          email: email.toLowerCase().trim(),
          accountingSystem,
        },
      },
    });

    if (existing) {
      // If previously unsubscribed, reactivate
      if (existing.unsubscribedAt) {
        await prisma.emailSubscription.update({
          where: { id: existing.id },
          data: { 
            unsubscribedAt: null,
            otherSystem: accountingSystem === "other" ? otherSystem?.trim() : null,
          },
        });
        res.json({
          success: true,
          message: `Du vil nå få beskjed når vi støtter ${validSystem.name}!`,
        });
        return;
      }

      // Already subscribed and active
      res.json({
        success: true,
        message: `Du er allerede påmeldt for ${validSystem.name}.`,
        alreadySubscribed: true,
      });
      return;
    }

    // Create new subscription
    await prisma.emailSubscription.create({
      data: {
        email: email.toLowerCase().trim(),
        accountingSystem,
        otherSystem: accountingSystem === "other" ? otherSystem?.trim() : null,
      },
    });

    const systemName = accountingSystem === "other" && otherSystem 
      ? otherSystem.trim() 
      : validSystem.name;

    console.log(`[Subscribe] New subscription: ${email} -> ${accountingSystem}${otherSystem ? ` (${otherSystem})` : ""}`);

    res.json({
      success: true,
      message: `Takk! Du vil få beskjed når vi støtter ${systemName}.`,
    });
  } catch (error) {
    console.error("Subscribe error:", error);
    res.status(500).json({ error: "Kunne ikke registrere påmelding. Prøv igjen senere." });
  }
});

export default router;
