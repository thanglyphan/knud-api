/**
 * Fiken Agent Delegation Module
 * 
 * Håndterer kommunikasjon mellom spesialiserte agenter.
 * Hver agent kan delegere oppgaver til andre agenter.
 */

import { z } from "zod";
import { tool } from "ai";

/**
 * Agent types available in the Fiken multi-agent system
 */
export type FikenAgentType = 
  | 'invoice_agent'
  | 'purchase_agent'
  | 'contact_agent'
  | 'offer_agent'
  | 'bank_agent'
  | 'accounting_agent';

/**
 * Agent descriptions for delegation
 */
export const AGENT_DESCRIPTIONS: Record<FikenAgentType, string> = {
  invoice_agent: "Fakturaer, kreditnotaer, salg, fakturautkast, sending",
  purchase_agent: "Kjøp, leverandørfakturaer, utgifter, kvitteringer, betalinger",
  contact_agent: "Kunder, leverandører, kontaktpersoner, produkter",
  offer_agent: "Tilbud, ordrebekreftelser, konvertering til faktura",
  bank_agent: "Bankkontoer, transaksjoner, saldoer, innboks, avstemming",
  accounting_agent: "Kontoplan, bilag, prosjekter, teller-initialisering",
};

/**
 * Delegation request from one agent to another
 */
export interface DelegationRequest {
  fromAgent: FikenAgentType | 'orchestrator';
  toAgent: FikenAgentType;
  task: string;
  context?: Record<string, unknown>;
  /** Full conversation history for context retention across delegations */
  conversationHistory?: Array<{ role: string; content: unknown }>;
}

/**
 * Delegation response from an agent
 */
export interface DelegationResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  fromAgent: FikenAgentType;
}

/**
 * Callback type for handling delegations
 * This will be set by the orchestrator to route requests to the correct agent
 */
export type DelegationHandler = (request: DelegationRequest) => Promise<DelegationResponse>;

/**
 * Creates delegation tools for an agent to call other agents
 * 
 * @param currentAgent - The agent creating these tools (used in fromAgent)
 * @param onDelegate - Callback to handle delegation (set by orchestrator)
 */
export function createDelegationTools(
  currentAgent: FikenAgentType | 'orchestrator',
  onDelegate: DelegationHandler
) {
  
  const delegateToInvoiceAgent = tool({
    description: `Deleger oppgave til invoice_agent. Bruk for: ${AGENT_DESCRIPTIONS.invoice_agent}`,
    parameters: z.object({
      task: z.string().describe("Beskrivelse av oppgaven som skal utføres"),
      context: z.record(z.unknown()).optional().describe("Ekstra kontekst (f.eks. kundeinfo, beløp, etc.)"),
    }),
    execute: async ({ task, context }) => {
      try {
        const response = await onDelegate({
          fromAgent: currentAgent,
          toAgent: 'invoice_agent',
          task,
          context,
        });
        return {
          success: response.success,
          result: response.result,
          error: response.error,
          delegatedTo: 'invoice_agent',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke delegere til invoice_agent",
          delegatedTo: 'invoice_agent',
        };
      }
    },
  });

  const delegateToPurchaseAgent = tool({
    description: `Deleger oppgave til purchase_agent. Bruk for: ${AGENT_DESCRIPTIONS.purchase_agent}`,
    parameters: z.object({
      task: z.string().describe("Beskrivelse av oppgaven som skal utføres"),
      context: z.record(z.unknown()).optional().describe("Ekstra kontekst (f.eks. leverandørinfo, beløp, etc.)"),
    }),
    execute: async ({ task, context }) => {
      try {
        const response = await onDelegate({
          fromAgent: currentAgent,
          toAgent: 'purchase_agent',
          task,
          context,
        });
        return {
          success: response.success,
          result: response.result,
          error: response.error,
          delegatedTo: 'purchase_agent',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke delegere til purchase_agent",
          delegatedTo: 'purchase_agent',
        };
      }
    },
  });

  const delegateToContactAgent = tool({
    description: `Deleger oppgave til contact_agent. Bruk for: ${AGENT_DESCRIPTIONS.contact_agent}`,
    parameters: z.object({
      task: z.string().describe("Beskrivelse av oppgaven som skal utføres"),
      context: z.record(z.unknown()).optional().describe("Ekstra kontekst (f.eks. navn, org.nr, etc.)"),
    }),
    execute: async ({ task, context }) => {
      try {
        const response = await onDelegate({
          fromAgent: currentAgent,
          toAgent: 'contact_agent',
          task,
          context,
        });
        return {
          success: response.success,
          result: response.result,
          error: response.error,
          delegatedTo: 'contact_agent',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke delegere til contact_agent",
          delegatedTo: 'contact_agent',
        };
      }
    },
  });

  const delegateToOfferAgent = tool({
    description: `Deleger oppgave til offer_agent. Bruk for: ${AGENT_DESCRIPTIONS.offer_agent}`,
    parameters: z.object({
      task: z.string().describe("Beskrivelse av oppgaven som skal utføres"),
      context: z.record(z.unknown()).optional().describe("Ekstra kontekst (f.eks. kundeinfo, linjer, etc.)"),
    }),
    execute: async ({ task, context }) => {
      try {
        const response = await onDelegate({
          fromAgent: currentAgent,
          toAgent: 'offer_agent',
          task,
          context,
        });
        return {
          success: response.success,
          result: response.result,
          error: response.error,
          delegatedTo: 'offer_agent',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke delegere til offer_agent",
          delegatedTo: 'offer_agent',
        };
      }
    },
  });

  const delegateToBankAgent = tool({
    description: `Deleger oppgave til bank_agent. Bruk for: ${AGENT_DESCRIPTIONS.bank_agent}`,
    parameters: z.object({
      task: z.string().describe("Beskrivelse av oppgaven som skal utføres"),
      context: z.record(z.unknown()).optional().describe("Ekstra kontekst (f.eks. kontonr, dato, etc.)"),
    }),
    execute: async ({ task, context }) => {
      try {
        const response = await onDelegate({
          fromAgent: currentAgent,
          toAgent: 'bank_agent',
          task,
          context,
        });
        return {
          success: response.success,
          result: response.result,
          error: response.error,
          delegatedTo: 'bank_agent',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke delegere til bank_agent",
          delegatedTo: 'bank_agent',
        };
      }
    },
  });

  const delegateToAccountingAgent = tool({
    description: `Deleger oppgave til accounting_agent. Bruk for: ${AGENT_DESCRIPTIONS.accounting_agent}`,
    parameters: z.object({
      task: z.string().describe("Beskrivelse av oppgaven som skal utføres"),
      context: z.record(z.unknown()).optional().describe("Ekstra kontekst (f.eks. prosjektnavn, kontonr, etc.)"),
    }),
    execute: async ({ task, context }) => {
      try {
        const response = await onDelegate({
          fromAgent: currentAgent,
          toAgent: 'accounting_agent',
          task,
          context,
        });
        return {
          success: response.success,
          result: response.result,
          error: response.error,
          delegatedTo: 'accounting_agent',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke delegere til accounting_agent",
          delegatedTo: 'accounting_agent',
        };
      }
    },
  });

  return {
    delegateToInvoiceAgent,
    delegateToPurchaseAgent,
    delegateToContactAgent,
    delegateToOfferAgent,
    delegateToBankAgent,
    delegateToAccountingAgent,
  };
}

/**
 * Creates delegation tools excluding tools that would delegate to the current agent
 * (to prevent self-delegation)
 */
export function createDelegationToolsForAgent(
  currentAgent: FikenAgentType,
  onDelegate: DelegationHandler
) {
  const allTools = createDelegationTools(currentAgent, onDelegate);
  
  // Remove the tool that would delegate to self
  const toolsWithoutSelf: Partial<ReturnType<typeof createDelegationTools>> = { ...allTools };
  
  switch (currentAgent) {
    case 'invoice_agent':
      delete toolsWithoutSelf.delegateToInvoiceAgent;
      break;
    case 'purchase_agent':
      delete toolsWithoutSelf.delegateToPurchaseAgent;
      break;
    case 'contact_agent':
      delete toolsWithoutSelf.delegateToContactAgent;
      break;
    case 'offer_agent':
      delete toolsWithoutSelf.delegateToOfferAgent;
      break;
    case 'bank_agent':
      delete toolsWithoutSelf.delegateToBankAgent;
      break;
    case 'accounting_agent':
      delete toolsWithoutSelf.delegateToAccountingAgent;
      break;
  }
  
  return toolsWithoutSelf as Omit<ReturnType<typeof createDelegationTools>, 
    'delegateToInvoiceAgent' | 'delegateToPurchaseAgent' | 'delegateToContactAgent' | 
    'delegateToOfferAgent' | 'delegateToBankAgent' | 'delegateToAccountingAgent'
  > & Record<string, unknown>;
}

export type DelegationTools = ReturnType<typeof createDelegationTools>;
