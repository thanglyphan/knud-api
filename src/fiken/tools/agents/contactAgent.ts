/**
 * Fiken Contact Agent
 * 
 * Spesialisert agent for kontakt- og produktrelaterte operasjoner:
 * - Kunder
 * - Leverandører
 * - Kontaktpersoner
 * - Produkter/tjenester
 */

import { z } from "zod";
import { tool } from "ai";
import type { FikenClient } from "../../client.js";
import { 
  CONTACT_AGENT_PROMPT,
  createAttachmentTools,
  createDelegationToolsForAgent,
  type PendingFile,
  type DelegationHandler,
} from "../shared/index.js";

/**
 * Creates the contact agent tools
 */
export function createContactAgentTools(
  client: FikenClient, 
  companySlug: string,
  pendingFiles?: PendingFile[],
  onDelegate?: DelegationHandler
) {
  
  // ============================================
  // CONTACT SEARCH & GET
  // ============================================

  const searchContacts = tool({
    description: "Søk etter kontakter (kunder/leverandører) i Fiken. Bruk dette for å finne kunder før du oppretter fakturaer.",
    parameters: z.object({
      name: z.string().optional().describe("Navn på kontakten (delvis match)"),
      email: z.string().optional().describe("E-postadresse"),
      organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
      customer: z.boolean().optional().describe("Filtrer kun kunder"),
      supplier: z.boolean().optional().describe("Filtrer kun leverandører"),
      inactive: z.boolean().optional().default(false).describe("Inkluder inaktive kontakter"),
    }),
    execute: async ({ name, email, organizationNumber, customer, supplier, inactive }) => {
      try {
        const contacts = await client.getContacts({
          name,
          email,
          organizationNumber,
          customer,
          supplier,
          inactive,
          pageSize: 25,
        });
        return {
          success: true,
          count: contacts.length,
          contacts: contacts.map((c) => ({
            id: c.contactId,
            name: c.name,
            email: c.email,
            organizationNumber: c.organizationNumber,
            phoneNumber: c.phoneNumber,
            customerNumber: c.customerNumber,
            supplierNumber: c.supplierNumber,
            isCustomer: c.customer,
            isSupplier: c.supplier,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter kontakter",
        };
      }
    },
  });

  const getContact = tool({
    description: "Hent detaljert informasjon om en spesifikk kontakt.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID i Fiken"),
    }),
    execute: async ({ contactId }) => {
      try {
        const contact = await client.getContact(contactId);
        return { success: true, contact };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kontakt",
        };
      }
    },
  });

  // ============================================
  // CONTACT CRUD
  // ============================================

  const createContact = tool({
    description: "Opprett en ny kontakt (kunde eller leverandør) i Fiken.",
    parameters: z.object({
      name: z.string().describe("Navn på kontakten (påkrevd)"),
      email: z.string().optional().describe("E-postadresse (viktig for fakturasending)"),
      organizationNumber: z.string().optional().describe("Organisasjonsnummer"),
      phoneNumber: z.string().optional().describe("Telefonnummer"),
      customer: z.boolean().optional().default(true).describe("Er dette en kunde?"),
      supplier: z.boolean().optional().default(false).describe("Er dette en leverandør?"),
    }),
    execute: async ({ name, email, organizationNumber, phoneNumber, customer, supplier }) => {
      try {
        const contact = await client.createContact({
          name,
          email,
          organizationNumber,
          phoneNumber,
          customer,
          supplier,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Kontakt opprettet: ${name} (ID: ${contact.contactId})`,
          contact: {
            contactId: contact.contactId,
            name: contact.name,
            email: contact.email,
            customerNumber: contact.customerNumber,
            supplierNumber: contact.supplierNumber,
            isCustomer: contact.customer,
            isSupplier: contact.supplier,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette kontakt",
        };
      }
    },
  });

  const updateContact = tool({
    description: "Oppdater en eksisterende kontakt i Fiken.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID"),
      name: z.string().describe("Navn på kontakten"),
      email: z.string().optional().describe("E-postadresse"),
      phoneNumber: z.string().optional().describe("Telefonnummer"),
      inactive: z.boolean().optional().describe("Sett kontakten som inaktiv"),
    }),
    execute: async ({ contactId, name, email, phoneNumber, inactive }) => {
      try {
        const contact = await client.updateContact(contactId, {
          name,
          email,
          phoneNumber,
          inactive,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Kontakt oppdatert: ${name}`,
          contact,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke oppdatere kontakt",
        };
      }
    },
  });

  const deleteContact = tool({
    description: "Slett en kontakt fra Fiken. Kan kun slettes hvis kontakten ikke er brukt i transaksjoner.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID som skal slettes"),
    }),
    execute: async ({ contactId }) => {
      try {
        await client.deleteContact(contactId);
        return { success: true, message: "Kontakt ble slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette kontakt",
        };
      }
    },
  });

  // ============================================
  // CONTACT PERSONS
  // ============================================

  const getContactPersons = tool({
    description: "Hent kontaktpersoner for en kontakt (firma).",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID"),
    }),
    execute: async ({ contactId }) => {
      try {
        const persons = await client.getContactPersons(contactId);
        return { success: true, count: persons.length, contactPersons: persons };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente kontaktpersoner",
        };
      }
    },
  });

  const addContactPerson = tool({
    description: "Legg til en kontaktperson på en kontakt (firma). Både navn og e-post er påkrevd.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID"),
      name: z.string().describe("Navn på kontaktpersonen"),
      email: z.string().describe("E-postadresse (påkrevd)"),
      phoneNumber: z.string().optional().describe("Telefonnummer"),
    }),
    execute: async ({ contactId, name, email, phoneNumber }) => {
      try {
        const person = await client.addContactPerson(contactId, { name, email, phoneNumber });
        return {
          success: true,
          _operationComplete: true,
          message: `Kontaktperson lagt til: ${name}`,
          contactPerson: person,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke legge til kontaktperson",
        };
      }
    },
  });

  // ============================================
  // PRODUCT TOOLS
  // ============================================

  const searchProducts = tool({
    description: "Søk etter produkter i Fiken.",
    parameters: z.object({
      name: z.string().optional().describe("Produktnavn (delvis match)"),
      productNumber: z.string().optional().describe("Produktnummer"),
      active: z.boolean().optional().default(true).describe("Kun aktive produkter"),
    }),
    execute: async ({ name, productNumber, active }) => {
      try {
        const products = await client.getProducts({ name, productNumber, active, pageSize: 25 });
        return {
          success: true,
          count: products.length,
          products: products.map((p) => ({
            id: p.productId,
            name: p.name,
            productNumber: p.productNumber,
            unitPrice: p.unitPrice,
            vatType: p.vatType,
            incomeAccount: p.incomeAccount,
            active: p.active,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke søke etter produkter",
        };
      }
    },
  });

  const getProduct = tool({
    description: "Hent detaljert informasjon om et spesifikt produkt.",
    parameters: z.object({
      productId: z.number().describe("Produkt-ID i Fiken"),
    }),
    execute: async ({ productId }) => {
      try {
        const product = await client.getProduct(productId);
        return { success: true, product };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke hente produkt",
        };
      }
    },
  });

  const createProduct = tool({
    description: "Opprett et nytt produkt i Fiken. Produkter brukes i fakturalinjer.",
    parameters: z.object({
      name: z.string().describe("Produktnavn (påkrevd)"),
      unitPrice: z.number().optional().describe("Enhetspris i øre (100 = 1 kr)"),
      productNumber: z.string().optional().describe("Produktnummer"),
      vatType: z.string().default("HIGH").describe("MVA-type: HIGH (25%), MEDIUM (15%), LOW (12%), NONE, EXEMPT, OUTSIDE"),
      incomeAccount: z.string().default("3000").describe("Inntektskonto (standard: 3000)"),
    }),
    execute: async ({ name, unitPrice, productNumber, vatType, incomeAccount }) => {
      try {
        const product = await client.createProduct({
          name,
          unitPrice,
          productNumber,
          vatType,
          incomeAccount,
          active: true,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Produkt opprettet: ${name} (ID: ${product.productId})`,
          product: {
            productId: product.productId,
            name: product.name,
            productNumber: product.productNumber,
            unitPrice: product.unitPrice,
            vatType: product.vatType,
            incomeAccount: product.incomeAccount,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke opprette produkt",
        };
      }
    },
  });

  const updateProduct = tool({
    description: "Oppdater et eksisterende produkt i Fiken.",
    parameters: z.object({
      productId: z.number().describe("Produkt-ID"),
      name: z.string().describe("Produktnavn (påkrevd)"),
      unitPrice: z.number().optional().describe("Enhetspris i øre"),
      vatType: z.string().describe("MVA-type: HIGH, MEDIUM, LOW, NONE, EXEMPT, OUTSIDE"),
      incomeAccount: z.string().describe("Inntektskonto"),
      active: z.boolean().optional().describe("Er produktet aktivt?"),
    }),
    execute: async ({ productId, name, unitPrice, vatType, incomeAccount, active }) => {
      try {
        const product = await client.updateProduct(productId, {
          name,
          unitPrice,
          vatType,
          incomeAccount,
          active: active ?? true,
        });
        return {
          success: true,
          _operationComplete: true,
          message: `Produkt oppdatert: ${name}`,
          product,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke oppdatere produkt",
        };
      }
    },
  });

  const deleteProduct = tool({
    description: "Slett et produkt fra Fiken.",
    parameters: z.object({
      productId: z.number().describe("Produkt-ID som skal slettes"),
    }),
    execute: async ({ productId }) => {
      try {
        await client.deleteProduct(productId);
        return { success: true, message: "Produkt ble slettet" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke slette produkt",
        };
      }
    },
  });

  // ============================================
  // ATTACHMENT TOOLS
  // ============================================
  
  const attachmentTools = createAttachmentTools(client, pendingFiles);

  // ============================================
  // DELEGATION TOOLS
  // ============================================
  
  const delegationTools = onDelegate 
    ? createDelegationToolsForAgent('contact_agent', onDelegate)
    : {};

  // ============================================
  // RETURN ALL TOOLS
  // ============================================

  return {
    // Contact tools
    searchContacts,
    getContact,
    createContact,
    updateContact,
    deleteContact,
    
    // Contact persons
    getContactPersons,
    addContactPerson,
    
    // Product tools
    searchProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    
    // Attachments
    uploadAttachmentToContact: attachmentTools.uploadAttachmentToContact,
    
    // Delegation
    ...delegationTools,
  };
}

// Export the agent prompt
export { CONTACT_AGENT_PROMPT };

// Type for the contact agent tools
export type ContactAgentTools = ReturnType<typeof createContactAgentTools>;
