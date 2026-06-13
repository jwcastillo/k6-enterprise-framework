/**
 * T-138: Custom load profile validation
 *
 * Node.js context only (bin/) — DO NOT import from k6 scripts.
 *
 * Validates client-provided custom profiles before they are applied.
 * Custom profiles extend the built-in 13 profiles but must:
 * - Contain only declarative data (stages + thresholds)
 * - Not include executable fields (executor, env, systemTags, etc.)
 * - Respect VU limits per role (developer: 50, lead: 500)
 * - Not exceed 4 hours total duration
 * - Not override framework security configuration
 */

// ── Types ─────────────────────────────────────────────────────────────────────

import type { StageDefinition } from "../types/profile.d";
export type { StageDefinition };

export interface CustomProfileDefinition {
  name: string;
  description?: string;
  stages: StageDefinition[];
  thresholds?: Record<string, string[]>;
}

// ── Limits ────────────────────────────────────────────────────────────────────

/** Maximum total profile duration (4 hours) */
const MAX_PROFILE_DURATION_MS = 4 * 60 * 60 * 1000;

/** Maximum VUs per role */
export const MAX_CUSTOM_VUS_DEVELOPER = 50;
export const MAX_CUSTOM_VUS_LEAD = 500;

// ── Forbidden fields ──────────────────────────────────────────────────────────

/**
 * Fields that are NOT allowed in custom profiles.
 * These could override framework security settings or inject executable code.
 */
const FORBIDDEN_FIELDS = new Set([
  "executor",
  "gracefulStop",
  "gracefulRampDown",
  "env",
  "systemTags",
  "tags",
  "exec",
  "startTime",
  "maxDuration",
  "noConnectionReuse",
  "userAgent",
  "discardResponseBodies",
  // Security override attempts
  "disableSecretMasking",
  "disableRbac",
  "disableAudit",
  "skipValidation",
]);

// ── Duration parsing ──────────────────────────────────────────────────────────

/** Pattern for k6 duration strings: number + unit */
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/;

function parseDurationMs(d: string): number {
  const match = DURATION_PATTERN.exec(d);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  switch (match[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1_000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      return 0;
  }
}

// ── Threshold condition validation ────────────────────────────────────────────

/**
 * Validate a threshold condition string.
 * Accepts formats like: p(95)<2000, rate<0.05, count>100, value<=500
 */
const THRESHOLD_CONDITION_PATTERN = /^[a-zA-Z_()0-9]+[<>=!]{1,2}[\d.]+$/;

function validateThresholdCondition(condition: string, path: string): void {
  if (typeof condition !== "string") {
    throw new Error(`[profile-validator] ${path}: threshold condition must be a string`);
  }
  if (!THRESHOLD_CONDITION_PATTERN.test(condition)) {
    throw new Error(
      `[profile-validator] ${path}: invalid threshold condition '${condition}'. ` +
        `Expected format: 'p(95)<2000', 'rate<0.05', 'count>100'`
    );
  }
}

// ── Main validation ───────────────────────────────────────────────────────────

/**
 * Validate a custom load profile object.
 * Returns the typed profile if valid, throws on any violation.
 *
 * @param profile - Unknown input to validate
 * @param maxVus - Maximum allowed VUs for the caller's role
 * @returns The validated profile as CustomProfileDefinition
 * @throws Error if any validation rule is violated
 */
export function validateCustomProfile(
  profile: unknown,
  maxVus: number = MAX_CUSTOM_VUS_DEVELOPER
): CustomProfileDefinition {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("[profile-validator] Profile must be a JSON object");
  }

  const p = profile as Record<string, unknown>;

  // ── Required fields ──────────────────────────────────────────────────────

  if (typeof p["name"] !== "string" || !p["name"].trim()) {
    throw new Error("[profile-validator] Field 'name' is required (non-empty string)");
  }

  if (typeof p["description"] !== "undefined" && typeof p["description"] !== "string") {
    throw new Error("[profile-validator] Field 'description' must be a string if provided");
  }

  if (!Array.isArray(p["stages"]) || p["stages"].length === 0) {
    throw new Error("[profile-validator] Field 'stages' is required (non-empty array)");
  }

  // ── Forbidden fields ─────────────────────────────────────────────────────

  for (const key of Object.keys(p)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      throw new Error(
        `[profile-validator] Field '${key}' is not allowed in custom profiles. ` +
          `Custom profiles must only contain: name, description, stages, thresholds`
      );
    }
  }

  // ── Stages validation ────────────────────────────────────────────────────

  let totalDurationMs = 0;

  for (let i = 0; i < (p["stages"] as unknown[]).length; i++) {
    const stage = (p["stages"] as unknown[])[i];
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw new Error(`[profile-validator] stages[${i}] must be an object`);
    }

    const s = stage as Record<string, unknown>;

    // duration
    if (typeof s["duration"] !== "string") {
      throw new Error(`[profile-validator] stages[${i}].duration must be a string`);
    }
    if (!DURATION_PATTERN.test(s["duration"])) {
      throw new Error(
        `[profile-validator] stages[${i}].duration '${s["duration"]}' is invalid. ` +
          `Format: '30s', '5m', '1h30m' — supported units: ms, s, m, h`
      );
    }

    // target
    if (typeof s["target"] !== "number" || !Number.isInteger(s["target"]) || s["target"] < 0) {
      throw new Error(`[profile-validator] stages[${i}].target must be a non-negative integer`);
    }
    if (s["target"] > maxVus) {
      throw new Error(
        `[profile-validator] stages[${i}].target (${s["target"]} VUs) exceeds the ` +
          `maximum allowed for your role (${maxVus} VUs). ` +
          `Contact an admin or lead to run higher-VU profiles.`
      );
    }

    // No extra fields in stages
    const allowedStageFields = new Set(["duration", "target"]);
    for (const key of Object.keys(s)) {
      if (!allowedStageFields.has(key)) {
        throw new Error(
          `[profile-validator] stages[${i}]: unexpected field '${key}'. ` +
            `Allowed fields: duration, target`
        );
      }
    }

    totalDurationMs += parseDurationMs(s["duration"] as string);
  }

  // ── Total duration limit ─────────────────────────────────────────────────

  if (totalDurationMs > MAX_PROFILE_DURATION_MS) {
    const totalMin = Math.round(totalDurationMs / 60_000);
    const maxMin = MAX_PROFILE_DURATION_MS / 60_000;
    throw new Error(
      `[profile-validator] Total profile duration (${totalMin} min) exceeds ` +
        `the maximum allowed (${maxMin} min = 4 hours)`
    );
  }

  // ── Thresholds validation ────────────────────────────────────────────────

  if (p["thresholds"] !== undefined) {
    if (
      typeof p["thresholds"] !== "object" ||
      p["thresholds"] === null ||
      Array.isArray(p["thresholds"])
    ) {
      throw new Error("[profile-validator] Field 'thresholds' must be an object if provided");
    }

    const thresholds = p["thresholds"] as Record<string, unknown>;
    for (const [metric, conditions] of Object.entries(thresholds)) {
      if (!Array.isArray(conditions)) {
        throw new Error(
          `[profile-validator] thresholds.${metric} must be an array of condition strings`
        );
      }
      for (let j = 0; j < conditions.length; j++) {
        validateThresholdCondition(conditions[j], `thresholds.${metric}[${j}]`);
      }
    }
  }

  return {
    name: (p["name"] as string).trim(),
    description: p["description"] as string | undefined,
    stages: p["stages"] as StageDefinition[],
    thresholds: p["thresholds"] as Record<string, string[]> | undefined,
  };
}
