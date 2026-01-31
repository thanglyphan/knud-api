/**
 * Tripletex Capabilities
 *
 * Capability-basert arkitektur: Færre, mer kraftfulle tools.
 * I stedet for mange separate tools har vi 4 capability tools:
 * - customers: Alt kunde-relatert
 * - invoices: Alt faktura-relatert (inkl. skjult ordre-håndtering)
 * - employees: Alt ansatt-relatert
 * - salary: Alt lønns-relatert (lønnstransaksjoner, lønnslipper, arbeidsforhold)
 */

import { TripletexClient } from "../client.js";
import { createCustomersCapability } from "./customers.js";
import { createInvoicesCapability } from "./invoices.js";
import { createEmployeesCapability } from "./employees.js";
import { createSalaryCapability } from "./salary.js";

export function createTripletexCapabilities(client: TripletexClient) {
  return {
    customers: createCustomersCapability(client),
    invoices: createInvoicesCapability(client),
    employees: createEmployeesCapability(client),
    salary: createSalaryCapability(client),
  };
}

export type TripletexCapabilities = ReturnType<typeof createTripletexCapabilities>;
