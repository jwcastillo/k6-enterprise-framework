/**
 * Default per-agent configuration. Kept out of src/types/ai.d.ts because a
 * declaration file is never emitted, so a runtime import from it fails.
 */

import type { AgentConfig } from "../../types/ai.d";

/** Configuracion por defecto recomendada por agente */
export const DEFAULT_AGENT_CONFIGS: Record<string, Omit<AgentConfig, "agentId">> = {
  planner: {
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxOutputTokens: 4096,
    maxInputTokens: 16000,
    maxSelfHealingCycles: 2,
    timeoutSeconds: 60,
    tokenBudgetPerInvocation: 20000,
  },
  builder: {
    model: "claude-sonnet-4-6",
    temperature: 0.1,
    maxOutputTokens: 8192,
    maxInputTokens: 32000,
    maxSelfHealingCycles: 3,
    timeoutSeconds: 120,
    tokenBudgetPerInvocation: 50000,
  },
  analyst: {
    model: "claude-sonnet-4-6",
    temperature: 0.2,
    maxOutputTokens: 4096,
    maxInputTokens: 16000,
    maxSelfHealingCycles: 2,
    timeoutSeconds: 120,
    tokenBudgetPerInvocation: 20000,
  },
  reporter: {
    model: "claude-sonnet-4-6",
    temperature: 0.4,
    maxOutputTokens: 4096,
    maxInputTokens: 16000,
    maxSelfHealingCycles: 1,
    timeoutSeconds: 60,
    tokenBudgetPerInvocation: 20000,
  },
};
