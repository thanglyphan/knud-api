/**
 * Tripletex Customers Capability
 * 
 * Ett tool som håndterer alle kunde-operasjoner:
 * - search: Søk etter kunder
 * - get: Hent én kunde
 * - create: Opprett ny kunde
 * - update: Oppdater eksisterende kunde
 */

import { z } from "zod";
import { tool } from "ai";
import { TripletexClient } from "../client.js";

export function createCustomersCapability(client: TripletexClient) {
  return tool({
    description: `Håndter kunder i Tripletex.

Actions:
- search: Søk etter kunder (navn, orgnr, kundenummer, email)
- get: Hent én kunde med alle detaljer
- create: Opprett ny kunde
- update: Oppdater eksisterende kunde

Eksempler:
- "Finn kunde Ola Hansen" → action: "search", query: { name: "Ola Hansen" }
- "Vis kunde 123" → action: "get", id: 123
- "Opprett kunde Firma AS" → action: "create", data: { name: "Firma AS" }`,

    parameters: z.object({
      action: z.enum(["search", "get", "create", "update"]).describe("Handling som skal utføres"),
      
      // For "get" og "update"
      id: z.number().optional().describe("Kunde-ID (påkrevd for get/update)"),
      
      // For "search"
      query: z.object({
        name: z.string().optional().describe("Kundenavn (delvis match)"),
        organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
        customerNumber: z.string().optional().describe("Kundenummer"),
        email: z.string().optional().describe("E-postadresse"),
        isInactive: z.boolean().optional().default(false).describe("Inkluder inaktive"),
      }).optional().describe("Søkefilter (for search)"),
      
      // For "create" og "update"
      data: z.object({
        name: z.string().optional().describe("Kundenavn"),
        organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
        email: z.string().optional().describe("E-postadresse"),
        phoneNumber: z.string().optional().describe("Telefonnummer"),
        invoiceEmail: z.string().optional().describe("Faktura-epost"),
        isInactive: z.boolean().optional().describe("Sett som inaktiv"),
      }).optional().describe("Kundedata (for create/update)"),
    }),

    execute: async ({ action, id, query, data }) => {
      try {
        switch (action) {
          case "search": {
            const customers = await client.searchCustomers({
              name: query?.name,
              organizationNumber: query?.organizationNumber,
              customerNumber: query?.customerNumber,
              email: query?.email,
              isInactive: query?.isInactive,
              count: 25,
            });
            return {
              success: true,
              action: "search",
              count: customers.length,
              customers: customers.map((c) => ({
                id: c.id,
                name: c.name,
                customerNumber: c.customerNumber,
                organizationNumber: c.organizationNumber,
                email: c.email,
                phoneNumber: c.phoneNumber,
              })),
            };
          }

          case "get": {
            if (!id) {
              return { success: false, error: "Mangler kunde-ID for 'get'" };
            }
            const customer = await client.getCustomer(id);
            return {
              success: true,
              action: "get",
              customer,
            };
          }

          case "create": {
            if (!data?.name) {
              return { success: false, error: "Mangler kundenavn for 'create'" };
            }
            const customer = await client.createCustomer({
              name: data.name,
              organizationNumber: data.organizationNumber,
              email: data.email,
              phoneNumber: data.phoneNumber,
              invoiceEmail: data.invoiceEmail,
              isCustomer: true,
            });
            return {
              success: true,
              action: "create",
              message: `Kunde opprettet: ${customer.name} (ID: ${customer.id})`,
              customer: {
                id: customer.id,
                name: customer.name,
                customerNumber: customer.customerNumber,
              },
            };
          }

          case "update": {
            if (!id) {
              return { success: false, error: "Mangler kunde-ID for 'update'" };
            }
            if (!data) {
              return { success: false, error: "Mangler data for 'update'" };
            }
            const customer = await client.updateCustomer(id, {
              name: data.name,
              email: data.email,
              phoneNumber: data.phoneNumber,
              isInactive: data.isInactive,
            });
            return {
              success: true,
              action: "update",
              message: `Kunde oppdatert: ${customer.name}`,
              customer,
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
