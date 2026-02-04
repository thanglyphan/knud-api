/**
 * Tripletex AI Tools
 * Tools for the AI agent to interact with Tripletex API
 * 
 * Focus: Payroll (lønn), A-melding, Vouchers (bilag), Customers, Suppliers, Invoices
 */

import { tool } from "ai";
import { z } from "zod";
import type { TripletexClient } from "../client.js";
import { createAccountExpert } from "../subagents/accountExpert.js";
import { createVatExpert } from "../subagents/vatExpert.js";
import { createContactMatcher } from "../subagents/contactMatcher.js";

/**
 * Create Tripletex tools for the AI agent
 */
export function createTripletexTools(
  client: TripletexClient, 
  companyId: string,
  pendingFiles?: Array<{ name: string; type: string; data: string }>
) {
  return {
    // ==================== EMPLOYEES ====================
    
    get_employees: tool({
      description: `Hent liste over ansatte i selskapet. 
Returnerer ansattinfo inkludert navn, e-post, ansattnummer og arbeidsforhold.
Bruk dette for å:
- Se hvem som er ansatt
- Finne ansatt-ID før lønnskjøring
- Sjekke ansattdetaljer`,
      parameters: z.object({
        firstName: z.string().optional().describe("Filtrer på fornavn"),
        lastName: z.string().optional().describe("Filtrer på etternavn"),
        email: z.string().optional().describe("Filtrer på e-post"),
        employeeNumber: z.string().optional().describe("Filtrer på ansattnummer"),
      }),
      execute: async (params) => {
        try {
          const result = await client.getEmployees(params);
          
          return {
            success: true,
            count: result.values.length,
            employees: result.values.map(emp => ({
              id: emp.id,
              name: `${emp.firstName} ${emp.lastName}`.trim(),
              displayName: emp.displayName,
              email: emp.email,
              employeeNumber: emp.employeeNumber,
              dateOfBirth: emp.dateOfBirth,
              hasEmployment: (emp.employments?.length ?? 0) > 0,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av ansatte",
          };
        }
      },
    }),

    get_employee_details: tool({
      description: `Hent detaljert informasjon om én ansatt.
Inkluderer adresse, arbeidsforhold, lønnsdetaljer mm.
Bruk dette når du trenger mer info om en spesifikk ansatt.`,
      parameters: z.object({
        employeeId: z.number().describe("Ansatt-ID fra get_employees"),
      }),
      execute: async ({ employeeId }) => {
        try {
          const result = await client.getEmployee(employeeId);
          const emp = result.value;
          
          return {
            success: true,
            employee: {
              id: emp.id,
              name: `${emp.firstName} ${emp.lastName}`.trim(),
              email: emp.email,
              employeeNumber: emp.employeeNumber,
              dateOfBirth: emp.dateOfBirth,
              nationalIdentityNumber: emp.nationalIdentityNumber ? "***" : null, // Mask for privacy
              bankAccountNumber: emp.bankAccountNumber ? "****" + emp.bankAccountNumber.slice(-4) : null,
              address: emp.address ? {
                addressLine1: emp.address.addressLine1,
                postalCode: emp.address.postalCode,
                city: emp.address.city,
              } : null,
              department: emp.department?.name,
              employments: emp.employments?.map(e => ({
                id: e.id,
                startDate: e.startDate,
                endDate: e.endDate,
              })),
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av ansattdetaljer",
          };
        }
      },
    }),

    // ==================== SALARY TYPES ====================
    
    get_salary_types: tool({
      description: `Hent tilgjengelige lønnstyper (lønnselementer).
Returnerer liste over lønnstyper som kan brukes i lønnskjøring.
Inkluderer A-melding lønnsbeskrivelse-koder.`,
      parameters: z.object({
        showInactive: z.boolean().optional().describe("Inkluder inaktive lønnstyper"),
      }),
      execute: async ({ showInactive }) => {
        try {
          const result = await client.getSalaryTypes(showInactive ?? false);
          
          return {
            success: true,
            count: result.values.length,
            salaryTypes: result.values.map(st => ({
              id: st.id,
              number: st.number,
              name: st.name,
              description: st.description,
              ameldingWageCode: st.ameldingWageCode,
              ameldingWageCodeDescription: st.ameldingWageCodeDescription,
              isInactive: st.isInactive,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av lønnstyper",
          };
        }
      },
    }),

    // ==================== PAYSLIPS ====================
    
    get_payslips: tool({
      description: `Søk og hent lønnsslipper.
Returnerer lønnsslipper med beløp, skattetrekk, og spesifikasjoner.
Bruk dette for å:
- Se lønnshistorikk for ansatte
- Finne lønnsslipper for en periode
- Sjekke tidligere utbetalinger

VIKTIG: For å filtrere på periode, bruk ENTEN:
- Ingen datofilter (henter alle)
- year + month for én spesifikk måned
- employeeId alene for alle lønnsslipper for en ansatt`,
      parameters: z.object({
        employeeId: z.number().optional().describe("Filtrer på ansatt-ID"),
        year: z.number().optional().describe("Spesifikt år (f.eks. 2025)"),
        month: z.number().optional().describe("Spesifikk måned (1-12)"),
      }),
      execute: async (params) => {
        try {
          // Build query params
          // If year and month are provided, set up the date range correctly
          // Tripletex uses exclusive end dates, so for Dec 2025, use yearTo=2026, monthTo=1
          let queryParams: {
            employeeId?: string;
            yearFrom?: number;
            monthFrom?: number;
            yearTo?: number;
            monthTo?: number;
          } = {};

          if (params.employeeId) {
            queryParams.employeeId = params.employeeId.toString();
          }

          if (params.year !== undefined && params.month !== undefined) {
            queryParams.yearFrom = params.year;
            queryParams.monthFrom = params.month;
            
            // Calculate exclusive end date
            if (params.month === 12) {
              queryParams.yearTo = params.year + 1;
              queryParams.monthTo = 1;
            } else {
              queryParams.yearTo = params.year;
              queryParams.monthTo = params.month + 1;
            }
          }

          const result = await client.getPayslips(queryParams);
          
          return {
            success: true,
            count: result.values.length,
            payslips: result.values.map(ps => ({
              id: ps.id,
              employeeName: ps.employee ? `${ps.employee.firstName} ${ps.employee.lastName}`.trim() : "Ukjent",
              employeeId: ps.employee?.id,
              year: ps.year,
              month: ps.month,
              date: ps.date,
              grossAmount: ps.grossAmount,
              taxDeduction: ps.taxDeductionAmount,
              netAmount: ps.amount,
              vacationAllowance: ps.vacationAllowanceAmount,
              payrollTax: ps.payrollTaxAmount,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av lønnsslipper",
          };
        }
      },
    }),

    get_payslip_details: tool({
      description: `Hent detaljert lønnsslipp med alle spesifikasjoner.
Viser alle lønnsposter, trekk og tillegg for en spesifikk lønnsslipp.`,
      parameters: z.object({
        payslipId: z.number().describe("Lønnsslipp-ID fra get_payslips"),
      }),
      execute: async ({ payslipId }) => {
        try {
          const result = await client.getPayslip(payslipId);
          const ps = result.value;
          
          return {
            success: true,
            payslip: {
              id: ps.id,
              employeeName: ps.employee ? `${ps.employee.firstName} ${ps.employee.lastName}`.trim() : "Ukjent",
              year: ps.year,
              month: ps.month,
              date: ps.date,
              grossAmount: ps.grossAmount,
              taxDeduction: ps.taxDeductionAmount,
              netAmount: ps.amount,
              vacationAllowance: ps.vacationAllowanceAmount,
              payrollTax: ps.payrollTaxAmount,
              specifications: ps.specifications?.map(spec => ({
                salaryType: spec.salaryType?.name,
                salaryTypeNumber: spec.salaryType?.number,
                rate: spec.rate,
                count: spec.count,
                amount: spec.amount,
                description: spec.description,
              })),
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av lønnsslipp",
          };
        }
      },
    }),

    // ==================== SALARY TRANSACTIONS (Lønnskjøring) ====================
    
    get_salary_transactions: tool({
      description: `Hent lønnskjøringer (salary transactions/vouchers).
En lønnskjøring samler lønnsslipper for en periode og oppretter bilag.
Bruk dette for å se historiske lønnskjøringer.`,
      parameters: z.object({
        yearFrom: z.number().optional().describe("Fra år"),
        yearTo: z.number().optional().describe("Til år"),
        monthFrom: z.number().optional().describe("Fra måned (1-12)"),
        monthTo: z.number().optional().describe("Til måned (1-12)"),
      }),
      execute: async (params) => {
        try {
          const result = await client.getSalaryTransactions(params);
          
          return {
            success: true,
            count: result.values.length,
            transactions: result.values.map(tx => ({
              id: tx.id,
              date: tx.date,
              year: tx.year,
              month: tx.month,
              payrollTaxAmount: tx.payrollTaxAmount,
              payslipCount: tx.payslips?.length ?? 0,
              isHistorical: tx.isHistorical,
              voucherComment: tx.voucherComment,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av lønnskjøringer",
          };
        }
      },
    }),

    // ==================== PAYROLL SUMMARY ====================
    
    get_payroll_summary: tool({
      description: `Hent lønnsoversikt for en måned.
Viser totaler for lønn, skattetrekk, arbeidsgiveravgift og netto utbetalt.
Inkluderer oversikt per ansatt.
BRUK DETTE for å få oversikt over lønnskostnader.`,
      parameters: z.object({
        year: z.number().describe("År (f.eks. 2024)"),
        month: z.number().describe("Måned (1-12)"),
      }),
      execute: async ({ year, month }) => {
        try {
          const summary = await client.getPayrollSummary(year, month);
          
          return {
            success: true,
            period: `${year}-${String(month).padStart(2, '0')}`,
            employees: summary.employees,
            totals: {
              grossSalary: summary.totals.grossSalary,
              grossSalaryFormatted: `${(summary.totals.grossSalary).toLocaleString('nb-NO')} kr`,
              taxDeduction: summary.totals.taxDeduction,
              taxDeductionFormatted: `${(summary.totals.taxDeduction).toLocaleString('nb-NO')} kr`,
              payrollTax: summary.totals.payrollTax,
              payrollTaxFormatted: `${(summary.totals.payrollTax).toLocaleString('nb-NO')} kr`,
              netPaid: summary.totals.netPaid,
              netPaidFormatted: `${(summary.totals.netPaid).toLocaleString('nb-NO')} kr`,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av lønnsoversikt",
          };
        }
      },
    }),

    // ==================== SALARY SETTINGS ====================
    
    get_salary_settings: tool({
      description: `Hent lønnsinnstillinger for selskapet.
Viser innstillinger som beregningsmetode for arbeidsgiveravgift.`,
      parameters: z.object({}),
      execute: async () => {
        try {
          const result = await client.getSalarySettings();
          
          return {
            success: true,
            settings: {
              id: result.value.id,
              payrollTaxCalcMethod: result.value.payrollTaxCalcMethod,
              showSocialSecurityNumberInPdfs: result.value.showSocialSecurityNumberInPdfs,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av lønnsinnstillinger",
          };
        }
      },
    }),

    // ==================== A-MELDING (Ikke støttet via API) ====================
    
    get_tax_deduction_overview: tool({
      description: `Hent skattetrekk-oversikt for A-melding.
MERK: A-melding funksjonalitet er IKKE tilgjengelig via Tripletex API.
Brukeren må opprette og sende A-melding manuelt i Tripletex.`,
      parameters: z.object({
        year: z.number().describe("År"),
        month: z.number().describe("Måned (1-12)"),
      }),
      execute: async ({ year, month }) => {
        const term = Math.ceil(month / 2);
        const termStartMonth = (term - 1) * 2 + 1;
        const termEndMonth = term * 2;
        
        return {
          success: false,
          notSupported: true,
          message: `A-melding funksjonalitet er ikke tilgjengelig via Tripletex API.`,
          instruction: `For å se skattetrekk-oversikt og opprette A-melding for termin ${term} (${getMonthName(termStartMonth)}-${getMonthName(termEndMonth)}) ${year}, må du gjøre dette manuelt i Tripletex:

1. Logg inn på Tripletex
2. Gå til **Lønn → A-melding**
3. Velg riktig termin og år
4. Kontroller tallene og send A-meldingen

Du kan bruke **get_payroll_summary** eller **get_payslips** for å se lønnsoversikt og skattetrekk for perioden.`,
        };
      },
    }),

    get_payroll_tax_overview: tool({
      description: `Hent arbeidsgiveravgift-oversikt for A-melding.
MERK: A-melding funksjonalitet er IKKE tilgjengelig via Tripletex API.
Brukeren må opprette og sende A-melding manuelt i Tripletex.`,
      parameters: z.object({
        year: z.number().describe("År"),
        month: z.number().describe("Måned (1-12)"),
      }),
      execute: async ({ year, month }) => {
        const term = Math.ceil(month / 2);
        const termStartMonth = (term - 1) * 2 + 1;
        const termEndMonth = term * 2;
        
        return {
          success: false,
          notSupported: true,
          message: `A-melding funksjonalitet er ikke tilgjengelig via Tripletex API.`,
          instruction: `For å se arbeidsgiveravgift-oversikt og opprette A-melding for termin ${term} (${getMonthName(termStartMonth)}-${getMonthName(termEndMonth)}) ${year}, må du gjøre dette manuelt i Tripletex:

1. Logg inn på Tripletex
2. Gå til **Lønn → A-melding**
3. Velg riktig termin og år
4. Kontroller tallene og send A-meldingen

Du kan bruke **get_payroll_summary** eller **get_payslips** for å se lønnsoversikt for perioden.`,
        };
      },
    }),

    // ==================== EMPLOYEE CRUD ====================

    create_employee: tool({
      description: `Opprett en ny ansatt i Tripletex.
Krever minimum fornavn og etternavn.
Anbefalt: Legg også til e-post, fødselsdato og personnummer for A-melding.

VIKTIG: Etter å ha opprettet en ansatt, må du også opprette et arbeidsforhold (employment) for at de skal kunne motta lønn.`,
      parameters: z.object({
        firstName: z.string().describe("Fornavn"),
        lastName: z.string().describe("Etternavn"),
        email: z.string().optional().describe("E-postadresse"),
        dateOfBirth: z.string().optional().describe("Fødselsdato (YYYY-MM-DD)"),
        nationalIdentityNumber: z.string().optional().describe("Personnummer (11 siffer)"),
        employeeNumber: z.string().optional().describe("Ansattnummer"),
        bankAccountNumber: z.string().optional().describe("Bankkonto for lønn"),
        phoneNumberMobile: z.string().optional().describe("Mobilnummer"),
        addressLine1: z.string().optional().describe("Adresselinje 1"),
        postalCode: z.string().optional().describe("Postnummer"),
        city: z.string().optional().describe("Poststed"),
      }),
      execute: async (params) => {
        try {
          const input = {
            firstName: params.firstName,
            lastName: params.lastName,
            email: params.email,
            dateOfBirth: params.dateOfBirth,
            nationalIdentityNumber: params.nationalIdentityNumber,
            employeeNumber: params.employeeNumber,
            bankAccountNumber: params.bankAccountNumber,
            phoneNumberMobile: params.phoneNumberMobile,
            address: (params.addressLine1 || params.postalCode || params.city) ? {
              addressLine1: params.addressLine1,
              postalCode: params.postalCode,
              city: params.city,
            } : undefined,
          };

          const result = await client.createEmployee(input);
          const emp = result.value;

          return {
            success: true,
            message: `Ansatt "${emp.firstName} ${emp.lastName}" opprettet`,
            employee: {
              id: emp.id,
              name: `${emp.firstName} ${emp.lastName}`.trim(),
              email: emp.email,
              employeeNumber: emp.employeeNumber,
            },
            nextStep: "Opprett et arbeidsforhold med create_employment for denne ansatte",
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved oppretting av ansatt",
          };
        }
      },
    }),

    update_employee: tool({
      description: `Oppdater informasjon om en eksisterende ansatt.
Bruk dette for å endre kontaktinfo, adresse, bankkonto osv.`,
      parameters: z.object({
        employeeId: z.number().describe("Ansatt-ID"),
        firstName: z.string().optional().describe("Nytt fornavn"),
        lastName: z.string().optional().describe("Nytt etternavn"),
        email: z.string().optional().describe("Ny e-postadresse"),
        employeeNumber: z.string().optional().describe("Nytt ansattnummer"),
        bankAccountNumber: z.string().optional().describe("Ny bankkonto"),
        phoneNumberMobile: z.string().optional().describe("Nytt mobilnummer"),
        addressLine1: z.string().optional().describe("Ny adresselinje 1"),
        postalCode: z.string().optional().describe("Nytt postnummer"),
        city: z.string().optional().describe("Nytt poststed"),
      }),
      execute: async ({ employeeId, ...params }) => {
        try {
          const input = {
            firstName: params.firstName,
            lastName: params.lastName,
            email: params.email,
            employeeNumber: params.employeeNumber,
            bankAccountNumber: params.bankAccountNumber,
            phoneNumberMobile: params.phoneNumberMobile,
            address: (params.addressLine1 || params.postalCode || params.city) ? {
              addressLine1: params.addressLine1,
              postalCode: params.postalCode,
              city: params.city,
            } : undefined,
          };

          // Remove undefined values
          const cleanInput = Object.fromEntries(
            Object.entries(input).filter(([_, v]) => v !== undefined)
          );

          const result = await client.updateEmployee(employeeId, cleanInput);
          const emp = result.value;

          return {
            success: true,
            message: `Ansatt "${emp.firstName} ${emp.lastName}" oppdatert`,
            employee: {
              id: emp.id,
              name: `${emp.firstName} ${emp.lastName}`.trim(),
              email: emp.email,
              employeeNumber: emp.employeeNumber,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved oppdatering av ansatt",
          };
        }
      },
    }),

    // ==================== EMPLOYMENT CRUD ====================

    create_employment: tool({
      description: `Opprett et arbeidsforhold for en ansatt.
Kreves for at ansatte skal kunne motta lønn.
Inkluderer stillingsprosent, lønnstype og årslønn/timelønn.

VIKTIG: 
- startDate er når arbeidsforholdet starter
- remunerationType bestemmer om det er månedslønn eller timelønn
- percentageOfFullTimeEquivalent er stillingsprosent (100 = heltid)`,
      parameters: z.object({
        employeeId: z.number().describe("Ansatt-ID fra create_employee eller get_employees"),
        startDate: z.string().describe("Startdato for arbeidsforhold (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("Sluttdato hvis midlertidig (YYYY-MM-DD)"),
        employmentType: z.enum(["ORDINARY", "MARITIME", "FREELANCE"]).optional().describe("Type arbeidsforhold (vanligvis ORDINARY)"),
        employmentForm: z.enum(["PERMANENT", "TEMPORARY"]).optional().describe("Fast eller midlertidig stilling"),
        remunerationType: z.enum(["MONTHLY_WAGE", "HOURLY_WAGE", "COMMISSION_PERCENTAGE", "FEE", "PIECEWORK_WAGE"]).optional().describe("Lønnstype (MONTHLY_WAGE eller HOURLY_WAGE vanligst)"),
        percentageOfFullTimeEquivalent: z.number().optional().describe("Stillingsprosent (0-100, f.eks. 100 for heltid, 50 for halvtid)"),
        annualSalary: z.number().optional().describe("Årslønn i NOK (for månedslønnede)"),
        hourlyWage: z.number().optional().describe("Timelønn i NOK (for timelønnede)"),
      }),
      execute: async (params) => {
        try {
          // Build employment details
          const details = {
            date: params.startDate,
            employmentType: params.employmentType || "ORDINARY",
            employmentForm: params.employmentForm || "PERMANENT",
            remunerationType: params.remunerationType || "MONTHLY_WAGE",
            percentageOfFullTimeEquivalent: params.percentageOfFullTimeEquivalent ?? 100,
            annualSalary: params.annualSalary,
            hourlyWage: params.hourlyWage,
          };

          const result = await client.createEmployment({
            employee: { id: params.employeeId },
            startDate: params.startDate,
            endDate: params.endDate,
            employmentDetails: [details],
          });

          const emp = result.value;

          return {
            success: true,
            message: `Arbeidsforhold opprettet fra ${params.startDate}`,
            employment: {
              id: emp.id,
              employeeId: emp.employee?.id,
              startDate: emp.startDate,
              endDate: emp.endDate,
            },
            details: {
              employmentType: details.employmentType,
              remunerationType: details.remunerationType,
              percentageOfFullTimeEquivalent: details.percentageOfFullTimeEquivalent,
              annualSalary: details.annualSalary,
              hourlyWage: details.hourlyWage,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved oppretting av arbeidsforhold",
          };
        }
      },
    }),

    update_employment_details: tool({
      description: `Oppdater arbeidsforhold-detaljer som lønn, stillingsprosent osv.
Bruk dette for å gi lønnsforhøyelse eller endre stillingsprosent.

VIKTIG: Dette oppretter en ny "versjon" av arbeidsforholdet fra angitt dato.
Tidligere lønnshistorikk beholdes.`,
      parameters: z.object({
        employmentId: z.number().describe("Arbeidsforhold-ID fra get_employees"),
        date: z.string().describe("Dato endringen gjelder fra (YYYY-MM-DD)"),
        percentageOfFullTimeEquivalent: z.number().optional().describe("Ny stillingsprosent (0-100)"),
        annualSalary: z.number().optional().describe("Ny årslønn i NOK"),
        hourlyWage: z.number().optional().describe("Ny timelønn i NOK"),
        remunerationType: z.enum(["MONTHLY_WAGE", "HOURLY_WAGE", "COMMISSION_PERCENTAGE", "FEE", "PIECEWORK_WAGE"]).optional().describe("Ny lønnstype"),
      }),
      execute: async ({ employmentId, date, ...params }) => {
        try {
          const result = await client.createEmploymentDetails(employmentId, {
            date,
            percentageOfFullTimeEquivalent: params.percentageOfFullTimeEquivalent,
            annualSalary: params.annualSalary,
            hourlyWage: params.hourlyWage,
            remunerationType: params.remunerationType,
          });

          const details = result.value;

          return {
            success: true,
            message: `Arbeidsforhold oppdatert fra ${date}`,
            details: {
              id: details.id,
              date: details.date,
              percentageOfFullTimeEquivalent: details.percentageOfFullTimeEquivalent,
              annualSalary: details.annualSalary,
              hourlyWage: details.hourlyWage,
              remunerationType: details.remunerationType,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved oppdatering av arbeidsforhold",
          };
        }
      },
    }),

    // ==================== EMPLOYMENT DETAILS ====================

    get_employment_details: tool({
      description: `Hent detaljerte arbeidsforhold for ansatte.
Viser lønn, stillingsprosent, startdato, lønnstype mm.
Bruk dette for å:
- Se nåværende lønn for en ansatt
- Sjekke stillingsprosent
- Se lønnshistorikk (endringer over tid)`,
      parameters: z.object({
        employeeId: z.number().optional().describe("Filtrer på ansatt-ID (valgfritt, henter alle hvis ikke oppgitt)"),
      }),
      execute: async ({ employeeId }) => {
        try {
          const result = await client.getEmployments(employeeId);
          
          return {
            success: true,
            count: result.values.length,
            employments: result.values.map(emp => ({
              id: emp.id,
              employeeId: emp.employee?.id,
              employeeName: emp.employee ? `${emp.employee.firstName} ${emp.employee.lastName}`.trim() : "Ukjent",
              startDate: emp.startDate,
              endDate: emp.endDate,
              isMainEmployer: emp.isMainEmployer,
              taxDeductionCode: emp.taxDeductionCode,
              details: emp.employmentDetails?.map(d => ({
                id: d.id,
                date: d.date,
                employmentType: d.employmentType,
                employmentForm: d.employmentForm,
                remunerationType: d.remunerationType,
                percentageOfFullTimeEquivalent: d.percentageOfFullTimeEquivalent,
                annualSalary: d.annualSalary,
                hourlyWage: d.hourlyWage,
              })),
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av arbeidsforhold",
          };
        }
      },
    }),

    // ==================== SALARY TRANSACTIONS (Lønnskjøring) - SMART ====================

    run_payroll: tool({
      description: `ENKEL lønnskjøring - henter automatisk fastlønn fra arbeidsforhold.

VIKTIG BEGRENSNING:
Lønnskjøringen opprettes med status "Under bearbeiding".
Bruker MÅ fullføre lønnskjøringen manuelt i Tripletex UI for at:
- Lønnsslipper skal genereres
- Skattetrekk skal beregnes ferdig
- Utbetaling kan skje

Bruk denne for enkle lønnskjøringer uten ekstra poster.
Systemet henter automatisk:
- Ansattes årslønn fra arbeidsforhold
- Beregner månedslønn (årslønn / 12)
- Bruker standard fastlønn-type (salaryTypeId 39629335)

For å legge til ekstra poster (overtid, bonus, etc.) på en EKSISTERENDE lønnskjøring:
→ Bruk add_to_payroll tool i stedet

VIKTIG FOR AI-AGENTEN:
- Hvis INGEN employeeIds er oppgitt, returner requiresConfirmation=true
- AI-en MÅ da spørre brukeren: "Skal jeg kjøre lønn for ALLE X ansatte?"
- Først når brukeren bekrefter, kall run_payroll igjen med confirmAll=true
- ALLTID informer brukeren om at lønnskjøringen må fullføres manuelt i Tripletex UI

Eksempler:
- "Kjør lønn for januar til Taco Golf" → Finn ansatt-ID først, send employeeIds
- "Kjør lønn for alle" → Først uten params (får liste), så med confirmAll=true`,
      parameters: z.object({
        year: z.number().describe("Lønnsperiode - år (f.eks. 2026)"),
        month: z.number().describe("Lønnsperiode - måned (1-12)"),
        employeeIds: z.array(z.number()).optional().describe("Spesifikke ansatt-IDer (valgfritt)"),
        confirmAll: z.boolean().optional().describe("Sett til true for å bekrefte lønnskjøring for ALLE ansatte"),
      }),
      execute: async (params) => {
        try {
          // Hent alle ansatte med arbeidsforhold
          const employeesResult = await client.getEmployees();
          const allEmployees = employeesResult.values.filter(e => 
            e.employments && e.employments.length > 0
          );

          if (allEmployees.length === 0) {
            return {
              success: false,
              error: "Ingen ansatte med aktivt arbeidsforhold funnet.",
            };
          }

          // Hvis spesifikke ansatte er oppgitt, filtrer
          let targetEmployees = allEmployees;
          if (params.employeeIds && params.employeeIds.length > 0) {
            targetEmployees = allEmployees.filter(e => params.employeeIds!.includes(e.id));
            if (targetEmployees.length === 0) {
              return {
                success: false,
                error: `Ingen av de oppgitte ansatt-IDene (${params.employeeIds.join(", ")}) har aktivt arbeidsforhold.`,
              };
            }
          } else if (!params.confirmAll) {
            // Ingen spesifikke ansatte og ikke bekreftet - returner liste for bekreftelse
            return {
              success: true,
              requiresConfirmation: true,
              message: `Fant ${allEmployees.length} ansatte med arbeidsforhold. AI-agenten MÅ spørre brukeren om bekreftelse før lønnskjøring.`,
              employees: allEmployees.map(e => ({
                id: e.id,
                name: `${e.firstName} ${e.lastName}`.trim(),
                hasEmployment: true,
              })),
              instruction: "Spør brukeren: 'Skal jeg kjøre lønn for alle X ansatte for [måned] [år]? Svar ja for å bekrefte.'",
            };
          }

          // Bygg payslips med automatisk lønn
          // Henter arbeidsforhold per ansatt for å få employmentDetails
          const payslipsData: Array<{
            employeeId: number;
            employeeName: string;
            monthlySalary: number;
            error?: string;
          }> = [];

          for (const emp of targetEmployees) {
            const employeeName = `${emp.firstName} ${emp.lastName}`.trim();
            
            // Hent arbeidsforhold spesifikt for denne ansatte
            const employmentResult = await client.getEmployments(emp.id);
            const employments = employmentResult.values;
            
            if (!employments || employments.length === 0) {
              payslipsData.push({
                employeeId: emp.id,
                employeeName,
                monthlySalary: 0,
                error: "Mangler arbeidsforhold",
              });
              continue;
            }

            // Finn hovedarbeidsforhold (eller det første)
            const employment = employments.find(e => e.isMainEmployer) || employments[0];
            
            if (!employment.employmentDetails || employment.employmentDetails.length === 0) {
              payslipsData.push({
                employeeId: emp.id,
                employeeName,
                monthlySalary: 0,
                error: "Mangler arbeidsforhold-detaljer",
              });
              continue;
            }

            // Finn nyeste employment details (sortert på dato)
            const latestDetails = employment.employmentDetails
              .sort((a, b) => new Date(b.date || "").getTime() - new Date(a.date || "").getTime())[0];

            let monthlySalary = 0;
            if (latestDetails.annualSalary && latestDetails.annualSalary > 0) {
              monthlySalary = Math.round(latestDetails.annualSalary / 12);
            } else if (latestDetails.hourlyWage && latestDetails.hourlyWage > 0) {
              // For timelønnede - standard 162,5 timer/mnd (37,5 timer/uke)
              monthlySalary = Math.round(latestDetails.hourlyWage * 162.5);
            }

            if (monthlySalary === 0) {
              payslipsData.push({
                employeeId: emp.id,
                employeeName,
                monthlySalary: 0,
                error: "Ingen lønn registrert i arbeidsforhold",
              });
              continue;
            }

            payslipsData.push({
              employeeId: emp.id,
              employeeName,
              monthlySalary,
            });
          }

          // Filtrer ut de med feil
          const validPayslips = payslipsData.filter(p => !p.error && p.monthlySalary > 0);
          const invalidPayslips = payslipsData.filter(p => p.error || p.monthlySalary === 0);

          if (validPayslips.length === 0) {
            return {
              success: false,
              error: "Ingen ansatte har gyldig lønn registrert.",
              details: invalidPayslips,
            };
          }

          // Beregn utbetalingsdato (siste dag i måneden)
          const lastDayOfMonth = new Date(params.year, params.month, 0).getDate();
          const paymentDate = `${params.year}-${String(params.month).padStart(2, "0")}-${lastDayOfMonth}`;

          // Fastlønn salaryTypeId
          const FASTLONN_SALARY_TYPE_ID = 39629335;

          // Opprett lønnskjøring med automatisk skattetrekk
          const result = await client.createSalaryTransaction(
            {
              date: paymentDate,
              year: params.year,
              month: params.month,
              payslips: validPayslips.map(p => ({
                employee: { id: p.employeeId },
                specifications: [{
                  salaryType: { id: FASTLONN_SALARY_TYPE_ID },
                  rate: p.monthlySalary,
                  count: 1,
                  description: "Fastlønn",
                }],
              })),
            },
            true // generateTaxDeduction = true for å fullføre lønnskjøringen
          );

          const tx = result.value;
          const totalGross = validPayslips.reduce((sum, p) => sum + p.monthlySalary, 0);

          return {
            success: true,
            message: `Lønnskjøring opprettet for ${getMonthName(params.month)} ${params.year}`,
            warning: "Lønnskjøringen har status 'Under bearbeiding' og må fullføres manuelt i Tripletex UI før lønnsslipper genereres.",
            nextStep: "Gå til Tripletex → Lønn → Lønnskjøring og klikk 'Fullfør lønnskjøring'",
            transaction: {
              id: tx.id,
              date: tx.date,
              year: tx.year,
              month: tx.month,
              payslipCount: tx.payslips?.length ?? validPayslips.length,
            },
            summary: {
              totalEmployees: validPayslips.length,
              totalGrossSalary: totalGross,
              paymentDate,
            },
            payslips: validPayslips.map(p => ({
              employeeId: p.employeeId,
              employeeName: p.employeeName,
              grossAmount: p.monthlySalary,
            })),
            skipped: invalidPayslips.length > 0 ? invalidPayslips : undefined,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved lønnskjøring",
          };
        }
      },
    }),

    // ==================== SALARY TRANSACTIONS (Lønnskjøring) - CREATE ====================

    create_salary_transaction: tool({
      description: `Kjør lønn for ansatte - opprett en lønnskjøring.

VIKTIG BEGRENSNING:
Lønnskjøringen opprettes med status "Under bearbeiding".
Bruker MÅ fullføre lønnskjøringen manuelt i Tripletex UI for at:
- Lønnsslipper skal genereres
- Skattetrekk skal beregnes ferdig
- Utbetaling kan skje

AVANSERT BRUK (spesifiser lønn):
- Oppgi customPayslips med detaljerte spesifikasjoner per ansatt
- Hver spesifikasjon KREVER rate og count (Tripletex API krav)
- For fastlønn: rate=månedslønn, count=1
- For overtid: rate=timesats, count=antall timer
- Skattetrekk beregnes automatisk når generateTaxDeduction=true (default)

For å legge til ekstra poster (overtid, bonus, etc.) på en EKSISTERENDE lønnskjøring:
→ Bruk add_to_payroll tool i stedet

VIKTIG:
- date er utbetalingsdato
- year/month er lønnsperioden
- Bruk get_salary_types for å finne riktig salaryTypeId (f.eks. 39629335 for Fastlønn)
- Bruk get_employment_details for å se ansattes lønn`,
      parameters: z.object({
        date: z.string().describe("Utbetalingsdato (YYYY-MM-DD)"),
        year: z.number().describe("Lønnsperiode - år (f.eks. 2025)"),
        month: z.number().describe("Lønnsperiode - måned (1-12)"),
        customPayslips: z.array(z.object({
          employeeId: z.number().describe("Ansatt-ID"),
          specifications: z.array(z.object({
            salaryTypeId: z.number().describe("Lønnstype-ID fra get_salary_types (f.eks. 39629335 for Fastlønn)"),
            rate: z.number().describe("Sats/beløp (f.eks. månedslønn eller timesats)"),
            count: z.number().describe("Antall (1 for månedslønn, antall timer for overtid)"),
            description: z.string().optional().describe("Beskrivelse av lønnsposten"),
          })).describe("Liste med lønnsposter - KREVER rate og count"),
        })).describe("Lønnsslipper med spesifikasjoner per ansatt"),
        voucherComment: z.string().optional().describe("Kommentar på bilaget"),
        generateTaxDeduction: z.boolean().optional().default(true).describe("Generer skattetrekk automatisk og fullfør lønnskjøringen (default: true)"),
      }),
      execute: async (params) => {
        try {
          if (!params.customPayslips || params.customPayslips.length === 0) {
            return {
              success: false,
              error: "Du må oppgi customPayslips med minst én ansatt og lønnsspesifikasjoner. Bruk get_employment_details for å se ansattes lønn og get_salary_types for å finne salaryTypeId.",
            };
          }

          const payslips = params.customPayslips.map(ps => ({
            employee: { id: ps.employeeId },
            specifications: ps.specifications.map(spec => ({
              salaryType: { id: spec.salaryTypeId },
              rate: spec.rate,
              count: spec.count,
              description: spec.description,
            })),
          }));

          const result = await client.createSalaryTransaction(
            {
              date: params.date,
              year: params.year,
              month: params.month,
              payslips: payslips.map(ps => ({
                employee: ps.employee,
                specifications: ps.specifications,
              })),
            },
            params.generateTaxDeduction ?? true // generateTaxDeduction for å fullføre lønnskjøringen
          );

          const tx = result.value;

          return {
            success: true,
            message: `Lønnskjøring opprettet for ${params.year}-${String(params.month).padStart(2, '0')}`,
            warning: "Lønnskjøringen har status 'Under bearbeiding' og må fullføres manuelt i Tripletex UI før lønnsslipper genereres.",
            nextStep: "Gå til Tripletex → Lønn → Lønnskjøring og klikk 'Fullfør lønnskjøring'",
            transaction: {
              id: tx.id,
              date: tx.date,
              year: tx.year,
              month: tx.month,
              payrollTaxAmount: tx.payrollTaxAmount,
              payslipCount: tx.payslips?.length ?? 0,
              payslips: tx.payslips?.map(ps => ({
                id: ps.id,
                employeeName: ps.employee ? `${ps.employee.firstName} ${ps.employee.lastName}`.trim() : "Ukjent",
                grossAmount: ps.grossAmount,
                taxDeduction: ps.taxDeductionAmount,
                netAmount: ps.amount,
              })),
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved opprettelse av lønnskjøring",
          };
        }
      },
    }),

    delete_salary_transaction: tool({
      description: `Slett en lønnskjøring.
Bruk dette for å reversere en feilaktig lønnskjøring.

VIKTIG: 
- Kan kun slette lønnskjøringer som IKKE er bokført/utbetalt
- Etter sletting må du kjøre lønn på nytt hvis ønskelig`,
      parameters: z.object({
        transactionId: z.number().describe("Lønnskjøring-ID fra get_salary_transactions eller create_salary_transaction"),
      }),
      execute: async ({ transactionId }) => {
        try {
          await client.deleteSalaryTransaction(transactionId);
          
          return {
            success: true,
            message: `Lønnskjøring ${transactionId} er slettet`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved sletting av lønnskjøring",
          };
        }
      },
    }),

    // ==================== ADD TO EXISTING PAYROLL ====================

    add_to_payroll: tool({
      description: `Legg til ekstra lønnsposter (overtid, bonus, etc.) på en EKSISTERENDE lønnskjøring.

VIKTIG: Tripletex API støtter IKKE direkte oppdatering av lønnskjøringer.
Denne toolen:
1. Henter eksisterende lønnskjøring med alle poster
2. Sletter den eksisterende lønnskjøringen
3. Oppretter ny lønnskjøring med alle opprinnelige poster + de nye postene

Bruk get_salary_types for å finne riktig salaryTypeId for overtid, bonus, etc.
Bruk get_salary_transactions for å finne transactionId for eksisterende lønnskjøring.

Vanlige lønnstyper (kan variere per bedrift):
- Overtid 50%: nummer 2007
- Overtid 100%: nummer 2008
- Bonus: nummer 2010
- Feriepenger: nummer 2020

Eksempel:
- "Legg til 10 timer overtid 50% på lønnskjøringen for januar"
  → Finn transactionId fra get_salary_transactions
  → Finn salaryTypeId for overtid fra get_salary_types
  → Kall add_to_payroll med transactionId og additions`,
      parameters: z.object({
        transactionId: z.number().describe("ID til eksisterende lønnskjøring fra get_salary_transactions"),
        additions: z.array(z.object({
          employeeId: z.number().describe("Ansatt-ID som skal få tillegget"),
          salaryTypeId: z.number().describe("Lønnstype-ID (fra get_salary_types)"),
          rate: z.number().describe("Sats - beløp per enhet (timesats for overtid, totalbeløp for bonus)"),
          count: z.number().describe("Antall enheter (timer for overtid, 1 for fast beløp)"),
          description: z.string().optional().describe("Beskrivelse av posten (f.eks. 'Overtid 50% - prosjekt X')"),
        })).describe("Liste over lønnsposter som skal legges til"),
      }),
      execute: async ({ transactionId, additions }) => {
        try {
          // 1. Hent eksisterende lønnskjøring med alle payslips og specifications
          const existingResult = await client.getSalaryTransaction(transactionId);
          const existingTx = existingResult.value;

          if (!existingTx) {
            return {
              success: false,
              error: `Fant ikke lønnskjøring med ID ${transactionId}`,
            };
          }

          // Valider påkrevde felter
          if (!existingTx.date || !existingTx.year || !existingTx.month) {
            return {
              success: false,
              error: "Lønnskjøringen mangler dato, år eller måned",
            };
          }

          if (!existingTx.payslips || existingTx.payslips.length === 0) {
            return {
              success: false,
              error: "Lønnskjøringen har ingen lønnsslipper å oppdatere",
            };
          }

          // 2. Bygg ny payslips-struktur med eksisterende + nye poster
          const newPayslips = existingTx.payslips.map(ps => {
            const employeeId = ps.employee?.id;
            if (!employeeId) {
              return null;
            }

            // Hent eksisterende specifications
            const existingSpecs = (ps.specifications || []).map(spec => ({
              salaryType: { id: spec.salaryType?.id || 0 },
              rate: spec.rate || 0,
              count: spec.count || 1,
              description: spec.description || "",
            }));

            // Finn nye poster for denne ansatte
            const newSpecs = additions
              .filter(a => a.employeeId === employeeId)
              .map(a => ({
                salaryType: { id: a.salaryTypeId },
                rate: a.rate,
                count: a.count,
                description: a.description || "",
              }));

            return {
              employee: { id: employeeId },
              specifications: [...existingSpecs, ...newSpecs],
            };
          }).filter(Boolean) as Array<{
            employee: { id: number };
            specifications: Array<{
              salaryType: { id: number };
              rate: number;
              count: number;
              description: string;
            }>;
          }>;

          // Sjekk at alle additions har gyldig ansatt i lønnskjøringen
          const employeeIdsInPayroll = existingTx.payslips.map(ps => ps.employee?.id).filter(Boolean);
          const invalidEmployeeIds = additions
            .filter(a => !employeeIdsInPayroll.includes(a.employeeId))
            .map(a => a.employeeId);

          if (invalidEmployeeIds.length > 0) {
            return {
              success: false,
              error: `Ansatt-ID(er) ${invalidEmployeeIds.join(", ")} finnes ikke i lønnskjøringen. Gyldige ansatt-IDer: ${employeeIdsInPayroll.join(", ")}`,
            };
          }

          // 3. Slett eksisterende lønnskjøring
          await client.deleteSalaryTransaction(transactionId);

          // 4. Opprett ny lønnskjøring med alle poster
          const result = await client.createSalaryTransaction(
            {
              date: existingTx.date,
              year: existingTx.year,
              month: existingTx.month,
              payslips: newPayslips,
            },
            true // generateTaxDeduction
          );

          const newTx = result.value;

          // Beregn totaler for de nye postene
          const additionsSummary = additions.map(a => ({
            employeeId: a.employeeId,
            amount: a.rate * a.count,
            description: a.description || `Tillegg (type ${a.salaryTypeId})`,
          }));
          const totalAdditions = additionsSummary.reduce((sum, a) => sum + a.amount, 0);

          return {
            success: true,
            message: `Lønnskjøring oppdatert for ${getMonthName(existingTx.month)} ${existingTx.year}`,
            warning: "Lønnskjøringen har status 'Under bearbeiding' og må fullføres manuelt i Tripletex UI.",
            nextStep: "Gå til Tripletex → Lønn → Lønnskjøring og klikk 'Fullfør lønnskjøring'",
            oldTransactionId: transactionId,
            newTransaction: {
              id: newTx.id,
              date: newTx.date,
              year: newTx.year,
              month: newTx.month,
              payslipCount: newTx.payslips?.length ?? 0,
            },
            addedItems: additionsSummary,
            totalAdditions,
            payslips: newTx.payslips?.map(ps => ({
              id: ps.id,
              employeeName: ps.employee ? `${ps.employee.firstName} ${ps.employee.lastName}`.trim() : "Ukjent",
              grossAmount: ps.grossAmount,
              taxDeduction: ps.taxDeductionAmount,
              netAmount: ps.amount,
              specifications: ps.specifications?.map(spec => ({
                type: spec.salaryType?.name || spec.salaryType?.number?.toString() || "Ukjent",
                rate: spec.rate,
                count: spec.count,
                amount: (spec.rate || 0) * (spec.count || 1),
                description: spec.description,
              })),
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved oppdatering av lønnskjøring",
          };
        }
      },
    }),

    // ==================== PAYSLIP PDF ====================

    get_payslip_pdf_url: tool({
      description: `Hent URL for å laste ned lønnsslipp som PDF.
Returnerer en URL som brukeren kan klikke på for å laste ned PDF-en.`,
      parameters: z.object({
        payslipId: z.number().describe("Lønnsslipp-ID fra get_payslips"),
      }),
      execute: async ({ payslipId }) => {
        try {
          // Verify the payslip exists
          const payslip = await client.getPayslip(payslipId);
          const ps = payslip.value;
          
          return {
            success: true,
            payslip: {
              id: ps.id,
              employeeName: ps.employee ? `${ps.employee.firstName} ${ps.employee.lastName}`.trim() : "Ukjent",
              period: `${ps.year}-${String(ps.month).padStart(2, '0')}`,
            },
            // Return the API endpoint URL - frontend will handle the actual download
            downloadUrl: `/api/tripletex/payslip/${payslipId}/pdf`,
            message: `Lønnsslipp for ${ps.employee?.firstName} ${ps.employee?.lastName} (${ps.year}-${String(ps.month).padStart(2, '0')}) kan lastes ned.`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av lønnsslipp PDF",
          };
        }
      },
    }),

    // ==================== ACCOUNTS (Kontoplan) ====================

    get_accounts: tool({
      description: `Hent kontoplan fra Tripletex.
Returnerer alle aktive kontoer med kontonummer, navn og MVA-type.
Bruk dette for å:
- Se hvilke kontoer som er tilgjengelige
- Finne riktig konto for bokføring
- Sjekke MVA-type på kontoer`,
      parameters: z.object({
        type: z.enum(["ASSETS", "EQUITY", "LIABILITIES", "OPERATING_REVENUES", "OPERATING_EXPENSES"]).optional()
          .describe("Filtrer på kontotype"),
        isInactive: z.boolean().optional().describe("Inkluder inaktive kontoer"),
      }),
      execute: async (params) => {
        try {
          const result = await client.getAccounts({
            ...params,
            count: 1000,
          });
          
          return {
            success: true,
            count: result.values.length,
            accounts: result.values.map(acc => ({
              id: acc.id,
              number: acc.number,
              name: acc.name,
              type: acc.type,
              vatType: acc.vatType ? {
                id: acc.vatType.id,
                name: acc.vatType.name,
                percentage: acc.vatType.percentage,
              } : null,
              isInactive: acc.isInactive,
              isBankAccount: acc.isBankAccount,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av kontoplan",
          };
        }
      },
    }),

    suggest_account: tool({
      description: `Få AI-forslag til beste konto for en utgift eller inntekt.
Bruker AI til å analysere beskrivelsen og foreslå de 3 beste kontoene fra kontoplanen.
Inkluderer MVA-veiledning (fradragsrett, satser, spesialregler).

Bruk dette NÅR:
- Bruker beskriver en utgift/kvittering
- Du trenger å velge riktig konto for bilagsføring
- Du er usikker på MVA-behandling`,
      parameters: z.object({
        description: z.string().describe("Beskrivelse av utgiften/inntekten (f.eks. 'fly til Oslo', 'programvare', 'kundemiddag')"),
        accountType: z.enum(["expense", "income", "asset", "liability"]).describe("Type transaksjon"),
      }),
      execute: async ({ description, accountType }) => {
        try {
          const accountExpert = createAccountExpert(client, parseInt(companyId));
          const result = await accountExpert.suggestAccounts(description, accountType);
          
          return {
            success: true,
            searchDescription: result.searchDescription,
            suggestions: result.suggestions.map((s, index) => ({
              rank: index + 1,
              accountNumber: s.number,
              accountName: s.name,
              reason: s.reason,
              vatDeductible: s.vatDeductible,
              vatNote: s.vatNote,
            })),
            tip: result.suggestions[0]?.vatNote 
              ? `MVA-tips: ${result.suggestions[0].vatNote}` 
              : undefined,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved kontoforslag",
          };
        }
      },
    }),

    // ==================== VAT TYPES (MVA) ====================

    get_vat_types: tool({
      description: `Hent tilgjengelige MVA-typer fra Tripletex.
Returnerer alle MVA-koder med satser.
Bruk dette for å:
- Se hvilke MVA-koder som er tilgjengelige
- Finne riktig MVA-kode for bilagsføring`,
      parameters: z.object({}),
      execute: async () => {
        try {
          const result = await client.getVatTypes();
          
          return {
            success: true,
            count: result.values.length,
            vatTypes: result.values.map(vt => ({
              id: vt.id,
              number: vt.number,
              name: vt.name,
              percentage: vt.percentage,
            })),
            commonTypes: {
              "25%": "Standard MVA (de fleste varer og tjenester)",
              "15%": "Matservering",
              "12%": "Transport, overnatting, kino",
              "0%": "Fritatt eller utenfor MVA-området",
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av MVA-typer",
          };
        }
      },
    }),

    assess_vat: tool({
      description: `Få AI-vurdering av MVA-behandling for en transaksjon.
Analyserer beskrivelsen og gir veiledning om:
- Riktig MVA-sats
- Om det er fradragsrett
- Eventuelle spørsmål som må avklares

Bruk dette for komplekse MVA-spørsmål som:
- Representasjon vs internt møte
- Innenlands vs utenlands reise
- Velferd vs drift`,
      parameters: z.object({
        description: z.string().describe("Beskrivelse av transaksjonen"),
        transactionType: z.enum(["expense", "income"]).describe("Utgift eller inntekt"),
        accountNumber: z.number().optional().describe("Kontonummer hvis kjent"),
      }),
      execute: async ({ description, transactionType, accountNumber }) => {
        try {
          const vatExpert = createVatExpert(client, parseInt(companyId));
          const assessment = await vatExpert.assessVat(description, transactionType, accountNumber);
          
          return {
            success: true,
            assessment: {
              suggestedVatCode: assessment.suggestedVatCode,
              vatRate: assessment.vatRate,
              hasDeduction: assessment.hasDeduction,
              reason: assessment.reason,
            },
            needsClarification: assessment.needsClarification,
            clarificationQuestion: assessment.clarificationQuestion,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved MVA-vurdering",
          };
        }
      },
    }),

    // ==================== VOUCHERS (Bilag) ====================

    search_vouchers: tool({
      description: `Søk etter bilag/vouchers i Tripletex.
Returnerer bilag med posteringer, beløp og beskrivelser.
Bruk dette for å:
- Finne tidligere bilag
- Sjekke hva som er bokført
- Se bilagshistorikk`,
      parameters: z.object({
        dateFrom: z.string().optional().describe("Fra dato (YYYY-MM-DD)"),
        dateTo: z.string().optional().describe("Til dato (YYYY-MM-DD)"),
        number: z.string().optional().describe("Bilagsnummer (som streng)"),
        numberFrom: z.number().optional().describe("Fra bilagsnummer"),
        numberTo: z.number().optional().describe("Til bilagsnummer"),
      }),
      execute: async (params) => {
        try {
          const result = await client.getVouchers(params);
          
          return {
            success: true,
            count: result.values.length,
            vouchers: result.values.map(v => ({
              id: v.id,
              number: v.number,
              date: v.date,
              description: v.description,
              voucherType: v.voucherType?.name,
              postings: v.postings?.map(p => ({
                account: p.account?.number,
                accountName: p.account?.name,
                amount: p.amount,
                amountCurrency: p.amountCurrency,
                description: p.description,
              })),
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved søk etter bilag",
          };
        }
      },
    }),

    get_voucher: tool({
      description: `Hent detaljer om ett spesifikt bilag.
Inkluderer alle posteringer og vedlegg.`,
      parameters: z.object({
        voucherId: z.number().describe("Bilag-ID"),
      }),
      execute: async ({ voucherId }) => {
        try {
          const result = await client.getVoucher(voucherId);
          const v = result.value;
          
          return {
            success: true,
            voucher: {
              id: v.id,
              number: v.number,
              date: v.date,
              description: v.description,
              voucherType: v.voucherType?.name,
              postings: v.postings?.map(p => ({
                id: p.id,
                account: p.account?.number,
                accountName: p.account?.name,
                amount: p.amount,
                amountCurrency: p.amountCurrency,
                description: p.description,
                customer: p.customer?.name,
                supplier: p.supplier?.name,
              })),
              hasAttachment: !!v.attachment,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av bilag",
          };
        }
      },
    }),

    create_voucher: tool({
      description: `Opprett et nytt bilag i Tripletex.
Bruk dette for å bokføre utgifter, kvitteringer og andre transaksjoner.

VIKTIG REGLER:
1. Posteringer MÅ balansere (debet = kredit)
2. Bruk suggest_account først for å finne riktig konto
3. Bruk assess_vat for MVA-veiledning

Vanlig bilagsstruktur:
- Utgift: Debet kostnadskonto, Kredit leverandørgjeld/bank
- Inntekt: Debet kundefordring/bank, Kredit inntektskonto`,
      parameters: z.object({
        date: z.string().describe("Bilagsdato (YYYY-MM-DD)"),
        description: z.string().describe("Beskrivelse av bilaget"),
        postings: z.array(z.object({
          accountNumber: z.number().describe("Kontonummer (f.eks. 7140 for reise)"),
          amount: z.number().describe("Beløp (positivt = debet, negativt = kredit)"),
          description: z.string().optional().describe("Beskrivelse av posteringen"),
          vatTypeId: z.number().optional().describe("MVA-type ID (fra get_vat_types)"),
          supplierId: z.number().optional().describe("Leverandør-ID hvis relevant"),
          customerId: z.number().optional().describe("Kunde-ID hvis relevant"),
        })).describe("Liste med posteringer (må balansere)"),
      }),
      execute: async ({ date, description, postings }) => {
        try {
          // Valider at posteringer balanserer
          const total = postings.reduce((sum, p) => sum + p.amount, 0);
          if (Math.abs(total) > 0.01) {
            return {
              success: false,
              error: `Posteringer balanserer ikke. Differanse: ${total.toFixed(2)} kr. Debet må være lik kredit.`,
            };
          }

          // Hent konto-IDer basert på kontonummer
          const accountsResult = await client.getAccounts({ count: 1000 });
          const accountMap = new Map(accountsResult.values.map(a => [a.number, { id: a.id, name: a.name }]));

          const formattedPostings = postings.map((p, index) => {
            const accountInfo = accountMap.get(p.accountNumber);
            if (!accountInfo) {
              throw new Error(`Konto ${p.accountNumber} finnes ikke i kontoplanen`);
            }
            // NOTE: Bruker sekvensielle row-numre her. For enkel debet/kredit-visning på samme rad,
            // kan row settes til samme verdi (se register_expense for eksempel).
            return {
              row: index + 1,  // Starter på 1 (row 0 er reservert for systemgenererte posteringer)
              date: date,  // Posteringsdato
              account: { id: accountInfo.id },
              amountGross: p.amount,
              amountGrossCurrency: p.amount,
              description: p.description,
              vatType: p.vatTypeId ? { id: p.vatTypeId } : undefined,
              supplier: p.supplierId ? { id: p.supplierId } : undefined,
              customer: p.customerId ? { id: p.customerId } : undefined,
            };
          });

          const result = await client.createVoucher({
            date,
            description,
            postings: formattedPostings,
          });

          const v = result.value;

          return {
            success: true,
            message: `Bilag ${v.number} opprettet`,
            voucher: {
              id: v.id,
              number: v.number,
              date: v.date,
              description: v.description,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved opprettelse av bilag",
          };
        }
      },
    }),

    get_voucher_types: tool({
      description: `Hent alle bilagstyper fra Tripletex.
Viser tilgjengelige bilagstyper som kan brukes ved opprettelse av bilag.`,
      parameters: z.object({}),
      execute: async () => {
        try {
          const result = await client.getVoucherTypes();
          return {
            success: true,
            count: result.values.length,
            voucherTypes: result.values.map(vt => ({
              id: vt.id,
              name: vt.name,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil",
          };
        }
      },
    }),

    reverse_voucher: tool({
      description: `Reverser et eksisterende bilag.
Oppretter et motbilag som nuller ut det opprinnelige bilaget.
Bruk dette for å korrigere feil.`,
      parameters: z.object({
        voucherId: z.number().describe("ID til bilaget som skal reverseres"),
        date: z.string().describe("Dato for reverseringsbilaget (YYYY-MM-DD)"),
      }),
      execute: async ({ voucherId, date }) => {
        try {
          const result = await client.reverseVoucher(voucherId, date);
          const v = result.value;

          return {
            success: true,
            message: `Bilag reversert`,
            reversalVoucher: {
              id: v.id,
              number: v.number,
              date: v.date,
              description: v.description,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved reversering av bilag",
          };
        }
      },
    }),

    // ==================== CUSTOMERS (Kunder) ====================

    search_customers: tool({
      description: `Søk etter kunder i Tripletex.
Returnerer kundeliste med kontaktinfo.`,
      parameters: z.object({
        name: z.string().optional().describe("Søk på navn"),
        organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
        email: z.string().optional().describe("E-postadresse"),
        isInactive: z.boolean().optional().describe("Inkluder inaktive kunder"),
      }),
      execute: async (params) => {
        try {
          let customers;
          if (params.name) {
            customers = await client.searchCustomerByName(params.name);
          } else {
            const result = await client.getCustomers({
              organizationNumber: params.organizationNumber,
              email: params.email,
              isInactive: params.isInactive,
              count: 100,
            });
            customers = result.values;
          }

          return {
            success: true,
            count: customers.length,
            customers: customers.map(c => ({
              id: c.id,
              name: c.name,
              organizationNumber: c.organizationNumber,
              email: c.email,
              phoneNumber: c.phoneNumber,
              customerNumber: c.customerNumber,
              isInactive: c.isInactive,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved søk etter kunder",
          };
        }
      },
    }),

    get_customer: tool({
      description: `Hent detaljer om én kunde.`,
      parameters: z.object({
        customerId: z.number().describe("Kunde-ID"),
      }),
      execute: async ({ customerId }) => {
        try {
          const result = await client.getCustomer(customerId);
          const c = result.value;

          return {
            success: true,
            customer: {
              id: c.id,
              name: c.name,
              organizationNumber: c.organizationNumber,
              email: c.email,
              invoiceEmail: c.invoiceEmail,
              phoneNumber: c.phoneNumber,
              customerNumber: c.customerNumber,
              isInactive: c.isInactive,
              physicalAddress: c.physicalAddress,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av kunde",
          };
        }
      },
    }),

    create_customer: tool({
      description: `Opprett en ny kunde i Tripletex.`,
      parameters: z.object({
        name: z.string().describe("Kundenavn"),
        organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
        email: z.string().optional().describe("E-postadresse"),
        invoiceEmail: z.string().optional().describe("Faktura-e-post"),
        phoneNumber: z.string().optional().describe("Telefonnummer"),
        addressLine1: z.string().optional().describe("Adresselinje 1"),
        postalCode: z.string().optional().describe("Postnummer"),
        city: z.string().optional().describe("Poststed"),
      }),
      execute: async (params) => {
        try {
          const result = await client.createCustomer({
            name: params.name,
            organizationNumber: params.organizationNumber,
            email: params.email,
            invoiceEmail: params.invoiceEmail,
            phoneNumber: params.phoneNumber,
            physicalAddress: (params.addressLine1 || params.postalCode || params.city) ? {
              addressLine1: params.addressLine1,
              postalCode: params.postalCode,
              city: params.city,
            } : undefined,
          });

          const c = result.value;

          return {
            success: true,
            message: `Kunde "${c.name}" opprettet`,
            customer: {
              id: c.id,
              name: c.name,
              customerNumber: c.customerNumber,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved opprettelse av kunde",
          };
        }
      },
    }),

    update_customer: tool({
      description: `Oppdater en eksisterende kunde.`,
      parameters: z.object({
        customerId: z.number().describe("Kunde-ID"),
        name: z.string().optional().describe("Nytt navn"),
        email: z.string().optional().describe("Ny e-post"),
        invoiceEmail: z.string().optional().describe("Ny faktura-e-post"),
        phoneNumber: z.string().optional().describe("Nytt telefonnummer"),
        isInactive: z.boolean().optional().describe("Sett til inaktiv"),
      }),
      execute: async ({ customerId, ...params }) => {
        try {
          const input = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v !== undefined)
          );

          const result = await client.updateCustomer(customerId, input);
          const c = result.value;

          return {
            success: true,
            message: `Kunde "${c.name}" oppdatert`,
            customer: {
              id: c.id,
              name: c.name,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved oppdatering av kunde",
          };
        }
      },
    }),

    // ==================== SUPPLIERS (Leverandører) ====================

    search_suppliers: tool({
      description: `Søk etter leverandører i Tripletex.
Returnerer leverandørliste med kontaktinfo.`,
      parameters: z.object({
        name: z.string().optional().describe("Søk på navn"),
        organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
        email: z.string().optional().describe("E-postadresse"),
        isInactive: z.boolean().optional().describe("Inkluder inaktive leverandører"),
      }),
      execute: async (params) => {
        try {
          let suppliers;
          if (params.name) {
            suppliers = await client.searchSupplierByName(params.name);
          } else {
            const result = await client.getSuppliers({
              organizationNumber: params.organizationNumber,
              email: params.email,
              isInactive: params.isInactive,
              count: 100,
            });
            suppliers = result.values;
          }

          return {
            success: true,
            count: suppliers.length,
            suppliers: suppliers.map(s => ({
              id: s.id,
              name: s.name,
              organizationNumber: s.organizationNumber,
              email: s.email,
              phoneNumber: s.phoneNumber,
              supplierNumber: s.supplierNumber,
              isInactive: s.isInactive,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved søk etter leverandører",
          };
        }
      },
    }),

    get_supplier: tool({
      description: `Hent detaljer om én leverandør.`,
      parameters: z.object({
        supplierId: z.number().describe("Leverandør-ID"),
      }),
      execute: async ({ supplierId }) => {
        try {
          const result = await client.getSupplier(supplierId);
          const s = result.value;

          return {
            success: true,
            supplier: {
              id: s.id,
              name: s.name,
              organizationNumber: s.organizationNumber,
              email: s.email,
              invoiceEmail: s.invoiceEmail,
              phoneNumber: s.phoneNumber,
              supplierNumber: s.supplierNumber,
              isInactive: s.isInactive,
              postalAddress: s.postalAddress,
              bankAccounts: s.bankAccounts,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av leverandør",
          };
        }
      },
    }),

    create_supplier: tool({
      description: `Opprett en ny leverandør i Tripletex.`,
      parameters: z.object({
        name: z.string().describe("Leverandørnavn"),
        organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
        email: z.string().optional().describe("E-postadresse"),
        invoiceEmail: z.string().optional().describe("Faktura-e-post"),
        phoneNumber: z.string().optional().describe("Telefonnummer"),
        addressLine1: z.string().optional().describe("Adresselinje 1"),
        postalCode: z.string().optional().describe("Postnummer"),
        city: z.string().optional().describe("Poststed"),
      }),
      execute: async (params) => {
        try {
          const result = await client.createSupplier({
            name: params.name,
            organizationNumber: params.organizationNumber,
            email: params.email,
            invoiceEmail: params.invoiceEmail,
            phoneNumber: params.phoneNumber,
            physicalAddress: (params.addressLine1 || params.postalCode || params.city) ? {
              addressLine1: params.addressLine1,
              postalCode: params.postalCode,
              city: params.city,
            } : undefined,
          });

          const s = result.value;

          return {
            success: true,
            message: `Leverandør "${s.name}" opprettet`,
            supplier: {
              id: s.id,
              name: s.name,
              supplierNumber: s.supplierNumber,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved opprettelse av leverandør",
          };
        }
      },
    }),

    update_supplier: tool({
      description: `Oppdater en eksisterende leverandør.`,
      parameters: z.object({
        supplierId: z.number().describe("Leverandør-ID"),
        name: z.string().optional().describe("Nytt navn"),
        email: z.string().optional().describe("Ny e-post"),
        invoiceEmail: z.string().optional().describe("Ny faktura-e-post"),
        phoneNumber: z.string().optional().describe("Nytt telefonnummer"),
        isInactive: z.boolean().optional().describe("Sett til inaktiv"),
      }),
      execute: async ({ supplierId, ...params }) => {
        try {
          const input = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v !== undefined)
          );

          const result = await client.updateSupplier(supplierId, input);
          const s = result.value;

          return {
            success: true,
            message: `Leverandør "${s.name}" oppdatert`,
            supplier: {
              id: s.id,
              name: s.name,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved oppdatering av leverandør",
          };
        }
      },
    }),

    // ==================== SUPPLIER INVOICES (Leverandørfakturaer) ====================

    search_supplier_invoices: tool({
      description: `Søk etter leverandørfakturaer.
Returnerer fakturaer med beløp, status og forfallsdato.`,
      parameters: z.object({
        invoiceDateFrom: z.string().optional().describe("Fra fakturadato (YYYY-MM-DD)"),
        invoiceDateTo: z.string().optional().describe("Til fakturadato (YYYY-MM-DD)"),
        supplierId: z.string().optional().describe("Leverandør-ID"),
        isPaid: z.boolean().optional().describe("Kun betalte/ubetalte"),
      }),
      execute: async (params) => {
        try {
          const result = await client.getSupplierInvoices(params);

          return {
            success: true,
            count: result.values.length,
            invoices: result.values.map(inv => ({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate,
              dueDate: inv.dueDate,
              amount: inv.amount,
              amountCurrency: inv.amountCurrency,
              currency: inv.currency?.code,
              supplier: inv.supplier?.name,
              supplierId: inv.supplier?.id,
              isCreditNote: inv.isCreditNote,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved søk etter leverandørfakturaer",
          };
        }
      },
    }),

    get_supplier_invoices_for_approval: tool({
      description: `Hent leverandørfakturaer som venter på godkjenning.`,
      parameters: z.object({}),
      execute: async () => {
        try {
          const result = await client.getSupplierInvoicesForApproval();

          return {
            success: true,
            count: result.values.length,
            invoices: result.values.map(inv => ({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate,
              dueDate: inv.dueDate,
              amount: inv.amount,
              supplier: inv.supplier?.name,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved henting av fakturaer for godkjenning",
          };
        }
      },
    }),

    approve_supplier_invoice: tool({
      description: `Godkjenn en leverandørfaktura.`,
      parameters: z.object({
        invoiceId: z.number().describe("Faktura-ID"),
        comment: z.string().optional().describe("Godkjenningskommentar"),
      }),
      execute: async ({ invoiceId, comment }) => {
        try {
          await client.approveSupplierInvoices([invoiceId], comment);

          return {
            success: true,
            message: `Faktura ${invoiceId} godkjent`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved godkjenning av faktura",
          };
        }
      },
    }),

    reject_supplier_invoice: tool({
      description: `Avvis en leverandørfaktura.`,
      parameters: z.object({
        invoiceId: z.number().describe("Faktura-ID"),
        comment: z.string().describe("Årsak til avvisning"),
      }),
      execute: async ({ invoiceId, comment }) => {
        try {
          await client.rejectSupplierInvoices([invoiceId], comment);

          return {
            success: true,
            message: `Faktura ${invoiceId} avvist`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved avvisning av faktura",
          };
        }
      },
    }),

    register_supplier_payment: tool({
      description: `Registrer betaling på en leverandørfaktura.`,
      parameters: z.object({
        invoiceId: z.number().describe("Faktura-ID"),
        paymentDate: z.string().describe("Betalingsdato (YYYY-MM-DD)"),
        amount: z.number().describe("Beløp som betales"),
        paymentTypeId: z.number().optional().describe("Betalingstype-ID"),
      }),
      execute: async ({ invoiceId, paymentDate, amount, paymentTypeId }) => {
        try {
          await client.addSupplierInvoicePayment(invoiceId, paymentDate, amount, paymentTypeId);

          return {
            success: true,
            message: `Betaling på ${amount} kr registrert på faktura ${invoiceId}`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved registrering av betaling",
          };
        }
      },
    }),

    // ==================== INVOICES (Utgående fakturaer) ====================

    search_invoices: tool({
      description: `Søk etter utgående fakturaer.`,
      parameters: z.object({
        invoiceDateFrom: z.string().optional().describe("Fra fakturadato (YYYY-MM-DD)"),
        invoiceDateTo: z.string().optional().describe("Til fakturadato (YYYY-MM-DD)"),
        customerId: z.string().optional().describe("Kunde-ID"),
      }),
      execute: async (params) => {
        try {
          const result = await client.getInvoices(params);

          return {
            success: true,
            count: result.values.length,
            invoices: result.values.map(inv => ({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate,
              dueDate: inv.invoiceDueDate,
              amount: inv.amount,
              amountCurrency: inv.amountCurrency,
              isCreditNote: inv.isCreditNote,
              isCharged: inv.isCharged,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved søk etter fakturaer",
          };
        }
      },
    }),

    create_invoice: tool({
      description: `Opprett en ny utgående faktura.
MERK: Må først opprette en ordre, deretter fakturere den.`,
      parameters: z.object({
        customerId: z.number().describe("Kunde-ID"),
        invoiceDate: z.string().describe("Fakturadato (YYYY-MM-DD)"),
        dueDate: z.string().describe("Forfallsdato (YYYY-MM-DD)"),
        orderLines: z.array(z.object({
          description: z.string().describe("Varebeskrivelse"),
          count: z.number().describe("Antall"),
          unitPriceExcludingVat: z.number().describe("Enhetspris eks. MVA"),
          vatTypeId: z.number().optional().describe("MVA-type ID"),
        })).describe("Fakturalinjer"),
      }),
      execute: async ({ customerId, invoiceDate, dueDate, orderLines }) => {
        try {
          // 1. Opprett ordre
          const orderResult = await client.createOrder({
            customer: { id: customerId },
            orderDate: invoiceDate,
            deliveryDate: invoiceDate,
            orderLines: orderLines.map(line => ({
              description: line.description,
              count: line.count,
              unitPriceExcludingVatCurrency: line.unitPriceExcludingVat,
              vatType: line.vatTypeId ? { id: line.vatTypeId } : undefined,
            })),
          });

          // 2. Opprett faktura fra ordre
          const invoiceResult = await client.createInvoice({
            invoiceDate,
            invoiceDueDate: dueDate,
            orders: [{ id: orderResult.value.id }],
          });
          const inv = invoiceResult.value;

          return {
            success: true,
            message: `Faktura ${inv.invoiceNumber} opprettet`,
            invoice: {
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate,
              amount: inv.amount,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved opprettelse av faktura",
          };
        }
      },
    }),

    send_invoice: tool({
      description: `Send en faktura til kunden via e-post.`,
      parameters: z.object({
        invoiceId: z.number().describe("Faktura-ID"),
        sendType: z.enum(["EMAIL", "EHF"]).optional().describe("Sendemetode (EMAIL eller EHF)"),
      }),
      execute: async ({ invoiceId, sendType }) => {
        try {
          await client.sendInvoice(invoiceId, sendType || "EMAIL");

          return {
            success: true,
            message: `Faktura ${invoiceId} sendt via ${sendType || "EMAIL"}`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved sending av faktura",
          };
        }
      },
    }),

    // ==================== PRODUCTS (Produkter) ====================

    search_products: tool({
      description: `Søk etter produkter i Tripletex.`,
      parameters: z.object({
        name: z.string().optional().describe("Søk på produktnavn"),
        number: z.string().optional().describe("Produktnummer"),
        isInactive: z.boolean().optional().describe("Inkluder inaktive produkter"),
      }),
      execute: async (params) => {
        try {
          const result = await client.getProducts(params);

          return {
            success: true,
            count: result.values.length,
            products: result.values.map(p => ({
              id: p.id,
              name: p.name,
              number: p.number,
              priceExcludingVat: p.priceExcludingVat,
              priceIncludingVat: p.priceIncludingVat,
              vatType: p.vatType?.name,
              isInactive: p.isInactive,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved søk etter produkter",
          };
        }
      },
    }),

    create_product: tool({
      description: `Opprett et nytt produkt i Tripletex.`,
      parameters: z.object({
        name: z.string().describe("Produktnavn"),
        number: z.string().optional().describe("Produktnummer"),
        priceExcludingVat: z.number().optional().describe("Pris eks. MVA"),
        priceIncludingVat: z.number().optional().describe("Pris inkl. MVA"),
        vatTypeId: z.number().optional().describe("MVA-type ID"),
        description: z.string().optional().describe("Produktbeskrivelse"),
      }),
      execute: async (params) => {
        try {
          const result = await client.createProduct({
            name: params.name,
            number: params.number,
            priceExcludingVat: params.priceExcludingVat,
            priceIncludingVat: params.priceIncludingVat,
            vatType: params.vatTypeId ? { id: params.vatTypeId } : undefined,
            description: params.description,
          });

          const p = result.value;

          return {
            success: true,
            message: `Produkt "${p.name}" opprettet`,
            product: {
              id: p.id,
              name: p.name,
              number: p.number,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved opprettelse av produkt",
          };
        }
      },
    }),

    // ==================== SMART TOOLS (Kombinerer flere operasjoner) ====================

    get_unmatched_bank_postings: tool({
      description: `Søk etter banktransaksjoner som kan matche en kvittering/utgift.
BRUK DETTE FØR register_expense for å sjekke om det finnes en matchende banktransaksjon.

Søker etter posteringer på bankkontoer som matcher:
- Beløpet fra kvitteringen (±5 kr margin for avrunding)
- Datoperiode rundt kvitteringsdato (±daysRange dager)

Returnerer liste over potensielle matcher som du kan vise til bruker.

VIKTIG: Negativt beløp på bankkonto = utbetaling/utgift`,
      parameters: z.object({
        amount: z.number().describe("Beløpet fra kvitteringen (positiv verdi, f.eks. 450)"),
        date: z.string().describe("Datoen fra kvitteringen (YYYY-MM-DD)"),
        daysRange: z.number().optional().default(5).describe("Antall dager ± å søke (default 5)"),
      }),
      execute: async ({ amount, date, daysRange = 5 }) => {
        try {
          // 1. Beregn dato-range
          const targetDate = new Date(date);
          const dateFrom = new Date(targetDate);
          dateFrom.setDate(dateFrom.getDate() - daysRange);
          const dateTo = new Date(targetDate);
          dateTo.setDate(dateTo.getDate() + daysRange);
          
          const dateFromStr = dateFrom.toISOString().split('T')[0];
          const dateToStr = dateTo.toISOString().split('T')[0];
          
          // 2. Hent alle bankkontoer
          const accountsResult = await client.getAccounts({ count: 1000 });
          const bankAccounts = accountsResult.values.filter(a => a.isBankAccount && !a.isInactive);
          
          if (bankAccounts.length === 0) {
            return { 
              success: true, 
              matches: [], 
              message: "Ingen aktive bankkontoer funnet i kontoplanen.",
              bankAccounts: [],
            };
          }
          
          // 3. Hent posteringer i perioden
          const postingsResult = await client.getPostings({
            dateFrom: dateFromStr,
            dateTo: dateToStr,
            count: 500,
          });
          
          // 4. Filtrer til bankkontoer og matchende beløp
          const bankAccountIds = bankAccounts.map(a => a.id);
          const matches = postingsResult.values.filter(p => {
            // Må være på en bankkonto
            if (!p.account || !bankAccountIds.includes(p.account.id)) return false;
            
            // Beløp må matche (negativt på bank = utbetaling)
            // Kvitteringsbeløp er positivt, bankutbetaling er negativt
            const postingAmount = Math.abs(p.amount || 0);
            return Math.abs(postingAmount - amount) <= 5; // ±5 kr margin
          });
          
          // Sorter etter hvor nært datoen er
          matches.sort((a, b) => {
            const aDate = new Date(a.date || '');
            const bDate = new Date(b.date || '');
            const aDiff = Math.abs(aDate.getTime() - targetDate.getTime());
            const bDiff = Math.abs(bDate.getTime() - targetDate.getTime());
            return aDiff - bDiff;
          });
          
          return {
            success: true,
            matchCount: matches.length,
            matches: matches.slice(0, 10).map(p => ({
              postingId: p.id,
              voucherId: p.voucher?.id,
              voucherNumber: p.voucher?.number,
              date: p.date,
              amount: p.amount,
              description: p.description || p.voucher?.description || "(ingen beskrivelse)",
              accountNumber: p.account?.number,
              accountName: p.account?.name,
            })),
            searchCriteria: {
              amount,
              targetDate: date,
              dateFrom: dateFromStr,
              dateTo: dateToStr,
              marginKr: 5,
            },
            bankAccounts: bankAccounts.map(a => ({ 
              id: a.id, 
              number: a.number, 
              name: a.name,
            })),
            hint: matches.length === 0 
              ? "Ingen matchende banktransaksjoner funnet. Spør bruker om utgiften er betalt eller ubetalt."
              : matches.length === 1
                ? "Én match funnet. Spør bruker om dette er samme kjøp."
                : `${matches.length} matcher funnet. Vis liste og la bruker velge.`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Feil ved søk etter bankposteringer",
          };
        }
      },
    }),

    register_expense: tool({
      description: `SMART TOOL: Registrer en utgift/kvittering med AI-assistanse.
Kombinerer kontoforslag, MVA-vurdering og bilagsopprettelse.

VIKTIG: Bruk get_unmatched_bank_postings FØR denne for å sjekke bankmatching!

Bruk dette når brukeren sier ting som:
- "Jeg har en kvittering på 500 kr for taxi"
- "Bokfør utgift til programvare på 1000 kr"
- "Registrer hotellutgift på 2500 kr"

AI-en vil:
1. Foreslå riktig konto basert på beskrivelsen
2. Vurdere MVA-behandling
3. Bestemme motkonto (bank eller leverandørgjeld)
4. Opprette bilaget med riktige posteringer

MOTKONTO-LOGIKK:
- isPaid=true → motkonto blir bankkonto (hentes fra kontoplan)
- isPaid=false → motkonto blir leverandørgjeld (hentes fra kontoplan)
- Hvis flere bankkontoer finnes, bruk counterAccountId for å spesifisere`,
      parameters: z.object({
        description: z.string().describe("Beskrivelse av utgiften (f.eks. 'taxi til flyplass', 'programvare')"),
        amount: z.number().describe("Beløp inkl. MVA"),
        date: z.string().describe("Dato (YYYY-MM-DD)"),
        supplierName: z.string().optional().describe("Leverandørnavn (valgfritt)"),
        vatRate: z.number().optional().describe("MVA-sats hvis kjent (25, 15, 12, eller 0)"),
        accountNumber: z.number().optional().describe("Kontonummer hvis kjent (overstyrer AI-forslag)"),
        isPaid: z.boolean().optional().describe("Er utgiften allerede betalt? true = motkonto bank, false = motkonto leverandørgjeld. Default: true for kvitteringer."),
        counterAccountId: z.number().optional().describe("Spesifikk motkonto-ID (IKKE kontonummer!). Bruk 'id'-feltet fra bankAccount-listen i requiresSelection-responsen."),
        matchedPostingId: z.number().optional().describe("ID til matchende bankpostering fra get_unmatched_bank_postings. For referanse/sporing."),
      }),
      execute: async ({ description, amount, date, supplierName, vatRate, accountNumber, isPaid, counterAccountId, matchedPostingId }) => {
        try {
          // 0. Validering: Beløp må være større enn 0
          if (amount <= 0) {
            return {
              success: false,
              error: "Beløp må være større enn 0 kr. Kunne ikke lese beløpet fra kvitteringen - vennligst oppgi beløpet.",
              hint: "Spør brukeren om totalbeløpet på kvitteringen (inkl. MVA).",
            };
          }

          // 1. Få kontoforslag hvis ikke oppgitt
          let suggestedAccount = accountNumber;
          let vatInfo: { rate: number; hasDeduction: boolean } | undefined;

          if (!suggestedAccount) {
            const accountExpert = createAccountExpert(client, parseInt(companyId));
            const suggestions = await accountExpert.suggestAccounts(description, "expense");
            
            if (suggestions.suggestions.length > 0) {
              suggestedAccount = suggestions.suggestions[0].number;
              vatInfo = {
                rate: vatRate ?? (suggestions.suggestions[0].vatDeductible ? 25 : 0),
                hasDeduction: suggestions.suggestions[0].vatDeductible,
              };
            }
          }

          if (!suggestedAccount) {
            return {
              success: false,
              error: "Kunne ikke finne passende konto for denne utgiften. Prøv å oppgi kontonummer manuelt.",
              suggestion: "Bruk get_accounts for å se tilgjengelige kontoer, eller suggest_account med en tydeligere beskrivelse.",
            };
          }

          // 2. Beregn MVA og nettobeløp
          const effectiveVatRate = vatRate ?? vatInfo?.rate ?? 25;
          const netAmount = Math.round((amount / (1 + effectiveVatRate / 100)) * 100) / 100;
          const vatAmount = Math.round((amount - netAmount) * 100) / 100;

          // 3. Finn eller opprett leverandør
          let supplierId: number | undefined;
          if (supplierName) {
            const contactMatcher = createContactMatcher(client);
            
            // Hvis isPaid=false, vi MÅ ha en leverandør - opprett hvis ikke funnet
            if (isPaid === false) {
              const supplierResult = await contactMatcher.findOrCreateSupplier({ name: supplierName });
              supplierId = supplierResult.id;
            } else {
              // For betalte utgifter, bare finn eksisterende (ikke opprett)
              const supplierResult = await contactMatcher.findSupplier(supplierName);
              if (supplierResult.found && supplierResult.contact) {
                supplierId = supplierResult.contact.id;
              }
            }
          }

          // 4. Hent konto-ID og MVA-type
          const accountsResult = await client.getAccounts({ count: 1000 });
          let account = accountsResult.values.find(a => a.number === suggestedAccount);
          if (!account) {
            return {
              success: false,
              error: `Konto ${suggestedAccount} finnes ikke i kontoplanen`,
            };
          }

          // Hent alle MVA-typer
          const vatTypesResult = await client.getVatTypes();
          
          // VIKTIG: Sjekk om kontoen har en låst MVA-type
          // Hvis kontoen har vatType.id = 0, kan den BARE brukes med MVA-kode 0
          const accountVatTypeId = account.vatType?.id;
          let vatType: { id: number; name?: string; percentage?: number } | undefined;
          
          if (accountVatTypeId !== undefined && accountVatTypeId !== null) {
            // Kontoen har en forhåndsdefinert MVA-type
            const lockedVatType = vatTypesResult.values.find(v => v.id === accountVatTypeId);
            
            // Sjekk om bruker ønsker MVA-fradrag men kontoen er låst til 0
            if (accountVatTypeId === 0 && effectiveVatRate > 0) {
              // For reisekostnader: Bruk 7140 (ikke oppgavepliktig) i stedet for 7130
              // siden 7140 tillater MVA-fradrag
              if (suggestedAccount === 7130) {
                const alternativeAccount = accountsResult.values.find(a => a.number === 7140);
                if (alternativeAccount && alternativeAccount.vatType?.id !== 0) {
                  account = alternativeAccount;
                  // Finn MVA-type for den nye kontoen
                  vatType = vatTypesResult.values.find(v => 
                    v.id === alternativeAccount.vatType?.id
                  );
                } else {
                  // Kan ikke bytte, bruk kontoens låste MVA-type
                  vatType = lockedVatType;
                }
              } else {
                // Andre kontoer låst til MVA 0 - bruk den låste typen
                vatType = lockedVatType;
              }
            } else {
              // Bruk kontoens låste MVA-type
              vatType = lockedVatType;
            }
          } else {
            // Kontoen har ingen låst MVA-type, finn basert på ønsket sats
            vatType = vatTypesResult.values.find(v => 
              v.percentage === effectiveVatRate && 
              (v.name?.toLowerCase().includes("inngående") || v.name?.toLowerCase().includes("fradrag"))
            );
          }

          // Oppdater effectiveVatRate basert på faktisk MVA-type som brukes
          const actualVatRate = vatType?.percentage ?? 0;
          const actualNetAmount = Math.round((amount / (1 + actualVatRate / 100)) * 100) / 100;
          const actualVatAmount = Math.round((amount - actualNetAmount) * 100) / 100;

          // 5. Bestem motkonto (bank eller leverandørgjeld) - SMART LOGIKK
          let contraAccount: { id: number; number?: number; name?: string };
          
          if (counterAccountId) {
            // Bruker har spesifisert en spesifikk motkonto
            const specifiedAccount = accountsResult.values.find(a => a.id === counterAccountId);
            if (!specifiedAccount) {
              return {
                success: false,
                error: `Motkonto med ID ${counterAccountId} finnes ikke.`,
              };
            }
            contraAccount = { id: specifiedAccount.id, number: specifiedAccount.number, name: specifiedAccount.name };
            
          } else if (isPaid !== false) {
            // BETALT (default for kvitteringer) - finn bankkonto
            const bankAccounts = accountsResult.values.filter(a => a.isBankAccount && !a.isInactive);
            
            if (bankAccounts.length === 0) {
              return {
                success: false,
                error: "Ingen bankkontoer funnet i kontoplanen. Opprett en bankkonto først, eller oppgi counterAccountId manuelt.",
              };
            } else if (bankAccounts.length === 1) {
              // Kun én bankkonto - bruk den
              contraAccount = { id: bankAccounts[0].id, number: bankAccounts[0].number, name: bankAccounts[0].name };
            } else {
              // Flere bankkontoer - returner liste så AI kan spørre bruker
              return {
                success: false,
                requiresSelection: true,
                selectionType: "bankAccount",
                options: bankAccounts.map(a => ({ id: a.id, number: a.number, name: a.name })),
                message: `Flere bankkontoer funnet (${bankAccounts.length} stk). Spør bruker hvilken som ble brukt for denne betalingen, og kall register_expense igjen med counterAccountId satt til 'id'-verdien (IKKE 'number'!) fra valgt konto.`,
              };
            }
            
          } else {
            // IKKE BETALT - finn leverandørgjeld-konto (24XX-serien)
            const apAccounts = accountsResult.values.filter(a => 
              a.number && a.number >= 2400 && a.number < 2500 && !a.isInactive
            );
            
            if (apAccounts.length === 0) {
              return {
                success: false,
                error: "Ingen leverandørgjeld-konto funnet (2400-2499) i kontoplanen.",
              };
            }
            // Velg 2400 hvis den finnes, ellers første tilgjengelige
            const chosen = apAccounts.find(a => a.number === 2400) || apAccounts[0];
            contraAccount = { id: chosen.id, number: chosen.number, name: chosen.name };
          }

          // 6. Opprett bilag med riktig format for Tripletex
          // VIKTIG: row må starte på 1, IKKE 0! Row 0 er reservert for systemgenererte posteringer!
          
          // Hvis isPaid=false (leverandørgjeld), krever Tripletex en leverandør-ID på posteringen
          let supplierForPosting: { id: number } | undefined;
          if (isPaid === false) {
            // Krever leverandør for leverandørgjeld
            if (!supplierId) {
              return {
                success: false,
                error: "For ubetalt utgift (leverandørgjeld) kreves leverandørnavn. Oppgi supplierName eller bruk isPaid=true for betalte utgifter.",
                hint: "Tripletex krever en leverandør når du bokfører mot leverandørgjeld (2400-serien). Enten oppgi leverandørnavn, eller marker utgiften som betalt (isPaid=true) for å bokføre mot bank i stedet.",
              };
            }
            supplierForPosting = { id: supplierId };
          }
          
          // POSTERINGER: Bruker row: 1 for begge slik at de vises på SAMME RAD i Tripletex UI
          // (Debet og Kredit kolonner fylles ut på én linje, i stedet for to separate rader)
          const postings = [
            // Kostnadskonto (debet - positivt beløp)
            {
              row: 1,
              date: date,
              account: { id: account.id },
              amountGross: amount,
              amountGrossCurrency: amount,
              vatType: vatType ? { id: vatType.id } : undefined,
              supplier: supplierForPosting,
            },
            // Motkonto (kredit - negativt beløp)
            {
              row: 1,  // Samme row = grupperes på samme linje i Tripletex UI
              date: date,
              account: { id: contraAccount.id },
              amountGross: -amount,
              amountGrossCurrency: -amount,
              supplier: supplierForPosting,
            },
          ];

          const voucherInput = {
            date,
            description,
            postings,
          };

          // sendToLedger: false sender til bilagsmottak først
          // sendToLedger: true krever "Advanced Voucher" permission
          const result = await client.createVoucher(voucherInput, false);

          const v = result.value;

          return {
            success: true,
            message: `Utgift bokført som bilag ${v.number}`,
            voucher: {
              id: v.id,
              number: v.number,
              date: v.date,
            },
            details: {
              account: `${account.number} - ${account.name}`,
              contraAccount: `${contraAccount.number} - ${contraAccount.name}`,
              netAmount: actualNetAmount,
              vatAmount: actualVatAmount,
              vatRate: actualVatRate,
              totalAmount: amount,
              supplier: supplierName,
              hasVatDeduction: actualVatAmount > 0,
              isPaid: isPaid !== false,
              matchedPostingId: matchedPostingId,
            },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Ukjent feil ved registrering av utgift";
          
          // Sjekk for vanlige Tripletex-feil
          if (errorMessage.includes("systemgenererte")) {
            return {
              success: false,
              error: errorMessage,
              hint: "Denne feilen kan skyldes begrensninger i Tripletex test-kontoen eller manglende tilgang til å opprette manuelle bilag. Prøv å bruke leverandørfaktura-arbeidsflyten i stedet, eller kontakt Tripletex support.",
              suggestion: "For å bokføre utgifter manuelt i Tripletex, må kontoen ha tilgang til å opprette manuelle bilag. Kontakt administrator for å aktivere dette.",
            };
          }
          
          return {
            success: false,
            error: errorMessage,
          };
        }
      },
    }),

    find_or_create_contact: tool({
      description: `Finn eller opprett en kunde/leverandør.
Søker først etter eksisterende kontakt, og oppretter ny hvis ikke funnet.`,
      parameters: z.object({
        name: z.string().describe("Navn på kontakten"),
        type: z.enum(["customer", "supplier"]).describe("Kontakttype"),
        organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
        email: z.string().optional().describe("E-postadresse"),
      }),
      execute: async ({ name, type, organizationNumber, email }) => {
        try {
          const contactMatcher = createContactMatcher(client);

          if (type === "customer") {
            const result = await contactMatcher.findOrCreateCustomer({
              name,
              organizationNumber,
              email,
            });

            return {
              success: true,
              contact: {
                id: result.id,
                name: result.name,
                type: "customer",
                customerNumber: result.customerNumber,
              },
            };
          } else {
            const result = await contactMatcher.findOrCreateSupplier({
              name,
              organizationNumber,
              email,
            });

            return {
              success: true,
              contact: {
                id: result.id,
                name: result.name,
                type: "supplier",
                supplierNumber: result.supplierNumber,
              },
            };
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved kontakthåndtering",
          };
        }
      },
    }),

    // ==================== FILE ATTACHMENTS ====================

    upload_attachment_to_voucher: tool({
      description: `Last opp kvittering/vedlegg til et bilag.
Kalles AUTOMATISK etter register_expense eller create_voucher.
Laster opp filen(e) som brukeren har vedlagt til bilaget.

VIKTIG: Kall dette verktøyet UMIDDELBART etter at et bilag er opprettet!`,
      parameters: z.object({
        voucherId: z.number().describe("Bilags-ID fra register_expense eller create_voucher"),
        fileIndex: z.number().optional().describe("Hvilken fil (1-basert). Hvis ikke oppgitt, lastes alle filer opp."),
      }),
      execute: async ({ voucherId, fileIndex }) => {
        try {
          if (!pendingFiles || pendingFiles.length === 0) {
            return {
              success: false,
              error: "Ingen filer vedlagt. Brukeren må sende fil sammen med meldingen.",
            };
          }

          const filesToUpload = fileIndex 
            ? [pendingFiles[fileIndex - 1]]
            : pendingFiles;

          if (fileIndex && !pendingFiles[fileIndex - 1]) {
            return {
              success: false,
              error: `Fil ${fileIndex} finnes ikke. Det er ${pendingFiles.length} fil(er) vedlagt.`,
            };
          }

          const uploadedFiles: string[] = [];
          const errors: string[] = [];

          for (const file of filesToUpload) {
            try {
              // Remove data URL prefix and convert to Buffer
              const base64Data = file.data.replace(/^data:[^;]+;base64,/, "");
              const buffer = Buffer.from(base64Data, "base64");
              
              await client.uploadVoucherAttachment(voucherId, buffer, file.name);
              uploadedFiles.push(file.name);
            } catch (error) {
              errors.push(`${file.name}: ${error instanceof Error ? error.message : "Ukjent feil"}`);
            }
          }

          if (uploadedFiles.length === 0) {
            return {
              success: false,
              error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
            };
          }

          return {
            success: true,
            message: `${uploadedFiles.length} fil(er) lastet opp til bilag ${voucherId}`,
            uploadedFiles,
            errors: errors.length > 0 ? errors : undefined,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Ukjent feil ved opplasting",
          };
        }
      },
    }),
  };
}

// Helper function to get Norwegian month name
function getMonthName(month: number): string {
  const months = [
    "januar", "februar", "mars", "april", "mai", "juni",
    "juli", "august", "september", "oktober", "november", "desember"
  ];
  return months[month - 1] || `måned ${month}`;
}
