/**
 * T-042: Config change tracking in audit log
 *
 * Detects and records configuration changes (thresholds, SLOs, roles, chaos)
 * by comparing current config against a cached snapshot.
 *
 * The snapshot is stored in reports/{client}/audit/.config-snapshot.json
 * and updated after each tracked change.
 *
 * Runs in Node.js context (bin/), NOT in k6 goja runtime.
 */

import { ClientContext } from "../types/client.d";
import { ConfigChangeDetail } from "../types/audit.d";
import { logConfigChange } from "./audit-logger";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");

// ── Snapshot management ───────────────────────────────────────────────────────

const SNAPSHOT_DIR = "audit";
const SNAPSHOT_FILE = ".config-snapshot.json";

interface ConfigSnapshot {
  capturedAt: string;
  files: Record<string, unknown>;
}

/**
 * Resolve the path to the config snapshot file.
 */
function snapshotPath(clientContext: ClientContext): string {
  return path.join(clientContext.reportsDir, SNAPSHOT_DIR, SNAPSHOT_FILE);
}

/**
 * Load the previous config snapshot for a client.
 * Returns null if no snapshot exists (first run).
 */
function loadSnapshot(clientContext: ClientContext): ConfigSnapshot | null {
  const sp = snapshotPath(clientContext);
  if (!fs.existsSync(sp)) return null;

  try {
    return JSON.parse(fs.readFileSync(sp, "utf-8")) as ConfigSnapshot;
  } catch {
    return null;
  }
}

/**
 * Save a config snapshot for future comparison.
 */
function saveSnapshot(
  clientContext: ClientContext,
  snapshot: ConfigSnapshot,
): void {
  const sp = snapshotPath(clientContext);
  const dir = path.dirname(sp);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  fs.writeFileSync(sp, JSON.stringify(snapshot, null, 2), "utf-8");
}

// ── Config file reading ───────────────────────────────────────────────────────

/** Config files tracked for changes */
const TRACKED_FILES = [
  "config/thresholds.json",
  "config/slos.json",
  "config/rbac.json",
  "config/chaos.json",
];

/**
 * Read all tracked config files for a client.
 * Returns a map of relative path → parsed JSON content.
 */
function readCurrentConfigs(
  clientContext: ClientContext,
): Record<string, unknown> {
  const configs: Record<string, unknown> = {};

  for (const relPath of TRACKED_FILES) {
    const fullPath = path.join(clientContext.rootDir, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        configs[relPath] = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      } catch {
        configs[relPath] = null;
      }
    }
  }

  return configs;
}

// ── Diff engine ───────────────────────────────────────────────────────────────

/**
 * Deep-diff two values, producing a flat list of field-level changes.
 */
function deepDiff(
  oldVal: unknown,
  newVal: unknown,
  prefix: string,
): ConfigChangeDetail[] {
  const changes: ConfigChangeDetail[] = [];

  if (oldVal === newVal) return changes;
  if (oldVal === undefined && newVal === undefined) return changes;

  // Primitive or type mismatch
  if (
    typeof oldVal !== typeof newVal ||
    oldVal === null ||
    newVal === null ||
    typeof oldVal !== "object"
  ) {
    changes.push({ field: prefix, oldValue: oldVal, newValue: newVal });
    return changes;
  }

  // Arrays
  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ field: prefix, oldValue: oldVal, newValue: newVal });
    }
    return changes;
  }

  // Objects
  const oldObj = oldVal as Record<string, unknown>;
  const newObj = newVal as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    changes.push(...deepDiff(oldObj[key], newObj[key], fieldPath));
  }

  return changes;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect and log any configuration changes since the last snapshot.
 *
 * Call this at the start of each execution to capture any config changes
 * that happened between runs.
 *
 * @param clientContext - Active client context
 * @param justification - Optional reason for the changes (from --reason CLI flag)
 * @returns Array of detected changes (empty if nothing changed)
 */
export function detectAndLogConfigChanges(
  clientContext: ClientContext,
  justification?: string,
): ConfigChangeDetail[] {
  const previousSnapshot = loadSnapshot(clientContext);
  const currentConfigs = readCurrentConfigs(clientContext);

  // Build new snapshot
  const newSnapshot: ConfigSnapshot = {
    capturedAt: new Date().toISOString(),
    files: currentConfigs,
  };

  // First run — save snapshot, no changes to report
  if (!previousSnapshot) {
    saveSnapshot(clientContext, newSnapshot);
    return [];
  }

  // Diff each tracked file
  const allChanges: ConfigChangeDetail[] = [];

  for (const relPath of TRACKED_FILES) {
    const oldContent = previousSnapshot.files[relPath];
    const newContent = currentConfigs[relPath];

    if (oldContent === undefined && newContent === undefined) continue;

    const fileChanges = deepDiff(oldContent, newContent, relPath);
    if (justification) {
      for (const change of fileChanges) {
        change.justification = justification;
      }
    }
    allChanges.push(...fileChanges);
  }

  // Log changes to audit trail
  if (allChanges.length > 0) {
    logConfigChange(clientContext, allChanges);
  }

  // Update snapshot
  saveSnapshot(clientContext, newSnapshot);

  return allChanges;
}

/**
 * Force capture a config snapshot without detecting changes.
 * Useful after initial setup or manual config edits.
 */
export function captureConfigSnapshot(
  clientContext: ClientContext,
): void {
  const currentConfigs = readCurrentConfigs(clientContext);
  saveSnapshot(clientContext, {
    capturedAt: new Date().toISOString(),
    files: currentConfigs,
  });
}
