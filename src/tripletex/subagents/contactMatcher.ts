/**
 * Contact Matcher - Finn eller opprett kunder/leverandører i Tripletex
 * 
 * Søker etter eksisterende kontakter basert på navn, org.nr, eller andre kriterier.
 * Oppretter nye kontakter hvis ingen match finnes.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { type TripletexClient } from "../client.js";
import { type Customer, type Supplier } from "../types.js";

// Schema for AI-basert kontaktmatching
const ContactMatchSchema = z.object({
  isMatch: z.boolean().describe("Er dette en match på eksisterende kontakt?"),
  confidence: z.enum(["high", "medium", "low"]).describe("Hvor sikker er vi på matchen?"),
  reason: z.string().describe("Kort forklaring på hvorfor dette er/ikke er en match"),
});

// Schema for kontaktforslag
const ContactSuggestionSchema = z.object({
  contactType: z.enum(["customer", "supplier"]).describe("Foreslått kontakttype basert på beskrivelse"),
  name: z.string().describe("Foreslått navn på kontakten"),
  isCompany: z.boolean().describe("Er dette et firma eller privatperson?"),
  reason: z.string().describe("Kort forklaring på valget"),
});

export interface MatchResult<T> {
  found: boolean;
  contact?: T;
  confidence?: "high" | "medium" | "low";
  possibleMatches?: T[];
}

export interface ContactInfo {
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  address?: {
    addressLine1?: string;
    postalCode?: string;
    city?: string;
  };
}

export function createContactMatcher(client: TripletexClient) {
  
  /**
   * Søk etter kunde basert på navn eller org.nr
   */
  async function findCustomer(searchTerm: string): Promise<MatchResult<Customer>> {
    // Prøv først med organisasjonsnummer hvis det ser ut som et
    const orgNrMatch = searchTerm.match(/^\d{9}$/);
    if (orgNrMatch) {
      const response = await client.getCustomers({
        organizationNumber: searchTerm,
        count: 10,
      });
      
      if (response.values.length === 1) {
        return {
          found: true,
          contact: response.values[0],
          confidence: "high",
        };
      }
    }
    
    // Søk på navn
    const customers = await client.searchCustomerByName(searchTerm);
    
    if (customers.length === 0) {
      return { found: false };
    }
    
    if (customers.length === 1) {
      return {
        found: true,
        contact: customers[0],
        confidence: "high",
      };
    }
    
    // Flere mulige matcher - bruk AI for å velge beste
    const bestMatch = await findBestMatch(searchTerm, customers, "customer");
    
    if (bestMatch) {
      return {
        found: true,
        contact: bestMatch.contact,
        confidence: bestMatch.confidence,
        possibleMatches: customers,
      };
    }
    
    return {
      found: false,
      possibleMatches: customers,
    };
  }
  
  /**
   * Søk etter leverandør basert på navn eller org.nr
   */
  async function findSupplier(searchTerm: string): Promise<MatchResult<Supplier>> {
    // Prøv først med organisasjonsnummer hvis det ser ut som et
    const orgNrMatch = searchTerm.match(/^\d{9}$/);
    if (orgNrMatch) {
      const response = await client.getSuppliers({
        organizationNumber: searchTerm,
        count: 10,
      });
      
      if (response.values.length === 1) {
        return {
          found: true,
          contact: response.values[0],
          confidence: "high",
        };
      }
    }
    
    // Søk på navn
    const suppliers = await client.searchSupplierByName(searchTerm);
    
    if (suppliers.length === 0) {
      return { found: false };
    }
    
    if (suppliers.length === 1) {
      return {
        found: true,
        contact: suppliers[0],
        confidence: "high",
      };
    }
    
    // Flere mulige matcher - bruk AI for å velge beste
    const bestMatch = await findBestMatch(searchTerm, suppliers, "supplier");
    
    if (bestMatch) {
      return {
        found: true,
        contact: bestMatch.contact,
        confidence: bestMatch.confidence,
        possibleMatches: suppliers,
      };
    }
    
    return {
      found: false,
      possibleMatches: suppliers,
    };
  }
  
  /**
   * Bruk AI for å finne beste match blant flere kandidater
   */
  async function findBestMatch<T extends Customer | Supplier>(
    searchTerm: string,
    candidates: T[],
    type: "customer" | "supplier"
  ): Promise<{ contact: T; confidence: "high" | "medium" | "low" } | null> {
    if (candidates.length === 0) return null;
    
    const candidateList = candidates
      .map((c, i) => {
        const orgNr = 'organizationNumber' in c ? c.organizationNumber : '';
        return `${i + 1}. ${c.name} ${orgNr ? `(Org.nr: ${orgNr})` : ''}`;
      })
      .join("\n");
    
    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: z.object({
        bestMatchIndex: z.number().min(0).max(candidates.length).describe("Index (1-basert) av beste match, eller 0 hvis ingen god match"),
        confidence: z.enum(["high", "medium", "low"]),
        reason: z.string(),
      }),
      prompt: `Du skal finne beste match for en ${type === "customer" ? "kunde" : "leverandør"}.

SØKETERM: "${searchTerm}"

KANDIDATER:
${candidateList}

Vurder:
1. Eksakt navnematch = high confidence
2. Delvis navnematch (forkortelser, skrivefeil) = medium confidence
3. Bare lignende navn = low confidence
4. Ingen god match = bestMatchIndex: 0

Returner index (1-basert) for beste match, eller 0 hvis ingen god match finnes.`,
    });
    
    if (object.bestMatchIndex === 0 || object.bestMatchIndex > candidates.length) {
      return null;
    }
    
    return {
      contact: candidates[object.bestMatchIndex - 1],
      confidence: object.confidence,
    };
  }
  
  /**
   * Finn eller opprett kunde
   */
  async function findOrCreateCustomer(info: ContactInfo): Promise<Customer> {
    // Først, søk etter eksisterende
    const searchResult = await findCustomer(info.organizationNumber || info.name);
    
    if (searchResult.found && searchResult.contact && searchResult.confidence === "high") {
      return searchResult.contact;
    }
    
    // Opprett ny kunde
    const response = await client.createCustomer({
      name: info.name,
      organizationNumber: info.organizationNumber,
      email: info.email,
      phoneNumber: info.phoneNumber,
      physicalAddress: info.address ? {
        addressLine1: info.address.addressLine1,
        postalCode: info.address.postalCode,
        city: info.address.city,
      } : undefined,
    });
    
    return response.value;
  }
  
  /**
   * Finn eller opprett leverandør
   */
  async function findOrCreateSupplier(info: ContactInfo): Promise<Supplier> {
    // Først, søk etter eksisterende
    const searchResult = await findSupplier(info.organizationNumber || info.name);
    
    if (searchResult.found && searchResult.contact && searchResult.confidence === "high") {
      return searchResult.contact;
    }
    
    // Opprett ny leverandør
    const response = await client.createSupplier({
      name: info.name,
      organizationNumber: info.organizationNumber,
      email: info.email,
      phoneNumber: info.phoneNumber,
      physicalAddress: info.address ? {
        addressLine1: info.address.addressLine1,
        postalCode: info.address.postalCode,
        city: info.address.city,
      } : undefined,
    });
    
    return response.value;
  }
  
  /**
   * Bruk AI til å foreslå kontakttype basert på beskrivelse
   */
  async function suggestContactType(description: string): Promise<{
    contactType: "customer" | "supplier";
    name: string;
    isCompany: boolean;
    reason: string;
  }> {
    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: ContactSuggestionSchema,
      prompt: `Basert på denne beskrivelsen, bestem om dette er en kunde eller leverandør, og foreslå navn.

BESKRIVELSE: "${description}"

REGLER:
- "customer" = noen du selger til, mottar betaling fra
- "supplier" = noen du kjøper fra, betaler til
- Eksempler på leverandører: butikker, hoteller, flyselskap, programvare-selskaper, leverandører
- Eksempler på kunder: klienter, oppdragsgivere, de som betaler deg

Hvis beskrivelsen nevner et firmanavn, bruk det som name.
Hvis ikke, lag et beskrivende navn.`,
    });
    
    return object;
  }
  
  /**
   * Hent eller opprett kontakt basert på beskrivelse (smart matching)
   */
  async function getOrCreateContact(
    description: string,
    preferredType?: "customer" | "supplier"
  ): Promise<{ contact: Customer | Supplier; type: "customer" | "supplier"; created: boolean }> {
    // Bruk AI for å foreslå type hvis ikke spesifisert
    const suggestion = await suggestContactType(description);
    const contactType = preferredType || suggestion.contactType;
    
    if (contactType === "customer") {
      const existing = await findCustomer(suggestion.name);
      if (existing.found && existing.contact) {
        return { contact: existing.contact, type: "customer", created: false };
      }
      
      const newCustomer = await findOrCreateCustomer({ name: suggestion.name });
      return { contact: newCustomer, type: "customer", created: true };
    } else {
      const existing = await findSupplier(suggestion.name);
      if (existing.found && existing.contact) {
        return { contact: existing.contact, type: "supplier", created: false };
      }
      
      const newSupplier = await findOrCreateSupplier({ name: suggestion.name });
      return { contact: newSupplier, type: "supplier", created: true };
    }
  }
  
  return {
    findCustomer,
    findSupplier,
    findOrCreateCustomer,
    findOrCreateSupplier,
    suggestContactType,
    getOrCreateContact,
  };
}

export type ContactMatcher = ReturnType<typeof createContactMatcher>;
