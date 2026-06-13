/** Barrel export — k6 Enterprise Framework helpers — Phase 2 updated */

export {
  DataHelper,
  randomString,
  randomEmail,
  randomCreditCard,
  randomUser,
  randomPrice,
} from "./data-helper";
export { DateHelper } from "./date-helper";
export { HeaderHelper } from "./header-helper";
export type { HeaderMap, TraceHeaders, AuthHeaders } from "./header-helper";
export { PerformanceHelper } from "./performance-helper";
export type { PercentileResult, AggregateResult, BaselineComparison } from "./performance-helper";
export { RequestHelper } from "./request-helper";
export type { RequestOptions } from "./request-helper";
export type { SafeResponse } from "../types/safe-response";
export { ValidationHelper } from "./validation-helper";
export type { ResponseValidation, ValidationResult } from "./validation-helper";
export { StructuredLogger } from "./structured-logger";
export type { LogLevel, LogEntry } from "./structured-logger";
export { RedisHelper } from "./redis-helper";
export { GraphQLHelper } from "./graphql-helper";
export type { GraphQLQuery, GraphQLResponse, GraphQLError } from "./graphql-helper";
/** @deprecated Use websocket-v2-helper instead */
export { runWebSocket, wsEchoTest } from "./websocket-helper";
/** @deprecated Use WebSocketV2Config, WebSocketV2Session instead */
export type { WebSocketConfig, WebSocketSession } from "./websocket-helper";

// WebSocket v2 — stable k6/websockets module (k6 v1.6.0+)
export { runWebSocketV2, wsEchoTestV2, closeWithReason } from "./websocket-v2-helper";
export type {
  WebSocketV2Config,
  WebSocketV2Session,
  WebSocketV2Message,
  WebSocketCloseInfo,
} from "./websocket-v2-helper";
export {
  uploadFile,
  downloadFile,
  withRateLimitHandling,
  rateLimitHits,
  successfulRequests,
} from "./upload-helper";
export type { UploadResult, DownloadResult } from "./upload-helper";

// Browser helper — k6 browser module utilities (k6 v1.2.1–v1.6.0+)
export { BrowserHelper } from "./browser-helper";
export type { BrowserHelperConfig } from "./browser-helper";

// Crypto helper — HMAC, hash, JWT utilities (PBKDF2 k6 v1.6.0+)
export { CryptoHelper } from "./crypto-helper";
export type { HashAlgorithm } from "./crypto-helper";

// Think-time simulation — realistic user delay patterns
export {
  ThinkTimeHelper,
  thinkTime,
  thinkTimeNormal,
  randomNormal,
  pace,
  THINK_TIME,
} from "./think-time-helper";

// Phase 2: Data pools
export { DataPool, createPool, createCsvPool } from "./data-pool";

// Error capture — log/persist responses with unexpected status codes.
// Module lives in src/core/ since Phase 4 (ARC-01 closure); re-exported here
// for backwards compatibility with `import { ... } from "@helpers"` callers.
export {
  captureUnexpectedResponse,
  getCapturedErrors,
  clearCapturedErrors,
  captureErrorsSummaryFile,
} from "../core/error-capture";
export type { CaptureContext, CapturedError } from "../core/error-capture";
