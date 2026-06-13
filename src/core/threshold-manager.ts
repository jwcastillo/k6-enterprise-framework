/**
 * T-033: Per-client threshold customization
 *
 * Implements 4-level threshold hierarchy:
 *   1. Core profile defaults (shared/profiles/*.json)
 *   2. Client global overrides (clients/{name}/config/thresholds.json → global)
 *   3. Client per-service or per-profile overrides (→ services.{name} or profiles.{name})
 *   4. CLI overrides (--threshold flag)
 *
 * Each level merges on top of the previous (later wins).
 *
 * Note: This module runs in Node.js context (bin/run-test.sh) for loading config
 * files, but mergeThresholdHierarchy() can also be called from k6 runtime using
 * pre-injected __ENV values.
 */

import { ThresholdOverrideConfig } from "../types/client.d";
import { ClientContext } from "../types/client.d";
import { ProfileName } from "../types/profile.d";
import { loadProfile } from "./profile-loader";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");

// ── Config loading (Node.js context) ──────────────────────────────────────────

/**
 * Load client-specific threshold overrides from thresholds.json.
 * Returns null if the file doesn't exist (uses profile defaults).
 */
export function loadThresholdOverrides(
  clientContext: ClientContext,
): ThresholdOverrideConfig | null {
  const thresholdPath = path.join(clientContext.configDir, "thresholds.json");

  if (!fs.existsSync(thresholdPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(thresholdPath, "utf-8");
    const config = JSON.parse(content) as ThresholdOverrideConfig;
    validateThresholdOverrides(config);
    return config;
  } catch (err) {
    if ((err as Error).message.startsWith("ThresholdManager:")) throw err;
    throw new Error(
      `ThresholdManager: failed to parse thresholds.json: ${(err as Error).message}`,
    );
  }
}

/**
 * Validate threshold override values.
 * Rejects obviously invalid values (empty arrays, non-string conditions).
 */
function validateThresholdOverrides(config: ThresholdOverrideConfig): void {
  const validateMap = (
    map: Record<string, string[]> | undefined,
    context: string,
  ): void => {
    if (!map) return;
    for (const [metric, conditions] of Object.entries(map)) {
      if (!Array.isArray(conditions)) {
        throw new Error(
          `ThresholdManager: ${context}.${metric} must be an array of threshold conditions.`,
        );
      }
      for (const cond of conditions) {
        if (typeof cond !== "string" || cond.trim() === "") {
          throw new Error(
            `ThresholdManager: ${context}.${metric} contains invalid condition: '${cond}'.`,
          );
        }
      }
    }
  };

  // Validate global
  validateMap(config.global, "global");

  // Validate services
  if (config.services) {
    for (const [svc, metrics] of Object.entries(config.services)) {
      validateMap(metrics, `services.${svc}`);
    }
  }

  // Validate profiles
  if (config.profiles) {
    for (const [prof, metrics] of Object.entries(config.profiles)) {
      validateMap(metrics, `profiles.${prof}`);
    }
  }
}

// ── Threshold hierarchy merge ─────────────────────────────────────────────────

/**
 * Merge thresholds following the 4-level hierarchy.
 *
 * @param profileName - Active load profile
 * @param serviceName - Service being tested (for per-service overrides)
 * @param clientOverrides - Client's threshold config (from thresholds.json)
 * @param cliOverrides - CLI-level overrides (highest priority)
 * @returns Final merged threshold map
 */
export function mergeThresholdHierarchy(
  profileName: ProfileName,
  serviceName: string | undefined,
  clientOverrides: ThresholdOverrideConfig | null,
  cliOverrides: Record<string, string[]> = {},
): Record<string, string[]> {
  // Level 1: Core profile defaults
  const profile = loadProfile(profileName);
  let merged: Record<string, string[]> = { ...profile.thresholds };

  if (clientOverrides) {
    // Level 2: Client global overrides
    if (clientOverrides.global) {
      merged = { ...merged, ...clientOverrides.global };
    }

    // Level 3a: Client per-profile overrides
    if (clientOverrides.profiles?.[profileName]) {
      merged = { ...merged, ...clientOverrides.profiles[profileName] };
    }

    // Level 3b: Client per-service overrides
    if (serviceName && clientOverrides.services?.[serviceName]) {
      merged = { ...merged, ...clientOverrides.services[serviceName] };
    }
  }

  // Level 4: CLI overrides (highest priority)
  if (Object.keys(cliOverrides).length > 0) {
    merged = { ...merged, ...cliOverrides };
  }

  return merged;
}

/**
 * Build the full threshold hierarchy for a client execution.
 * Convenience function that loads config and merges all levels.
 *
 * @param clientContext - Resolved client context
 * @param profileName - Active load profile
 * @param serviceName - Service being tested
 * @param cliOverrides - CLI-level overrides
 * @returns Final merged threshold map
 */
export function buildClientThresholds(
  clientContext: ClientContext,
  profileName: ProfileName,
  serviceName?: string,
  cliOverrides: Record<string, string[]> = {},
): Record<string, string[]> {
  const overrides = loadThresholdOverrides(clientContext);
  return mergeThresholdHierarchy(
    profileName,
    serviceName,
    overrides,
    cliOverrides,
  );
}

/**
 * Compute a diff between two threshold maps.
 * Used for audit logging of threshold changes.
 *
 * @returns Array of changes: { metric, oldConditions, newConditions }
 */
export function diffThresholds(
  oldThresholds: Record<string, string[]>,
  newThresholds: Record<string, string[]>,
): Array<{ metric: string; oldConditions: string[]; newConditions: string[] }> {
  const changes: Array<{
    metric: string;
    oldConditions: string[];
    newConditions: string[];
  }> = [];
  const allMetrics = new Set([
    ...Object.keys(oldThresholds),
    ...Object.keys(newThresholds),
  ]);

  for (const metric of allMetrics) {
    const oldConds = oldThresholds[metric] ?? [];
    const newConds = newThresholds[metric] ?? [];

    if (JSON.stringify(oldConds) !== JSON.stringify(newConds)) {
      changes.push({ metric, oldConditions: oldConds, newConditions: newConds });
    }
  }

  return changes;
}
