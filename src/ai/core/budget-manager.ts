/**
 * T-114: Control de presupuesto de tokens y rate limiting para agentes de IA
 *
 * Previene costos descontrolados de LLM con:
 *   - Limites de tokens por agente y por pipeline completo
 *   - Rate limiting para respetar limites de la API de Claude
 *   - Tracking de consumo acumulado con historial
 *   - Circuit breaker despues de N fallos consecutivos
 *
 * FR-169
 */

import type { TokenUsage } from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface AgentBudgetConfig {
  /** Max tokens de input por invocacion */
  maxInputTokensPerCall: number;
  /** Max tokens de output por invocacion */
  maxOutputTokensPerCall: number;
  /** Max tokens totales por sesion (acumulado) */
  maxTotalTokensSession: number;
  /** Max costo USD por sesion */
  maxCostUsdSession: number;
}

export interface PipelineBudgetConfig {
  /** Max tokens totales para todo el pipeline */
  maxTotalTokensPipeline: number;
  /** Max costo USD para todo el pipeline */
  maxCostUsdPipeline: number;
  /** Max requests por minuto a la API de Claude */
  maxRequestsPerMinute: number;
  /** Max tokens por minuto (rate limit de la API) */
  maxTokensPerMinute: number;
  /** N fallos consecutivos para activar circuit breaker */
  circuitBreakerThreshold: number;
}

export interface UsageRecord {
  agentId: string;
  timestamp: string;
  tokensUsed: TokenUsage;
  invocationId: string;
}

export interface BudgetStatus {
  agentId: string;
  sessionTokensUsed: number;
  sessionCostUsd: number;
  sessionTokensBudget: number;
  sessionCostBudget: number;
  utilizationPct: number;
  withinBudget: boolean;
  consecutiveFailures: number;
  circuitOpen: boolean;
}

export interface BudgetManagerOptions {
  agentId?: string;
  agentConfig?: Partial<AgentBudgetConfig>;
  pipelineConfig?: Partial<PipelineBudgetConfig>;
}

// ---------------------------------------------------------------------------
// Limites por defecto
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_BUDGETS: Record<string, AgentBudgetConfig> = {
  planner: {
    maxInputTokensPerCall: 16000,
    maxOutputTokensPerCall: 4096,
    maxTotalTokensSession: 50000,
    maxCostUsdSession: 0.5,
  },
  builder: {
    maxInputTokensPerCall: 32000,
    maxOutputTokensPerCall: 8192,
    maxTotalTokensSession: 100000,
    maxCostUsdSession: 1.5,
  },
  analyst: {
    maxInputTokensPerCall: 16000,
    maxOutputTokensPerCall: 4096,
    maxTotalTokensSession: 50000,
    maxCostUsdSession: 0.5,
  },
  reporter: {
    maxInputTokensPerCall: 16000,
    maxOutputTokensPerCall: 4096,
    maxTotalTokensSession: 40000,
    maxCostUsdSession: 0.4,
  },
};

const DEFAULT_PIPELINE_BUDGET: PipelineBudgetConfig = {
  maxTotalTokensPipeline: 250000,
  maxCostUsdPipeline: 3.0,
  maxRequestsPerMinute: 50, // Claude API limit (tier 1)
  maxTokensPerMinute: 40000, // Claude API limit (tier 1)
  circuitBreakerThreshold: 3,
};

// ---------------------------------------------------------------------------
// BudgetManager
// ---------------------------------------------------------------------------

export class BudgetManager {
  private readonly agentId: string;
  private readonly agentBudget: AgentBudgetConfig;
  private readonly pipelineBudget: PipelineBudgetConfig;

  // Tracking de uso
  private readonly usageHistory: UsageRecord[] = [];
  private sessionTokensUsed = 0;
  private sessionCostUsd = 0;

  // Pipeline-level tracking (shared state via singleton pattern)
  private static pipelineTokensUsed = 0;
  private static pipelineCostUsd = 0;
  private static requestTimestamps: number[] = [];
  private static tokenTimestamps: Array<{ ts: number; tokens: number }> = [];

  // Circuit breaker
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private static globalConsecutiveFailures = 0;
  private static globalCircuitOpen = false;

  constructor(options: BudgetManagerOptions = {}) {
    this.agentId = options.agentId ?? "unknown";
    const agentDefaults = DEFAULT_AGENT_BUDGETS[this.agentId] ?? DEFAULT_AGENT_BUDGETS.planner;
    this.agentBudget = { ...agentDefaults, ...options.agentConfig };
    this.pipelineBudget = { ...DEFAULT_PIPELINE_BUDGET, ...options.pipelineConfig };
  }

  // -------------------------------------------------------------------------
  // Verificacion de budget (llamar ANTES de invocar LLM)
  // -------------------------------------------------------------------------

  /**
   * Verificar si hay budget disponible.
   * Lanza error si se supera algun limite.
   * CHK-API-114 compatible
   */
  checkBudget(agentId?: string): void {
    const agent = agentId ?? this.agentId;

    // Circuit breaker global
    if (BudgetManager.globalCircuitOpen) {
      throw new Error(
        `EC-AI-002: Circuit breaker abierto. Demasiados fallos consecutivos (${BudgetManager.globalConsecutiveFailures}). ` +
          `Espera antes de reintentar.`
      );
    }

    // Circuit breaker local del agente
    if (this.circuitOpen) {
      throw new Error(
        `EC-AI-002: Circuit breaker del agente '${agent}' abierto (${this.consecutiveFailures} fallos consecutivos).`
      );
    }

    // Budget de sesion por agente
    if (this.sessionCostUsd >= this.agentBudget.maxCostUsdSession) {
      throw new Error(
        `EC-AI-002: Presupuesto USD del agente '${agent}' excedido: ` +
          `$${this.sessionCostUsd.toFixed(4)} / $${this.agentBudget.maxCostUsdSession.toFixed(4)}`
      );
    }

    if (this.sessionTokensUsed >= this.agentBudget.maxTotalTokensSession) {
      throw new Error(
        `EC-AI-002: Presupuesto de tokens del agente '${agent}' excedido: ` +
          `${this.sessionTokensUsed} / ${this.agentBudget.maxTotalTokensSession} tokens`
      );
    }

    // Budget del pipeline
    if (BudgetManager.pipelineCostUsd >= this.pipelineBudget.maxCostUsdPipeline) {
      throw new Error(
        `EC-AI-002: Presupuesto USD del pipeline excedido: ` +
          `$${BudgetManager.pipelineCostUsd.toFixed(4)} / $${this.pipelineBudget.maxCostUsdPipeline.toFixed(4)}`
      );
    }

    // Rate limit: requests por minuto
    this.checkRateLimit();
  }

  /**
   * Verificar rate limit de requests/min y tokens/min.
   */
  private checkRateLimit(): void {
    const now = Date.now();
    const windowMs = 60 * 1000;

    // Limpiar timestamps viejos
    BudgetManager.requestTimestamps = BudgetManager.requestTimestamps.filter(
      (ts) => now - ts < windowMs
    );
    BudgetManager.tokenTimestamps = BudgetManager.tokenTimestamps.filter(
      (e) => now - e.ts < windowMs
    );

    if (BudgetManager.requestTimestamps.length >= this.pipelineBudget.maxRequestsPerMinute) {
      const oldestTs = BudgetManager.requestTimestamps[0];
      const waitMs = windowMs - (now - oldestTs);
      throw new Error(
        `EC-AI-002: Rate limit alcanzado (${this.pipelineBudget.maxRequestsPerMinute} req/min). ` +
          `Espera ${Math.ceil(waitMs / 1000)}s antes de reintentar.`
      );
    }

    const tokensInWindow = BudgetManager.tokenTimestamps.reduce((s, e) => s + e.tokens, 0);
    if (tokensInWindow >= this.pipelineBudget.maxTokensPerMinute) {
      throw new Error(
        `EC-AI-002: Rate limit de tokens alcanzado (${this.pipelineBudget.maxTokensPerMinute} tokens/min).`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Registro de uso (llamar DESPUES de recibir respuesta del LLM)
  // -------------------------------------------------------------------------

  recordUsage(agentId: string, usage: TokenUsage): void {
    const now = Date.now();
    const invocationId = `${agentId}-${now}`;

    // Actualizar tracking local
    this.sessionTokensUsed += usage.totalTokens;
    this.sessionCostUsd += usage.estimatedCostUsd;

    // Actualizar tracking global del pipeline
    BudgetManager.pipelineTokensUsed += usage.totalTokens;
    BudgetManager.pipelineCostUsd += usage.estimatedCostUsd;

    // Rate limit tracking
    BudgetManager.requestTimestamps.push(now);
    BudgetManager.tokenTimestamps.push({ ts: now, tokens: usage.totalTokens });

    // Historial
    this.usageHistory.push({
      agentId,
      timestamp: new Date(now).toISOString(),
      tokensUsed: usage,
      invocationId,
    });

    // Reset circuit breaker en exito
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
  }

  recordFailure(_agentId: string): void {
    this.consecutiveFailures++;
    BudgetManager.globalConsecutiveFailures++;

    if (this.consecutiveFailures >= this.pipelineBudget.circuitBreakerThreshold) {
      this.circuitOpen = true;
    }
    if (
      BudgetManager.globalConsecutiveFailures >=
      this.pipelineBudget.circuitBreakerThreshold * 2
    ) {
      BudgetManager.globalCircuitOpen = true;
    }
  }

  resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
    BudgetManager.globalConsecutiveFailures = 0;
    BudgetManager.globalCircuitOpen = false;
  }

  // -------------------------------------------------------------------------
  // Consulta de estado
  // -------------------------------------------------------------------------

  getStatus(): BudgetStatus {
    const utilizationPct =
      this.agentBudget.maxTotalTokensSession > 0
        ? (this.sessionTokensUsed / this.agentBudget.maxTotalTokensSession) * 100
        : 0;

    return {
      agentId: this.agentId,
      sessionTokensUsed: this.sessionTokensUsed,
      sessionCostUsd: this.sessionCostUsd,
      sessionTokensBudget: this.agentBudget.maxTotalTokensSession,
      sessionCostBudget: this.agentBudget.maxCostUsdSession,
      utilizationPct: Math.round(utilizationPct * 10) / 10,
      withinBudget:
        this.sessionCostUsd < this.agentBudget.maxCostUsdSession &&
        this.sessionTokensUsed < this.agentBudget.maxTotalTokensSession,
      consecutiveFailures: this.consecutiveFailures,
      circuitOpen: this.circuitOpen,
    };
  }

  static getPipelineStatus(): {
    pipelineTokensUsed: number;
    pipelineCostUsd: number;
    circuitOpen: boolean;
    consecutiveFailures: number;
  } {
    return {
      pipelineTokensUsed: BudgetManager.pipelineTokensUsed,
      pipelineCostUsd: BudgetManager.pipelineCostUsd,
      circuitOpen: BudgetManager.globalCircuitOpen,
      consecutiveFailures: BudgetManager.globalConsecutiveFailures,
    };
  }

  static resetPipelineCounters(): void {
    BudgetManager.pipelineTokensUsed = 0;
    BudgetManager.pipelineCostUsd = 0;
    BudgetManager.requestTimestamps = [];
    BudgetManager.tokenTimestamps = [];
    BudgetManager.globalConsecutiveFailures = 0;
    BudgetManager.globalCircuitOpen = false;
  }

  getHistory(): UsageRecord[] {
    return [...this.usageHistory];
  }

  getSessionCostUsd(): number {
    return this.sessionCostUsd;
  }

  getSessionTokensUsed(): number {
    return this.sessionTokensUsed;
  }

  /** Estimacion de tokens restantes antes de alcanzar el limite */
  getRemainingTokenBudget(): number {
    return Math.max(0, this.agentBudget.maxTotalTokensSession - this.sessionTokensUsed);
  }
}
