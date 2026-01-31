/**
 * Tripletex Employees Capability
 *
 * Ett tool som håndterer alle ansatt-operasjoner:
 * - search: Søk etter ansatte
 * - get: Hent én ansatt
 * - create: Opprett ny ansatt
 * - update: Oppdater eksisterende ansatt
 */

import { z } from "zod";
import { tool } from "ai";
import { TripletexClient } from "../client.js";

export function createEmployeesCapability(client: TripletexClient) {
  return tool({
    description: `Håndter ansatte i Tripletex.

Actions:
- search: Søk etter ansatte (fornavn, etternavn, e-post, ansattnummer)
- get: Hent én ansatt med alle detaljer
- create: Opprett ny ansatt
- update: Oppdater eksisterende ansatt

Eksempler:
- "Finn ansatt Ola" → action: "search", query: { firstName: "Ola" }
- "Søk etter Hansen" → action: "search", query: { lastName: "Hansen" }
- "Vis ansatt 123" → action: "get", id: 123
- "Opprett ansatt Per Hansen" → action: "create", data: { firstName: "Per", lastName: "Hansen" }`,

    parameters: z.object({
      action: z
        .enum(["search", "get", "create", "update"])
        .describe("Handling som skal utføres"),

      // For "get" og "update"
      id: z.number().optional().describe("Ansatt-ID (påkrevd for get/update)"),

      // For "search"
      query: z
        .object({
          firstName: z.string().optional().describe("Fornavn (delvis match)"),
          lastName: z.string().optional().describe("Etternavn (delvis match)"),
          email: z.string().optional().describe("E-postadresse"),
          employeeNumber: z.string().optional().describe("Ansattnummer"),
          departmentId: z.number().optional().describe("Avdelings-ID"),
          includeInactive: z
            .boolean()
            .optional()
            .default(false)
            .describe("Inkluder inaktive ansatte"),
        })
        .optional()
        .describe("Søkefilter (for search)"),

      // For "create" og "update"
      data: z
        .object({
          firstName: z.string().optional().describe("Fornavn"),
          lastName: z.string().optional().describe("Etternavn"),
          email: z.string().optional().describe("E-postadresse"),
          phoneNumberMobile: z.string().optional().describe("Mobilnummer"),
          employeeNumber: z.string().optional().describe("Ansattnummer"),
          dateOfBirth: z.string().optional().describe("Fødselsdato (YYYY-MM-DD)"),
          departmentId: z.number().optional().describe("Avdelings-ID"),
        })
        .optional()
        .describe("Ansattdata (for create/update)"),
    }),

    execute: async ({ action, id, query, data }) => {
      try {
        switch (action) {
          case "search": {
            const employees = await client.searchEmployees({
              firstName: query?.firstName,
              lastName: query?.lastName,
              email: query?.email,
              employeeNumber: query?.employeeNumber,
              departmentId: query?.departmentId,
              includeInactive: query?.includeInactive,
              count: 25,
            });
            return {
              success: true,
              action: "search",
              count: employees.length,
              employees: employees.map((e) => ({
                id: e.id,
                firstName: e.firstName,
                lastName: e.lastName,
                name: `${e.firstName || ""} ${e.lastName || ""}`.trim(),
                email: e.email,
                phoneNumberMobile: e.phoneNumberMobile,
                employeeNumber: e.employeeNumber,
                department: e.department,
                isInactive: e.isInactive,
              })),
            };
          }

          case "get": {
            if (!id) {
              return { success: false, error: "Mangler ansatt-ID for 'get'" };
            }
            const employee = await client.getEmployee(id);
            return {
              success: true,
              action: "get",
              employee: {
                ...employee,
                name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
              },
            };
          }

          case "create": {
            if (!data?.firstName || !data?.lastName) {
              return {
                success: false,
                error: "Mangler fornavn og/eller etternavn for 'create'",
              };
            }
            const employee = await client.createEmployee({
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phoneNumberMobile: data.phoneNumberMobile,
              employeeNumber: data.employeeNumber ? parseInt(data.employeeNumber) : undefined,
              department: data.departmentId ? { id: data.departmentId } : undefined,
            });
            return {
              success: true,
              action: "create",
              message: `Ansatt opprettet: ${employee.firstName} ${employee.lastName} (ID: ${employee.id})`,
              employee: {
                id: employee.id,
                firstName: employee.firstName,
                lastName: employee.lastName,
                name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
                employeeNumber: employee.employeeNumber,
              },
            };
          }

          case "update": {
            if (!id) {
              return { success: false, error: "Mangler ansatt-ID for 'update'" };
            }
            if (!data) {
              return { success: false, error: "Mangler data for 'update'" };
            }
            const employee = await client.updateEmployee(id, {
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phoneNumberMobile: data.phoneNumberMobile,
              department: data.departmentId ? { id: data.departmentId } : undefined,
            });
            return {
              success: true,
              action: "update",
              message: `Ansatt oppdatert: ${employee.firstName} ${employee.lastName}`,
              employee: {
                ...employee,
                name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
              },
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
