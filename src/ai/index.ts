/**
 * Phase 5: AI Agentic Pipeline — barrel exports
 * FR-169 to FR-178
 */

// Agents
export { PlannerAgent } from "./agents/planner-agent.js";
export { BuilderAgent } from "./agents/builder-agent.js";
export { AnalystAgent } from "./agents/analyst-agent.js";
export { ReporterAgent } from "./agents/reporter-agent.js";

// Core
export { BudgetManager } from "./core/budget-manager.js";

// Knowledge base
export {
  KnowledgeBaseManager,
  generateEmbedding,
  chunkText,
} from "./knowledge-base/knowledge-base.js";

// Analysis
export {
  AnomalyDetector,
  k6SummaryToSeries,
  detectRegressions,
} from "./analysis/anomaly-detector.js";

// Observability
export {
  PrometheusClient,
  TempoClient,
  LokiClient,
  PyroscopeClient,
  createObservabilityClients,
  executeObservabilityQuery,
} from "./observability/observability-clients.js";

// Pipeline
export { PipelineOrchestrator } from "./pipeline/orchestrator.js";

// Adaptive
export { SelfHealingEngine } from "./adaptive/self-healing.js";

// Fixtures (for testing)
export { ALL_TEST_PLANS } from "./agents/fixtures/test-plans.js";

// Phase 5 — LLM Provider abstraction (AI-01)
export type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  TokenUsage,
  EstimateCostResult,
} from "./core/llm-provider.js";
export * from "./core/providers/index.js";

// Phase 5 — pricing config (AI-02 / D-06..D-09)
export { loadPricing, lookupRate } from "./core/pricing.js";
export type { ModelRate, PricingTable } from "./core/pricing.js";
