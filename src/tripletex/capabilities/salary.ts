/**
 * Tripletex Salary Capability
 *
 * Ett tool som håndterer alle lønnsoperasjoner:
 * - search_types: Søk etter lønnsarter (fastlønn, overtid, etc.)
 * - search_payslips: Søk etter lønnslipper
 * - get_payslip: Hent én lønnslipp med detaljer
 * - run_payroll: Kjør lønn for en ansatt
 * - search_transactions: Søk etter lønnskjøringer
 * - check_employment: Sjekk om ansatt har arbeidsforhold
 * - create_employment: Opprett arbeidsforhold for ansatt
 * - search_divisions: Søk etter virksomheter/divisjoner
 */

import { z } from "zod";
import { tool } from "ai";
import { TripletexClient } from "../client.js";

export function createSalaryCapability(client: TripletexClient) {
  return tool({
    description: `Håndter lønn i Tripletex.

Actions:
- search_types: Søk etter lønnsarter (fastlønn, overtid, bonus, etc.)
- search_payslips: Søk lønnslipper for ansatt/periode
- get_payslip: Hent én lønnslipp med alle detaljer
- run_payroll: Kjør lønn for en ansatt (opprett lønnstransaksjon)
- search_transactions: Søk etter lønnskjøringer
- check_employment: Sjekk om ansatt har gyldig arbeidsforhold
- create_employment: Opprett arbeidsforhold for ansatt (påkrevd før lønn)
- search_divisions: Søk etter virksomheter/divisjoner

VIKTIG for lønn:
1. Ansatt MÅ ha arbeidsforhold før lønn kan kjøres
2. Beløp er i KRONER (ikke øre)
3. Du MÅ spørre brukeren om lønnsbeløp

Eksempler:
- "Finn lønnsarter" → action: "search_types"
- "Vis lønnslipper for januar" → action: "search_payslips", query: { yearFrom: 2025, monthFrom: 1 }
- "Kjør lønn for ansatt 123" → action: "run_payroll", payrollData: { employeeId: 123, ... }
- "Sjekk arbeidsforhold for ansatt 456" → action: "check_employment", employeeId: 456`,

    parameters: z.object({
      action: z
        .enum([
          "search_types",
          "search_payslips",
          "get_payslip",
          "run_payroll",
          "search_transactions",
          "check_employment",
          "create_employment",
          "search_divisions",
        ])
        .describe("Handling som skal utføres"),

      // For get_payslip
      id: z.number().optional().describe("Lønnslipp-ID (for get_payslip)"),

      // For check_employment, search_payslips
      employeeId: z.number().optional().describe("Ansatt-ID"),

      // For search actions
      query: z
        .object({
          name: z.string().optional().describe("Navn på lønnsart"),
          yearFrom: z.number().optional().describe("Fra år"),
          yearTo: z.number().optional().describe("Til år"),
          monthFrom: z.number().optional().describe("Fra måned (1-12)"),
          monthTo: z.number().optional().describe("Til måned (1-12)"),
        })
        .optional()
        .describe("Søkefilter"),

      // For run_payroll
      payrollData: z
        .object({
          employeeId: z.number().describe("Ansatt-ID"),
          salaryTypeId: z.number().describe("Lønnsart-ID (fra search_types)"),
          amount: z.number().describe("Totalbeløp i KRONER"),
          year: z.number().describe("År (f.eks. 2025)"),
          month: z.number().describe("Måned (1-12)"),
          rate: z.number().optional().describe("Sats per enhet i KRONER (standard: samme som amount)"),
          count: z.number().optional().describe("Antall enheter (standard: 1)"),
          description: z.string().optional().describe("Beskrivelse"),
          date: z.string().optional().describe("Bilagsdato (YYYY-MM-DD)"),
        })
        .optional()
        .describe("Lønnsdata (for run_payroll)"),

      // For create_employment
      employmentData: z
        .object({
          employeeId: z.number().describe("Ansatt-ID"),
          divisionId: z.number().describe("Virksomhet/Division-ID"),
          startDate: z.string().describe("Startdato (YYYY-MM-DD)"),
          isMainEmployer: z.boolean().optional().default(true),
          employmentType: z
            .enum(["ORDINARY", "MARITIME", "FREELANCE"])
            .optional()
            .default("ORDINARY"),
          employmentForm: z
            .enum(["PERMANENT", "TEMPORARY"])
            .optional()
            .default("PERMANENT"),
          remunerationType: z
            .enum(["MONTHLY_WAGE", "HOURLY_WAGE"])
            .optional()
            .default("MONTHLY_WAGE"),
          percentageOfFullTimeEquivalent: z.number().optional().default(100),
          annualSalary: z.number().optional().describe("Årslønn i kroner"),
          hourlyWage: z.number().optional().describe("Timelønn i kroner"),
        })
        .optional()
        .describe("Arbeidsforhold-data (for create_employment)"),
    }),

    execute: async ({ action, id, employeeId, query, payrollData, employmentData }) => {
      try {
        switch (action) {
          case "search_types": {
            const types = await client.searchSalaryTypes({
              name: query?.name,
              count: 50,
            });
            return {
              success: true,
              action: "search_types",
              count: types.length,
              salaryTypes: types.map((t) => ({
                id: t.id,
                number: t.number,
                name: t.name,
                description: t.description,
                isTaxable: t.isTaxable,
                isVacationPayable: t.isVacationPayable,
              })),
            };
          }

          case "search_payslips": {
            const payslips = await client.searchPayslips({
              employeeId,
              yearFrom: query?.yearFrom,
              yearTo: query?.yearTo,
              monthFrom: query?.monthFrom,
              monthTo: query?.monthTo,
              count: 25,
            });
            return {
              success: true,
              action: "search_payslips",
              count: payslips.length,
              payslips: payslips.map((p) => ({
                id: p.id,
                employeeName: p.employee
                  ? `${p.employee.firstName || ""} ${p.employee.lastName || ""}`.trim()
                  : "Ukjent",
                year: p.year,
                month: p.month,
                grossAmount: p.grossAmount,
                netAmount: p.amount,
              })),
            };
          }

          case "get_payslip": {
            if (!id) {
              return { success: false, error: "Mangler lønnslipp-ID" };
            }
            const payslip = await client.getPayslip(id);
            return {
              success: true,
              action: "get_payslip",
              payslip: {
                id: payslip.id,
                employeeName: payslip.employee
                  ? `${payslip.employee.firstName || ""} ${payslip.employee.lastName || ""}`.trim()
                  : "Ukjent",
                year: payslip.year,
                month: payslip.month,
                grossAmount: payslip.grossAmount,
                netAmount: payslip.amount,
                vacationAllowanceAmount: payslip.vacationAllowanceAmount,
                specifications: payslip.specifications?.map((s) => ({
                  salaryType: s.salaryType?.name,
                  amount: s.amount,
                  rate: s.rate,
                  count: s.count,
                  description: s.description,
                })),
              },
            };
          }

          case "run_payroll": {
            if (!payrollData) {
              return {
                success: false,
                error:
                  "Mangler lønnsdata. Påkrevd: employeeId, salaryTypeId, amount, year, month",
              };
            }

            // Sjekk først om ansatt har arbeidsforhold
            const employments = await client.searchEmployments({
              employeeId: payrollData.employeeId,
            });
            if (employments.length === 0) {
              return {
                success: false,
                error: `Ansatt ${payrollData.employeeId} har ikke arbeidsforhold. Bruk action "create_employment" først.`,
                hint: 'Kjør search_divisions for å finne virksomhet, deretter create_employment',
              };
            }

            const today = new Date().toISOString().split("T")[0];
            
            // Tripletex krever rate og count - bruk standardverdier hvis ikke oppgitt
            const rate = payrollData.rate ?? payrollData.amount;
            const count = payrollData.count ?? 1;
            
            const transaction = await client.createSalaryTransaction({
              date: payrollData.date || today,
              year: payrollData.year,
              month: payrollData.month,
              payslips: [
                {
                  employee: { id: payrollData.employeeId },
                  specifications: [
                    {
                      salaryType: { id: payrollData.salaryTypeId },
                      rate: rate,
                      count: count,
                      amount: payrollData.amount,
                      description: payrollData.description,
                    },
                  ],
                },
              ],
            });

            return {
              success: true,
              action: "run_payroll",
              message: `Lønn registrert for ansatt ${payrollData.employeeId}: ${payrollData.amount} kr`,
              transaction: {
                id: transaction.id,
                year: transaction.year,
                month: transaction.month,
                date: transaction.date,
              },
            };
          }

          case "search_transactions": {
            const transactions = await client.searchSalaryTransactions({
              yearFrom: query?.yearFrom,
              yearTo: query?.yearTo,
              monthFrom: query?.monthFrom,
              monthTo: query?.monthTo,
              count: 25,
            });
            return {
              success: true,
              action: "search_transactions",
              count: transactions.length,
              transactions: transactions.map((t) => ({
                id: t.id,
                date: t.date,
                year: t.year,
                month: t.month,
                payslipCount: t.payslips?.length || 0,
              })),
            };
          }

          case "check_employment": {
            if (!employeeId) {
              return { success: false, error: "Mangler ansatt-ID" };
            }
            const employments = await client.searchEmployments({ employeeId });
            if (employments.length === 0) {
              return {
                success: true,
                action: "check_employment",
                hasEmployment: false,
                message: `Ansatt ${employeeId} har IKKE arbeidsforhold. Opprett med action "create_employment"`,
              };
            }
            return {
              success: true,
              action: "check_employment",
              hasEmployment: true,
              employments: employments.map((e) => ({
                id: e.id,
                startDate: e.startDate,
                endDate: e.endDate,
                division: e.division,
                isMainEmployer: e.isMainEmployer,
              })),
            };
          }

          case "create_employment": {
            if (!employmentData) {
              return {
                success: false,
                error:
                  "Mangler arbeidsforholdsdata. Påkrevd: employeeId, divisionId, startDate",
              };
            }

            const employment = await client.createEmployment({
              employee: { id: employmentData.employeeId },
              division: { id: employmentData.divisionId },
              startDate: employmentData.startDate,
              isMainEmployer: employmentData.isMainEmployer,
              employmentDetails: [
                {
                  date: employmentData.startDate,
                  employmentType: employmentData.employmentType,
                  employmentForm: employmentData.employmentForm,
                  remunerationType: employmentData.remunerationType,
                  percentageOfFullTimeEquivalent:
                    employmentData.percentageOfFullTimeEquivalent,
                  annualSalary: employmentData.annualSalary,
                  hourlyWage: employmentData.hourlyWage,
                },
              ],
            });

            return {
              success: true,
              action: "create_employment",
              message: `Arbeidsforhold opprettet for ansatt ${employmentData.employeeId}`,
              employment: {
                id: employment.id,
                startDate: employment.startDate,
                division: employment.division,
              },
            };
          }

          case "search_divisions": {
            const divisions = await client.searchDivisions({ count: 50 });
            return {
              success: true,
              action: "search_divisions",
              count: divisions.length,
              divisions: divisions.map((d) => ({
                id: d.id,
                name: d.name || d.displayName,
                organizationNumber: d.organizationNumber,
              })),
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
