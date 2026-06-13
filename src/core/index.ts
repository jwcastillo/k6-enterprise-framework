/** Barrel export — k6 Enterprise Framework core */

export { parseCLIArgs, validateCLIArgs } from "./cli";
export type { CLIArgs } from "./cli";

export {
  buildOptions,
  buildClientConfig,
  buildTestConfig,
  getActiveConfig,
  getSecret,
  validateEnvConfig,
} from "./config-loader";

export {
  buildK6Options,
  standardSetup,
  standardTeardown,
  standardHandleSummary,
  buildExecutionSummary,
  validateScriptConfig,
} from "./execution-engine";
export type { ExecutionContext, SetupResult } from "./execution-engine";

export { loadProfile, listProfiles, mergeThresholds, profileToOptions } from "./profile-loader";

export {
  resolveSecret,
  resolveSecretOr,
  resolveSecretWithMetadata,
  maskSecret,
} from "./secrets-manager";
export type { SecretsBackend, SecretOptions, ResolvedSecret } from "./secrets-manager";

export {
  registerCheck,
  statusCheck,
  statusRangeCheck,
  schemaCheck,
  contentCheck,
  thresholdCheck,
  customCheck,
  runChecks,
  runChecksDetailed,
} from "./check-system";
export type { CheckSpec, CheckSummary, CheckType } from "./check-system";

// Error capture — moved from src/helpers/ to src/core/ in Phase 4 (ARC-01 closure)
export {
  captureUnexpectedResponse,
  getCapturedErrors,
  clearCapturedErrors,
  captureErrorsSummaryFile,
} from "./error-capture";
export type { CaptureContext, CapturedError } from "./error-capture";

// Client config — blessed as public API in Phase 4 (ARC-02 amendment).
// Active callers under clients/<name>/scenarios/ via @core/client-config.
export { THINK, createClientConfig } from "./client-config";
export type { ThinkTime, ClientHelpers } from "./client-config";

export { expect } from "./assertion-helper";
export {
  ResponseExpectation,
  FieldExpectation,
  HeaderExpectation,
  DurationExpectation,
} from "./assertion-helper";
export type { AssertionResult } from "./assertion-helper";

export {
  validateClientManifest,
  resolveRequiredPaths,
  assertSecurityBoundary,
  CLIENT_REQUIRED_DIRS,
  CLIENT_REQUIRED_FILES,
} from "./client-validator";
export type { ClientManifest, ValidationReport } from "./client-validator";

// Phase 2: Enterprise modules

export {
  resolveClient,
  resolveFrameworkRoot,
  assertPathInClientScope,
  ensureReportsDir,
  listClients,
} from "./client-resolver";

export {
  initAuditLogger,
  writeAuditEntry,
  logExecutionStart,
  logExecutionEnd,
  logConfigChange,
  logAccessDenied,
  logRoleChange,
  queryAuditLog,
  verifyAuditChain,
  resolveActor,
  resetAuditLogger,
} from "./audit-logger";

export {
  resolveCurrentUser,
  loadRbacConfig,
  resolveUserRole,
  checkPermission,
  checkProfilePermission,
  checkCrossClientAccess,
  getRolePermissions,
} from "./rbac";

export {
  loadSloConfig,
  findServiceSlos,
  evaluateServiceSlos,
  evaluateSlos,
  formatSloForJson,
  formatSloForHtml,
} from "./slo-evaluator";

export {
  loadThresholdOverrides,
  mergeThresholdHierarchy,
  buildClientThresholds,
  diffThresholds,
} from "./threshold-manager";

export {
  buildIsolatedEnv,
  createIsolatedTempDir,
  cleanupIsolatedTempDir,
  buildIsolatedTags,
  sanitizeErrorForClient,
  buildIsolatedContext,
} from "./execution-isolation";
export type { IsolatedExecutionContext } from "./execution-isolation";

export {
  buildReportDir,
  listClientReports,
  findLatestReport,
  findRecentReports,
  validateReportAccess,
  writeReportArtifact,
  readReportArtifact,
} from "./report-isolation";

export {
  enforcePermission,
  enforceProfileExecution,
  enforceCrossClientAccess,
  enforceConfigModification,
  enforceExecutionPermissions,
} from "./rbac-enforcer";

export { detectAndLogConfigChanges, captureConfigSnapshot } from "./config-tracker";

// Phase 6: Security hardening modules (T-133, T-134, T-135, T-136, T-137, T-138)

export { validateBrandingAsset, pruneOldReports } from "./branding-validator";
export type { BrandingValidationResult } from "./branding-validator";

export { validateCliAuth, authorizeBotCommand, auditHtmlReportForXss } from "./cli-auth";
export type { CliAuthResult, BotCommandContext, BotAuthResult } from "./cli-auth";

export {
  sanitizePrometheusLabel,
  assertValidPrometheusLabel,
  sanitizePrometheusValue,
  sanitizeTagsForPrometheus,
} from "./prometheus-sanitizer";

export { validateK6Binary, validateJslibImport } from "./binary-validator";

export { validateCustomProfile } from "./profile-validator";
export type { CustomProfileDefinition, StageDefinition } from "./profile-validator";

export {
  validateConfigJson,
  escapeShellValue,
  looksLikeHardcodedSecret,
  isSecretEnvVar,
  auditConfigForSecrets,
  redactSensitiveFields,
} from "./config-security";
export type { SecretFinding } from "./config-security";

// T-260: GPT-inspired throughput model (users -> RPS -> recommended VUs)
export { targetRpsForUsers, recommendMaxVUs, buildThroughputPlan } from "./throughput-model";
export type { EndpointClass } from "./throughput-model";

// T-261: GPT-inspired test gating (orthogonal safety axis — NOT a 6th bucket)
export { isGateAllowed, GATE_KINDS } from "./gating";
export type { GateKind } from "./gating";
