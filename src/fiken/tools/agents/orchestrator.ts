/**
 * Fiken Orchestrator
 * 
 * Hovedagent som koordinerer mellom spesialiserte agenter.
 * Analyserer brukerens forespørsel og delegerer til riktig agent.
 */

import type { FikenClient } from "../../client.js";
import { 
  ORCHESTRATOR_PROMPT,
  createDelegationTools,
  type DelegationHandler,
  type DelegationRequest,
  type DelegationResponse,
  type FikenAgentType,
  type PendingFile,
} from "../shared/index.js";
import { createInvoiceAgentTools, INVOICE_AGENT_PROMPT } from "./invoiceAgent.js";
import { createPurchaseAgentTools, PURCHASE_AGENT_PROMPT } from "./purchaseAgent.js";
import { createContactAgentTools, CONTACT_AGENT_PROMPT } from "./contactAgent.js";
import { createOfferAgentTools, OFFER_AGENT_PROMPT } from "./offerAgent.js";
import { createBankAgentTools, BANK_AGENT_PROMPT } from "./bankAgent.js";
import { createAccountingAgentTools, ACCOUNTING_AGENT_PROMPT } from "./accountingAgent.js";

/**
 * Configuration for the orchestrator
 */
export interface OrchestratorConfig {
  client: FikenClient;
  companySlug: string;
  pendingFiles?: PendingFile[];
}

/**
 * Agent tools and prompt
 */
export interface AgentConfig {
  tools: Record<string, unknown>;
  prompt: string;
}

/**
 * Creates all agent configurations for the orchestrator
 */
export function createAgentConfigs(config: OrchestratorConfig): Record<FikenAgentType, AgentConfig> {
  const { client, companySlug, pendingFiles } = config;
  
  return {
    invoice_agent: {
      tools: createInvoiceAgentTools(client, companySlug, pendingFiles),
      prompt: INVOICE_AGENT_PROMPT,
    },
    purchase_agent: {
      tools: createPurchaseAgentTools(client, companySlug, pendingFiles),
      prompt: PURCHASE_AGENT_PROMPT,
    },
    contact_agent: {
      tools: createContactAgentTools(client, companySlug, pendingFiles),
      prompt: CONTACT_AGENT_PROMPT,
    },
    offer_agent: {
      tools: createOfferAgentTools(client, companySlug, pendingFiles),
      prompt: OFFER_AGENT_PROMPT,
    },
    bank_agent: {
      tools: createBankAgentTools(client, companySlug, pendingFiles),
      prompt: BANK_AGENT_PROMPT,
    },
    accounting_agent: {
      tools: createAccountingAgentTools(client, companySlug, pendingFiles),
      prompt: ACCOUNTING_AGENT_PROMPT,
    },
  };
}

/**
 * Creates the orchestrator with delegation tools
 * 
 * The orchestrator doesn't have direct Fiken tools - it only has delegation tools
 * to route requests to specialized agents.
 */
export function createOrchestratorTools(
  config: OrchestratorConfig,
  onAgentExecute: (agent: FikenAgentType, request: DelegationRequest) => Promise<DelegationResponse>
) {
  // Create delegation tools for the orchestrator
  const delegationHandler: DelegationHandler = async (request) => {
    return onAgentExecute(request.toAgent, request);
  };
  
  const delegationTools = createDelegationTools('orchestrator', delegationHandler);
  
  return {
    ...delegationTools,
  };
}

/**
 * Gets all tools for a specific agent (used when the orchestrator delegates)
 */
export function getAgentTools(
  agentType: FikenAgentType,
  config: OrchestratorConfig,
): Record<string, unknown> {
  const { client, companySlug, pendingFiles } = config;
  
  switch (agentType) {
    case 'invoice_agent':
      return createInvoiceAgentTools(client, companySlug, pendingFiles);
    case 'purchase_agent':
      return createPurchaseAgentTools(client, companySlug, pendingFiles);
    case 'contact_agent':
      return createContactAgentTools(client, companySlug, pendingFiles);
    case 'offer_agent':
      return createOfferAgentTools(client, companySlug, pendingFiles);
    case 'bank_agent':
      return createBankAgentTools(client, companySlug, pendingFiles);
    case 'accounting_agent':
      return createAccountingAgentTools(client, companySlug, pendingFiles);
  }
}

/**
 * Gets the prompt for a specific agent
 */
export function getAgentPrompt(agentType: FikenAgentType): string {
  switch (agentType) {
    case 'invoice_agent':
      return INVOICE_AGENT_PROMPT;
    case 'purchase_agent':
      return PURCHASE_AGENT_PROMPT;
    case 'contact_agent':
      return CONTACT_AGENT_PROMPT;
    case 'offer_agent':
      return OFFER_AGENT_PROMPT;
    case 'bank_agent':
      return BANK_AGENT_PROMPT;
    case 'accounting_agent':
      return ACCOUNTING_AGENT_PROMPT;
  }
}

/**
 * Creates a complete multi-agent system
 * 
 * Returns tools and prompts for both orchestrator and all specialized agents.
 * The consumer is responsible for implementing the actual agent execution logic.
 */
export function createFikenAgentSystem(config: OrchestratorConfig) {
  const { client, companySlug, pendingFiles } = config;
  
  // Delegation handler will be set by the consumer
  let delegationHandler: DelegationHandler = async () => ({
    success: false,
    error: "Delegation handler not configured",
    fromAgent: 'invoice_agent' as FikenAgentType,
  });
  
  // Create orchestrator tools
  const orchestratorTools = createDelegationTools('orchestrator', (request) => delegationHandler(request));
  
  return {
    // Orchestrator configuration
    orchestrator: {
      tools: orchestratorTools,
      prompt: ORCHESTRATOR_PROMPT,
    },
    
    // Agent configurations (no delegation tools — only domain tools)
    agents: {
      invoice_agent: {
        tools: createInvoiceAgentTools(client, companySlug, pendingFiles),
        prompt: INVOICE_AGENT_PROMPT,
      },
      purchase_agent: {
        tools: createPurchaseAgentTools(client, companySlug, pendingFiles),
        prompt: PURCHASE_AGENT_PROMPT,
      },
      contact_agent: {
        tools: createContactAgentTools(client, companySlug, pendingFiles),
        prompt: CONTACT_AGENT_PROMPT,
      },
      offer_agent: {
        tools: createOfferAgentTools(client, companySlug, pendingFiles),
        prompt: OFFER_AGENT_PROMPT,
      },
      bank_agent: {
        tools: createBankAgentTools(client, companySlug, pendingFiles),
        prompt: BANK_AGENT_PROMPT,
      },
      accounting_agent: {
        tools: createAccountingAgentTools(client, companySlug, pendingFiles),
        prompt: ACCOUNTING_AGENT_PROMPT,
      },
    },
    
    // Set the delegation handler (called by consumer to wire up agent execution)
    setDelegationHandler: (handler: DelegationHandler) => {
      delegationHandler = handler;
    },
    
    // Helper to get tools for a specific agent
    getAgentTools: (agentType: FikenAgentType) => getAgentTools(agentType, config),
    
    // Helper to get prompt for a specific agent
    getAgentPrompt,
  };
}

// Re-export types and prompts
export { ORCHESTRATOR_PROMPT };
export type { FikenAgentType, DelegationHandler, DelegationRequest, DelegationResponse };
