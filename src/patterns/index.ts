/** Barrel export — k6 Enterprise Framework patterns */

export { authenticate, isSessionValid, sessionRequestOptions } from "./auth-pattern";
export type {
  AuthConfig,
  AuthSession,
  BearerAuthConfig,
  BasicAuthConfig,
  OAuth2Config,
  ApiKeyConfig,
} from "./auth-pattern";

export { extractFromResponse, interpolate, mergeWithExtracted } from "./correlation-pattern";
export type { CorrelationRule, ExtractedValues } from "./correlation-pattern";

export { initPagination, advancePagination, traverseAll } from "./pagination-pattern";
export type { PaginationConfig, PaginationState } from "./pagination-pattern";

export { withRetry, retryRequest } from "./retry-pattern";
export type { RetryConfig, RetryResult } from "./retry-pattern";

export { weightedSelect, weightedSwitch, validateWeights } from "./weighted-execution";
export type { WeightedScenario } from "./weighted-execution";

export { ContractValidator, defaultValidator } from "./contract-validation";
export type { ContractValidationResult, ContractError } from "./contract-validation";

// mock-server moved to src/node/ in Phase 4 (ARC-06). Import via @node/mock-server.

// loadChaosConfig moved to src/node/ in Phase 4 (ARC-06). Import via @node/chaos-injection-node.
export {
  evaluateChaosRules,
  recordServiceError,
  buildChaosReportBreakdown,
  formatChaosForHtml,
  formatChaosForJson,
  resetChaosState,
} from "./chaos-injection";
export type { ChaosFaultResult } from "./chaos-injection";

// T-099: Redis coordination patterns
export {
  UserPool,
  DistributedRateLimiter,
  StatsCounter,
  parseCsv,
  parseCsvLine,
} from "./redis-patterns";
export type { PoolExhaustionPolicy, UserPoolOptions } from "./redis-patterns";

// Funnel pattern: sequential step execution with drop-off tracking
export { runFunnel } from "./funnel-pattern";
export type { FunnelStep, FunnelConfig, FunnelResult } from "./funnel-pattern";
