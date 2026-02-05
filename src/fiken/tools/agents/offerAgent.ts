/**
 * Fiken Offer Agent
 * 
 * Spesialisert agent for tilbud- og ordrebekreftelse-operasjoner:
 * - Tilbud (søk, hent, opprett fra utkast)
 * - Tilbudsutkast (opprett, slett)
 * - Ordrebekreftelser (søk, hent, opprett fra utkast)
 * - Ordrebekreftelse-utkast
 * - Konvertering til faktura
 * - Tilbud/OB-tellere
 */

import { z } from "zod";
import { tool } from "ai";
import type { FikenClient } from "../../client.js";
import { 
  OFFER_AGENT_PROMPT,
  createAttachmentTools,
  createDelegationToolsForAgent,
  type PendingFile,
  type DelegationHandler,
} from "../shared/index.js";

/**
 * Creates the offer agent tools
 */
export function createOfferAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
  onDelegate?: DelegationHandler
) {
  
  // ============================================
  // OFFER SEARCH & GET
  // ============================================

  const searchOffers = tool({
    description: "Søk etter tilbud i Fiken.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const offers = await client.getOffers({ pageSize: 50 });
        return {
          success: true,
          count: offers.length,
          offers: offers.map((o) => ({
            id: o.offerId,
            offerNumber: o.offerNumber,
            issueDate: o.issueDate,
            customerName: o.customer?.name,
            customerId: o.customerId,
            gross: o.gross,
            net: o.net,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter tilbud",
        };
      }
    },
  });

  const getOffer = tool({
    description: "Hent detaljert informasjon om et tilbud.",
    parameters: z.object({
      offerId: z.number().describe("Tilbud-ID"),
    }),
    execute: async ({ offerId }) => {
      try {
        const offer = await client.getOffer(offerId);
        return { success: true, offer };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente tilbud",
        };
      }
    },
  });

  // ============================================
  // OFFER DRAFTS
  // ============================================

  const getOfferDrafts = tool({
    description: "Hent alle tilbudsutkast.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const drafts = await client.getOfferDrafts();
        return { 
          success: true, 
          count: drafts.length, 
          drafts: drafts.map((d) => ({
            draftId: d.draftId,
            uuid: d.uuid,
            customerId: d.customerId,
            daysUntilDueDate: d.daysUntilDueDate,
            lines: d.lines,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente tilbudsutkast",
        };
      }
    },
  });

  const createOfferDraft = tool({
    description: "Opprett et tilbudsutkast. Arbeidsflyt: Tilbud -> Ordrebekreftelse -> Faktura.",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID (bruk delegateToContactAgent for å finne denne)"),
      daysUntilDueDate: z.number().default(14).describe("Dager til forfall"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse av vare/tjeneste"),
        unitPrice: z.number().describe("Enhetspris i øre (100 = 1 kr)"),
        quantity: z.number().describe("Antall"),
        vatType: z.string().optional().default("HIGH").describe("MVA-type: HIGH, MEDIUM, LOW, NONE"),
        incomeAccount: z.string().optional().default("3000").describe("Inntektskonto"),
      })).describe("Tilbudslinjer"),
      offerText: z.string().optional().describe("Tekst på tilbudet"),
      ourReference: z.string().optional().describe("Vår referanse"),
      yourReference: z.string().optional().describe("Deres referanse"),
    }),
    execute: async ({ customerId, daysUntilDueDate, lines, offerText, ourReference, yourReference }) => {
      try {
        const draft = await client.createOfferDraft({
          customerId,
          daysUntilDueDate,
          type: "offer",
          lines: lines.map((l) => ({
            description: l.description,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            vatType: l.vatType,
            incomeAccount: l.incomeAccount,
          })),
          offerText,
          ourReference,
          yourReference,
        });
        return { 
          success: true, 
          message: "Tilbudsutkast opprettet", 
          draft,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette tilbudsutkast",
        };
      }
    },
  });

  const createOfferFromDraft = tool({
    description: "Opprett et tilbud fra et utkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOfferDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        const offer = await client.createOfferFromDraft(draftId);
        return {
          success: true,
          _operationComplete: true,
          message: `Tilbud #${offer.offerNumber} opprettet`,
          offer: {
            offerId: offer.offerId,
            offerNumber: offer.offerNumber,
            issueDate: offer.issueDate,
            customerName: offer.customer?.name,
            gross: offer.gross,
            net: offer.net,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette tilbud fra utkast",
        };
      }
    },
  });

  const deleteOfferDraft = tool({
    description: "Slett et tilbudsutkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOfferDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        await client.deleteOfferDraft(draftId);
        return { success: true, message: "Tilbudsutkast slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette tilbudsutkast",
        };
      }
    },
  });

  // ============================================
  // ORDER CONFIRMATION SEARCH & GET
  // ============================================

  const searchOrderConfirmations = tool({
    description: "Søk etter ordrebekreftelser i Fiken.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const confirmations = await client.getOrderConfirmations({ pageSize: 50 });
        return {
          success: true,
          count: confirmations.length,
          orderConfirmations: confirmations.map((oc) => ({
            id: oc.confirmationId,
            confirmationNumber: oc.confirmationNumber,
            issueDate: oc.issueDate,
            customerName: oc.customer?.name,
            customerId: oc.customerId,
            gross: oc.gross,
            net: oc.net,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter ordrebekreftelser",
        };
      }
    },
  });

  const getOrderConfirmation = tool({
    description: "Hent detaljert informasjon om en ordrebekreftelse.",
    parameters: z.object({
      orderConfirmationId: z.number().describe("Ordrebekreftelse-ID"),
    }),
    execute: async ({ orderConfirmationId }) => {
      try {
        const confirmation = await client.getOrderConfirmation(orderConfirmationId);
        return { success: true, orderConfirmation: confirmation };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente ordrebekreftelse",
        };
      }
    },
  });

  // ============================================
  // ORDER CONFIRMATION DRAFTS
  // ============================================

  const getOrderConfirmationDrafts = tool({
    description: "Hent alle ordrebekreftelsesutkast.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const drafts = await client.getOrderConfirmationDrafts();
        return { 
          success: true, 
          count: drafts.length, 
          drafts: drafts.map((d) => ({
            draftId: d.draftId,
            uuid: d.uuid,
            customerId: d.customerId,
            daysUntilDueDate: d.daysUntilDueDate,
            lines: d.lines,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente ordrebekreftelsesutkast",
        };
      }
    },
  });

  const createOrderConfirmationDraft = tool({
    description: "Opprett et ordrebekreftelsesutkast.",
    parameters: z.object({
      customerId: z.number().describe("Kunde-ID"),
      daysUntilDueDate: z.number().default(14).describe("Dager til forfall"),
      lines: z.array(z.object({
        description: z.string().describe("Beskrivelse"),
        unitPrice: z.number().describe("Enhetspris i øre"),
        quantity: z.number().describe("Antall"),
        vatType: z.string().optional().default("HIGH").describe("MVA-type"),
        incomeAccount: z.string().optional().default("3000").describe("Inntektskonto"),
      })).describe("Ordrebekreftelseslinjer"),
      orderConfirmationText: z.string().optional().describe("Tekst på ordrebekreftelsen"),
      ourReference: z.string().optional().describe("Vår referanse"),
      yourReference: z.string().optional().describe("Deres referanse"),
    }),
    execute: async ({ customerId, daysUntilDueDate, lines, orderConfirmationText, ourReference, yourReference }) => {
      try {
        const draft = await client.createOrderConfirmationDraft({
          customerId,
          daysUntilDueDate,
          type: "order_confirmation",
          lines: lines.map((l) => ({
            description: l.description,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            vatType: l.vatType,
            incomeAccount: l.incomeAccount,
          })),
          orderConfirmationText,
          ourReference,
          yourReference,
        });
        return { 
          success: true, 
          message: "Ordrebekreftelsesutkast opprettet", 
          draft,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette ordrebekreftelsesutkast",
        };
      }
    },
  });

  const createOrderConfirmationFromDraft = tool({
    description: "Opprett en ordrebekreftelse fra et utkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOrderConfirmationDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        const confirmation = await client.createOrderConfirmationFromDraft(draftId);
        return {
          success: true,
          _operationComplete: true,
          message: `Ordrebekreftelse #${confirmation.confirmationNumber} opprettet`,
          orderConfirmation: {
            confirmationId: confirmation.confirmationId,
            confirmationNumber: confirmation.confirmationNumber,
            issueDate: confirmation.issueDate,
            customerName: confirmation.customer?.name,
            gross: confirmation.gross,
            net: confirmation.net,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette ordrebekreftelse fra utkast",
        };
      }
    },
  });

  const deleteOrderConfirmationDraft = tool({
    description: "Slett et ordrebekreftelsesutkast.",
    parameters: z.object({
      draftId: z.number().describe("Utkast-ID (heltall fra getOrderConfirmationDrafts, IKKE uuid)"),
    }),
    execute: async ({ draftId }) => {
      try {
        await client.deleteOrderConfirmationDraft(draftId);
        return { success: true, message: "Ordrebekreftelsesutkast slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette ordrebekreftelsesutkast",
        };
      }
    },
  });

  // ============================================
  // CONVERSION TO INVOICE
  // ============================================

  const createInvoiceFromOrderConfirmation = tool({
    description: "Opprett et fakturautkast fra en ordrebekreftelse. Nyttig arbeidsflyt: Tilbud -> Ordrebekreftelse -> Faktura.",
    parameters: z.object({
      orderConfirmationId: z.number().describe("Ordrebekreftelse-ID"),
    }),
    execute: async ({ orderConfirmationId }) => {
      try {
        const invoiceDraft = await client.createInvoiceDraftFromOrderConfirmation(orderConfirmationId);
        return {
          success: true,
          _operationComplete: true,
          message: "Fakturautkast opprettet fra ordrebekreftelse",
          invoiceDraft,
          hint: "Bruk createInvoiceFromDraft for å gjøre utkastet om til en faktura",
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette fakturautkast fra ordrebekreftelse",
        };
      }
    },
  });

  // ============================================
  // COUNTERS
  // ============================================

  const getOfferCounter = tool({
    description: "Hent nåværende tilbudsteller.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getOfferCounter();
        return {
          success: true,
          counter: counter.value,
          message: `Neste tilbudsnummer blir ${counter.value + 1}`,
        };
      } catch (error) {
        return {
          success: false,
          error: "Tilbudsteller ikke initialisert. Bruk initializeOfferCounter først.",
        };
      }
    },
  });

  const initializeOfferCounter = tool({
    description: "Initialiser tilbudstelleren. PÅKREVD før første tilbud kan opprettes.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createOfferCounter(startValue);
        return {
          success: true,
          message: `Tilbudsteller initialisert. Første tilbudsnummer blir ${counter.value + 1}`,
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return { success: false, error: "Tilbudsteller er allerede initialisert" };
        }
        return { success: false, error: errorMsg || "Kunne ikke initialisere tilbudsteller" };
      }
    },
  });

  const getOrderConfirmationCounter = tool({
    description: "Hent nåværende ordrebekreftelsesteller.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const counter = await client.getOrderConfirmationCounter();
        return {
          success: true,
          counter: counter.value,
          message: `Neste ordrebekreftelsesnummer blir ${counter.value + 1}`,
        };
      } catch (error) {
        return {
          success: false,
          error: "Ordrebekreftelsesteller ikke initialisert. Bruk initializeOrderConfirmationCounter først.",
        };
      }
    },
  });

  const initializeOrderConfirmationCounter = tool({
    description: "Initialiser ordrebekreftelsesteller. PÅKREVD før første ordrebekreftelse kan opprettes.",
    parameters: z.object({
      startValue: z.number().optional().default(10000).describe("Startverdi (standard: 10000)"),
    }),
    execute: async ({ startValue }) => {
      try {
        const counter = await client.createOrderConfirmationCounter(startValue);
        return {
          success: true,
          message: `Ordrebekreftelsesteller initialisert. Første ordrebekreftelsesnummer blir ${counter.value + 1}`,
          counter: counter.value,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("already") || errorMsg.includes("exists")) {
          return { success: false, error: "Ordrebekreftelsesteller er allerede initialisert" };
        }
        return { success: false, error: errorMsg || "Kunne ikke initialisere ordrebekreftelsesteller" };
      }
    },
  });

  // ============================================
  // ATTACHMENT TOOLS (from shared module)
  // ============================================
  
  const attachmentTools = createAttachmentTools(client, pendingFiles);

  // ============================================
  // DELEGATION TOOLS (to other agents)
  // ============================================
  
  const delegationTools = onDelegate 
    ? createDelegationToolsForAgent('offer_agent', onDelegate)
    : {};

  // ============================================
  // RETURN ALL TOOLS
  // ============================================

  return {
    // Offer tools
    searchOffers,
    getOffer,
    
    // Offer drafts
    getOfferDrafts,
    createOfferDraft,
    createOfferFromDraft,
    deleteOfferDraft,
    
    // Order confirmation tools
    searchOrderConfirmations,
    getOrderConfirmation,
    
    // Order confirmation drafts
    getOrderConfirmationDrafts,
    createOrderConfirmationDraft,
    createOrderConfirmationFromDraft,
    deleteOrderConfirmationDraft,
    
    // Conversion
    createInvoiceFromOrderConfirmation,
    
    // Counters
    getOfferCounter,
    initializeOfferCounter,
    getOrderConfirmationCounter,
    initializeOrderConfirmationCounter,
    
    // Attachments (offers/OC don't have direct attachment support in Fiken, 
    // but we include draft attachments for completeness)
    uploadAttachmentToOfferDraft: attachmentTools.uploadAttachmentToOfferDraft,
    uploadAttachmentToOrderConfirmationDraft: attachmentTools.uploadAttachmentToOrderConfirmationDraft,
    
    // Delegation
    ...delegationTools,
  };
}

// Export the agent prompt
export { OFFER_AGENT_PROMPT };

// Type for the offer agent tools
export type OfferAgentTools = ReturnType<typeof createOfferAgentTools>;
