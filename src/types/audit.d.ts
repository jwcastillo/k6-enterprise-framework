/** Audit logging types for k6 Enterprise Framework (Phase 2) */

/** Event types recorded in the audit log */
export type AuditEventType =
  | "execution_start"
  | "execution_end"
  | "config_change"
  | "threshold_change"
  | "slo_change"
  | "role_change"
  | "access_denied"
  | "secret_access"
  | "client_created"
  | "binary_compiled"
  | "chaos_configured"
  | "report_generated"
  | "report_exported"
  | "audit_query";

/** Result status for audit events */
export type AuditResult = "success" | "failure" | "warning" | "denied";

/** Single entry in the immutable audit log (JSON Lines format) */
export interface AuditEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Type of event */
  event: AuditEventType;
  /** Identity of the actor (user or "system") */
  actor: string;
  /** Client namespace */
  client: string;
  /** Service under test (if applicable) */
  service?: string;
  /** Environment */
  environment?: string;
  /** Load profile used (if applicable) */
  profile?: string;
  /** Event-specific parameters */
  params?: Record<string, unknown>;
  /** Result of the operation */
  result: AuditResult;
  /** Human-readable message */
  message?: string;
  /** Link to generated report (if applicable) */
  reportLink?: string;
  /** Duration in milliseconds (for execution events) */
  durationMs?: number;
  /** SHA-256 hash of this entry (content + previous hash) */
  hash: string;
  /** SHA-256 hash of the previous entry (chain integrity) */
  previousHash: string;
}

/** Filters for querying the audit log */
export interface AuditQuery {
  /** Client to query (required) */
  client: string;
  /** Start date (ISO 8601) */
  from?: string;
  /** End date (ISO 8601) */
  to?: string;
  /** Filter by event type */
  eventType?: AuditEventType;
  /** Filter by actor */
  actor?: string;
  /** Filter by service */
  service?: string;
  /** Filter by result */
  result?: AuditResult;
  /** Output format */
  format?: "json" | "csv" | "table";
  /** Maximum entries to return (0 = all) */
  limit?: number;
}

/** Change tracking entry for config modifications */
export interface ConfigChangeDetail {
  /** Field path that changed (e.g., "thresholds.http_req_duration") */
  field: string;
  /** Previous value */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
  /** Optional justification provided via --reason */
  justification?: string;
}
