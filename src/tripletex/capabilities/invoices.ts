/**
 * Tripletex Invoices Capability
 *
 * Ett tool som håndterer alle faktura-operasjoner:
 * - search: Søk etter fakturaer
 * - get: Hent én faktura
 * - create: Opprett ny faktura (håndterer ordre-logikk internt)
 * - send: Send faktura via e-post/EHF/eFaktura
 *
 * VIKTIG: Tripletex krever at man oppretter en ordre først,
 * deretter fakturerer ordren. Denne kompleksiteten er skjult
 * fra brukeren - de sender bare kunde og linjer.
 */

import { z } from "zod";
import { tool } from "ai";
import { TripletexClient } from "../client.js";

// Standard VAT type IDs in Tripletex
const VAT_TYPE_IDS: Record<number, number> = {
  25: 3, // Utgående MVA 25%
  15: 31, // Utgående MVA 15%
  12: 32, // Utgående MVA 12% (mat)
  0: 5, // MVA-fri
};

export function createInvoicesCapability(client: TripletexClient) {
  return tool({
    description: `Håndter fakturaer i Tripletex.

Actions:
- search: Søk etter fakturaer (dato, kunde, status)
- get: Hent én faktura med alle detaljer
- create: Opprett ny faktura (ordre opprettes automatisk)
- send: Send faktura via e-post, EHF eller eFaktura

Eksempler:
- "Finn fakturaer for januar" → action: "search", query: { dateFrom: "2025-01-01", dateTo: "2025-01-31" }
- "Vis faktura 123" → action: "get", id: 123
- "Opprett faktura til kunde 456" → action: "create", data: { customerId: 456, lines: [...] }
- "Send faktura 789 på e-post" → action: "send", id: 789, sendMethod: "EMAIL"

Beløp er i KRONER (ikke øre).`,

    parameters: z.object({
      action: z
        .enum(["search", "get", "create", "send"])
        .describe("Handling som skal utføres"),

      // For "get" og "send"
      id: z.number().optional().describe("Faktura-ID (påkrevd for get/send)"),

      // For "search"
      query: z
        .object({
          dateFrom: z
            .string()
            .optional()
            .describe("Fra dato (YYYY-MM-DD)"),
          dateTo: z
            .string()
            .optional()
            .describe("Til dato (YYYY-MM-DD)"),
          customerId: z.number().optional().describe("Kunde-ID"),
          isPaid: z.boolean().optional().describe("Kun betalte/ubetalte"),
        })
        .optional()
        .describe("Søkefilter (for search)"),

      // For "create"
      data: z
        .object({
          customerId: z.number().describe("Kunde-ID (påkrevd)"),
          invoiceDate: z
            .string()
            .optional()
            .describe("Fakturadato (YYYY-MM-DD, default: i dag)"),
          dueDate: z
            .string()
            .optional()
            .describe("Forfallsdato (YYYY-MM-DD, default: 14 dager)"),
          lines: z
            .array(
              z.object({
                description: z.string().describe("Beskrivelse av linje"),
                amount: z.number().describe("Beløp eks. MVA i kroner"),
                vatRate: z
                  .number()
                  .optional()
                  .default(25)
                  .describe("MVA-sats (25, 15, 12 eller 0)"),
                quantity: z.number().optional().default(1).describe("Antall"),
              })
            )
            .describe("Fakturalinjer"),
          comment: z.string().optional().describe("Kommentar på faktura"),
        })
        .optional()
        .describe("Fakturadata (for create)"),

      // For "send"
      sendMethod: z
        .enum(["EMAIL", "EHF", "EFAKTURA"])
        .optional()
        .describe("Sendemetode (for send)"),
      emailAddress: z
        .string()
        .optional()
        .describe("Overstyr e-postadresse (for send med EMAIL)"),
    }),

    execute: async ({ action, id, query, data, sendMethod, emailAddress }) => {
      try {
        switch (action) {
          case "search": {
            const invoices = await client.searchInvoices({
              invoiceDateFrom: query?.dateFrom,
              invoiceDateTo: query?.dateTo,
              customerId: query?.customerId,
              isPaid: query?.isPaid,
              count: 25,
            });
            return {
              success: true,
              action: "search",
              count: invoices.length,
              invoices: invoices.map((inv) => ({
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                invoiceDate: inv.invoiceDate,
                dueDate: inv.dueDate,
                customer: inv.customer,
                amount: inv.amount,
                amountExcludingVat: inv.amountExcludingVat,
                isPaid: inv.isPaid,
                isCreditNote: inv.isCreditNote,
              })),
            };
          }

          case "get": {
            if (!id) {
              return { success: false, error: "Mangler faktura-ID for 'get'" };
            }
            const invoice = await client.getInvoice(id);
            return {
              success: true,
              action: "get",
              invoice,
            };
          }

          case "create": {
            if (!data?.customerId) {
              return {
                success: false,
                error: "Mangler kunde-ID for 'create'",
              };
            }
            if (!data?.lines || data.lines.length === 0) {
              return {
                success: false,
                error: "Mangler fakturalinjer for 'create'",
              };
            }

            // Calculate dates
            const today = new Date();
            const invoiceDate =
              data.invoiceDate || today.toISOString().split("T")[0];

            const dueDateObj = new Date(invoiceDate);
            dueDateObj.setDate(dueDateObj.getDate() + 14);
            const dueDate =
              data.dueDate || dueDateObj.toISOString().split("T")[0];

            // Step 1: Create order with lines
            // Tripletex requires an order before creating an invoice
            const orderLines = data.lines.map((line) => ({
              description: line.description,
              count: line.quantity ?? 1,
              unitPriceExcludingVatCurrency: line.amount,
              vatType: { id: VAT_TYPE_IDS[line.vatRate ?? 25] || VAT_TYPE_IDS[25] },
            }));

            const order = await client.createOrder({
              customer: { id: data.customerId },
              orderDate: invoiceDate,
              deliveryDate: invoiceDate,
              orderLines,
            });

            // Step 2: Create invoice from order
            const invoice = await client.createInvoice(order.id, {
              invoiceDate,
              sendMethod: "MANUAL", // Don't auto-send, user can use 'send' action
            });

            return {
              success: true,
              action: "create",
              message: `Faktura opprettet: #${invoice.invoiceNumber} (ID: ${invoice.id})`,
              invoice: {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                invoiceDate: invoice.invoiceDate,
                dueDate: invoice.dueDate,
                customer: invoice.customer,
                amount: invoice.amount,
                amountExcludingVat: invoice.amountExcludingVat,
              },
              _internal: {
                orderId: order.id,
              },
            };
          }

          case "send": {
            if (!id) {
              return { success: false, error: "Mangler faktura-ID for 'send'" };
            }

            const method = sendMethod || "EMAIL";

            await client.sendInvoice(id, {
              sendType: method,
              overrideEmailAddress: emailAddress,
            });

            return {
              success: true,
              action: "send",
              message: `Faktura ${id} sendt via ${method}`,
              invoiceId: id,
              sendMethod: method,
            };
          }

          default:
            return { success: false, error: `Ukjent action: ${action}` };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Ukjent feil",
        };
      }
    },
  });
}
