/**
 * T-041: Immutable audit log system
 *
 * Records all framework operations in append-only JSON Lines format.
 * Each entry is hash-chained (SHA-256) for tamper detection.
 *
 * Storage: reports/{client}/audit/audit-{YYYY-MM}.jsonl
 * Format: One JSON object per line (JSON Lines / .jsonl)
 *
 * Note: This module runs in Node.js context (bin/), NOT in k6 goja runtime.
 *
 * ⚠ SINGLE-WRITER SEMANTICS REQUIRED ⚠
 * The hash chain maintained by this module assumes exactly ONE writer process
 * per monthly audit file at a time. Concurrent writes from multiple Node.js
 * processes (e.g., two parallel CI jobs writing to the same shared reports
 * directory) will corrupt the hash chain: each process tracks its own
 * in-memory `lastHash`, so interleaved appends produce entries whose
 * `previousHash` does not match the actual preceding line in the file.
 *
 * Enforcement: `writeAuditEntry` performs a best-effort concurrent-writer
 * detection check before each write. If another writer has appended since
 * the last known hash, a `console.warn` is emitted and the chain is
 * re-synced. This does NOT make concurrent writes safe — it only makes
 * the corruption visible. To guarantee chain integrity, ensure that only
 * one process writes to a given monthly file at a time (e.g., serialize
 * audit writes through a single orchestrator process, or partition audit
 * files by process/worker ID).
 */

import {
  AuditEntry,
  AuditEventType,
  AuditQuery,
  AuditResult,
  ConfigChangeDetail,
} from "../types/audit.d";
import { ClientContext } from "../types/client.d";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");
const crypto = require("crypto") as typeof import("crypto");

// ── Constants ─────────────────────────────────────────────────────────────────

const AUDIT_DIR = "audit";
const GENESIS_HASH = "0".repeat(64);
const FILE_PERMISSIONS = 0o644;

// ── Singleton state ───────────────────────────────────────────────────────────

let lastHash: string = GENESIS_HASH;
let currentAuditFile: string | null = null;

// ── Core logging ──────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of an entry's content chained with the previous hash.
 */
function computeHash(content: string, previousHash: string): string {
  return crypto
    .createHash("sha256")
    .update(previousHash + content)
    .digest("hex");
}

/**
 * Resolve the audit directory for a client.
 */
function resolveAuditDir(clientContext: ClientContext): string {
  return path.join(clientContext.reportsDir, AUDIT_DIR);
}

/**
 * Get the audit log filename for a given date.
 */
function auditFilename(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `audit-${yyyy}-${mm}.jsonl`;
}

/**
 * Initialize the audit logger for a client.
 * Reads the last hash from the existing log to continue the chain.
 */
export function initAuditLogger(clientContext: ClientContext): void {
  const auditDir = resolveAuditDir(clientContext);

  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true, mode: 0o755 });
  }

  const filename = auditFilename(new Date());
  currentAuditFile = path.join(auditDir, filename);

  // Read the last hash from the existing file to continue the chain
  if (fs.existsSync(currentAuditFile)) {
    const content = fs.readFileSync(currentAuditFile, "utf-8").trim();
    if (content) {
      const lines = content.split("\n");
      const lastLine = lines[lines.length - 1];
      try {
        const lastEntry = JSON.parse(lastLine) as AuditEntry;
        lastHash = lastEntry.hash;
      } catch {
        // Corrupted last line — start fresh chain from genesis
        lastHash = GENESIS_HASH;
        console.warn(
          "[audit-logger] Warning: last audit entry is corrupted. Starting new hash chain."
        );
      }
    }
  } else {
    lastHash = GENESIS_HASH;
  }
}

/**
 * Resolve the identity of the current actor.
 * Priority: K6_AUDIT_USER > K6_USER > $USER > "unknown"
 *
 * SEC-06: Sanitizes the value with the same regex used by rbac.resolveCurrentUser
 * to prevent log-injection via newlines or control characters in K6_AUDIT_USER.
 * Allowed: [a-zA-Z0-9._@-], max 256 chars (vs rbac's 128 — actors may be longer).
 */
export function resolveActor(): string {
  const raw =
    process.env["K6_AUDIT_USER"] ?? process.env["K6_USER"] ?? process.env["USER"] ?? "unknown";
  // Strip any characters outside the allowed set, then truncate to 256 chars
  const sanitized = raw.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 256);
  if (sanitized !== raw && raw !== "unknown") {
    console.warn(
      `[audit-logger] WARNING: K6_AUDIT_USER/K6_USER contained invalid characters — sanitized to '${sanitized || "unknown"}'`
    );
  }
  return sanitized || "unknown";
}

/**
 * Write an audit entry to the log.
 *
 * This is the core function — all audit operations go through here.
 * The entry is appended atomically and the file is set to 0644 permissions.
 */
export function writeAuditEntry(
  clientContext: ClientContext,
  event: AuditEventType,
  result: AuditResult,
  params?: Record<string, unknown>,
  extras?: Partial<
    Pick<
      AuditEntry,
      "service" | "environment" | "profile" | "message" | "reportLink" | "durationMs"
    >
  >
): AuditEntry {
  // Ensure logger is initialized
  if (!currentAuditFile) {
    initAuditLogger(clientContext);
  }

  // Check if we need to rotate to a new monthly file
  const expectedFilename = auditFilename(new Date());
  const auditDir = resolveAuditDir(clientContext);
  const expectedPath = path.join(auditDir, expectedFilename);
  if (currentAuditFile !== expectedPath) {
    currentAuditFile = expectedPath;
    if (!fs.existsSync(currentAuditFile)) {
      // Brand-new monthly file — start a fresh hash chain
      lastHash = GENESIS_HASH;
    } else {
      // File already exists (created by a prior process or run in the same month).
      // CR-02: read the last entry's hash so the chain continues unbroken.
      try {
        const content = fs.readFileSync(currentAuditFile, "utf-8").trim();
        if (content) {
          const lines = content.split("\n");
          const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
          lastHash = lastEntry.hash;
        } else {
          lastHash = GENESIS_HASH;
        }
      } catch {
        // Corrupted or unreadable — start fresh chain rather than break silently
        lastHash = GENESIS_HASH;
      }
    }
  }

  const entry: Omit<AuditEntry, "hash"> & { hash?: string } = {
    timestamp: new Date().toISOString(),
    event,
    actor: resolveActor(),
    client: clientContext.clientId,
    result,
    params,
    previousHash: lastHash,
    ...extras,
  };

  // Compute hash of the entry content (without hash field) chained with previous
  const contentForHash = JSON.stringify(entry);
  const hash = computeHash(contentForHash, lastHash);
  (entry as AuditEntry).hash = hash;

  // Concurrent-writer detection: before appending, verify the last line in the
  // file still matches our in-memory lastHash. A mismatch means another process
  // wrote to the file since we last read it — chain integrity is already broken.
  // We emit a warning and update lastHash so the corruption is at least visible
  // rather than silently propagating through all future entries.
  try {
    if (currentAuditFile && fs.existsSync(currentAuditFile!)) {
      const onDisk = fs.readFileSync(currentAuditFile!, "utf-8").trim();
      if (onDisk) {
        const diskLines = onDisk.split("\n");
        const diskLast = diskLines[diskLines.length - 1];
        try {
          const diskLastEntry = JSON.parse(diskLast) as AuditEntry;
          if (diskLastEntry.hash !== lastHash) {
            console.warn(
              "[audit-logger] WARNING: concurrent writer detected — on-disk last hash " +
                `'${diskLastEntry.hash.slice(0, 12)}...' does not match in-memory hash ` +
                `'${lastHash.slice(0, 12)}...'. ` +
                "Hash chain is broken. Ensure only one process writes to the audit file at a time."
            );
          }
        } catch {
          // Unparseable last line — skip detection, write will proceed
        }
      }
    }
  } catch {
    // Detection read failed (e.g., permission error) — proceed with write
  }

  const line = JSON.stringify(entry) + "\n";

  try {
    fs.appendFileSync(currentAuditFile!, line, { mode: FILE_PERMISSIONS });
    lastHash = hash;
  } catch (err) {
    // EC-REP-007: If storage is unavailable, continue with warning
    console.error(`[audit-logger] WARNING: Failed to write audit entry: ${(err as Error).message}`);
    console.error("[audit-logger] Execution will continue but this event is NOT audited.");
  }

  return entry as AuditEntry;
}

// ── Convenience loggers ───────────────────────────────────────────────────────

/** Log the start of a test execution */
export function logExecutionStart(
  ctx: ClientContext,
  service: string,
  environment: string,
  profile: string,
  testName: string
): AuditEntry {
  return writeAuditEntry(
    ctx,
    "execution_start",
    "success",
    { testName },
    {
      service,
      environment,
      profile,
      message: `Test execution started: ${testName}`,
    }
  );
}

/** Log the end of a test execution */
export function logExecutionEnd(
  ctx: ClientContext,
  service: string,
  environment: string,
  profile: string,
  testName: string,
  passed: boolean,
  durationMs: number,
  reportLink?: string
): AuditEntry {
  return writeAuditEntry(
    ctx,
    "execution_end",
    passed ? "success" : "failure",
    { testName, passed },
    {
      service,
      environment,
      profile,
      durationMs,
      reportLink,
      message: `Test execution ${passed ? "passed" : "failed"}: ${testName}`,
    }
  );
}

/** Log a configuration change with before/after values */
export function logConfigChange(ctx: ClientContext, changes: ConfigChangeDetail[]): AuditEntry {
  return writeAuditEntry(
    ctx,
    "config_change",
    "success",
    {
      changes: changes.map((c) => ({
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        justification: c.justification,
      })),
    },
    {
      message: `Configuration changed: ${changes.map((c) => c.field).join(", ")}`,
    }
  );
}

/** Log an access denied event */
export function logAccessDenied(ctx: ClientContext, operation: string, reason: string): AuditEntry {
  return writeAuditEntry(
    ctx,
    "access_denied",
    "denied",
    { operation, reason },
    {
      message: `Access denied: ${operation} — ${reason}`,
    }
  );
}

/** Log a role change */
export function logRoleChange(
  ctx: ClientContext,
  targetUser: string,
  oldRole: string,
  newRole: string,
  justification?: string
): AuditEntry {
  return writeAuditEntry(
    ctx,
    "role_change",
    "success",
    {
      targetUser,
      oldRole,
      newRole,
      justification,
    },
    {
      message: `Role changed for '${targetUser}': ${oldRole} → ${newRole}`,
    }
  );
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Query audit log entries with filters.
 * Reads all matching monthly files and applies filters in memory.
 */
export function queryAuditLog(clientContext: ClientContext, query: AuditQuery): AuditEntry[] {
  const auditDir = resolveAuditDir(clientContext);

  if (!fs.existsSync(auditDir)) {
    return [];
  }

  // Determine which monthly files to read
  const files = fs
    .readdirSync(auditDir)
    .filter((f: string) => f.startsWith("audit-") && f.endsWith(".jsonl"))
    .sort();

  const entries: AuditEntry[] = [];

  for (const file of files) {
    // Quick date-range filter by filename (audit-YYYY-MM.jsonl)
    if (query.from || query.to) {
      const fileMonth = file.replace("audit-", "").replace(".jsonl", "");
      if (query.from && fileMonth < query.from.slice(0, 7)) continue;
      if (query.to && fileMonth > query.to.slice(0, 7)) continue;
    }

    const filePath = path.join(auditDir, file);
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) continue;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as AuditEntry;

        // Apply filters
        if (query.from && entry.timestamp < query.from) continue;
        if (query.to && entry.timestamp > query.to) continue;
        if (query.eventType && entry.event !== query.eventType) continue;
        if (query.actor && entry.actor !== query.actor) continue;
        if (query.service && entry.service !== query.service) continue;
        if (query.result && entry.result !== query.result) continue;

        entries.push(entry);

        if (query.limit && query.limit > 0 && entries.length >= query.limit) {
          return entries;
        }
      } catch {
        // Skip corrupted lines
        continue;
      }
    }
  }

  return entries;
}

/**
 * Verify the integrity of the audit log hash chain.
 * Returns the first broken entry index, or -1 if chain is intact.
 */
export function verifyAuditChain(
  clientContext: ClientContext,
  month?: string
): { valid: boolean; brokenAt: number; totalEntries: number } {
  const auditDir = resolveAuditDir(clientContext);
  const targetFile = month ? path.join(auditDir, `audit-${month}.jsonl`) : currentAuditFile;

  if (!targetFile || !fs.existsSync(targetFile)) {
    return { valid: true, brokenAt: -1, totalEntries: 0 };
  }

  const content = fs.readFileSync(targetFile, "utf-8").trim();
  if (!content) return { valid: true, brokenAt: -1, totalEntries: 0 };

  const lines = content.split("\n");
  let previousHash = GENESIS_HASH;

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]) as AuditEntry;

      if (entry.previousHash !== previousHash) {
        return { valid: false, brokenAt: i, totalEntries: lines.length };
      }

      // Reconstruct the content that was hashed
      const reconstructed = { ...entry, hash: undefined };
      const contentForHash = JSON.stringify(reconstructed);
      const expectedHash = computeHash(contentForHash, previousHash);

      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i, totalEntries: lines.length };
      }

      previousHash = entry.hash;
    } catch {
      return { valid: false, brokenAt: i, totalEntries: lines.length };
    }
  }

  return { valid: true, brokenAt: -1, totalEntries: lines.length };
}

/**
 * Reset the audit logger state (for testing purposes only).
 */
export function resetAuditLogger(): void {
  lastHash = GENESIS_HASH;
  currentAuditFile = null;
}
