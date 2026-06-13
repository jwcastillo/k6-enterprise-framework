/**
 * T-155: Configuration validation engine with JSON Schema
 *
 * Node.js context only (bin/) — DO NOT import from k6 scripts.
 * Requires: ajv, ajv-formats, js-yaml (already in devDependencies)
 *
 * Validates client and test configuration against a JSON Schema.
 * Supports:
 * - Auto-detection of JSON vs YAML format
 * - Environment variable resolution (${VAR} syntax)
 * - Bidirectional lossless JSON <-> YAML conversion
 * - Descriptive errors with JSON path, expected, and actual values
 * - Programmatic API: ConfigValidator.validate(config)
 */

const Ajv = require("ajv") as typeof import("ajv").default;

const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

const jsYaml = require("js-yaml") as typeof import("js-yaml");

import { parseYamlSafe } from "./yaml-parser";

// ── Schema ────────────────────────────────────────────────────────────────────

const EXECUTORS = [
  "constant-vus",
  "ramping-vus",
  "constant-arrival-rate",
  "ramping-arrival-rate",
  "per-vu-iterations",
  "shared-iterations",
  "externally-controlled",
] as const;

const DURATION_REGEX = "^[0-9]+(ms|s|m|h)$";
const AUTH_TYPES = ["none", "bearer", "basic", "api-key"] as const;

/** JSON Schema for a k6 framework test/client configuration */
export const CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "k6 Enterprise Framework — Client Configuration",
  type: "object",
  additionalProperties: false,
  required: ["client"],
  properties: {
    client: {
      type: "string",
      pattern: "^[a-zA-Z0-9_-]+$",
      description: "Client identifier (matches clients/<client>/ directory)",
    },
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
      description: "Semantic version of the client config",
    },
    description: { type: "string" },
    environment: {
      type: "string",
      enum: ["default", "staging", "production"],
    },
    baseUrl: {
      type: "string",
      format: "uri",
      description: "Base URL of the service under test",
    },
    endpoints: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["baseUrl"],
        properties: {
          baseUrl: { type: "string", format: "uri" },
          timeout: { type: "string", pattern: DURATION_REGEX },
        },
        additionalProperties: true,
      },
    },
    thresholds: {
      type: "object",
      description: "k6 threshold definitions (metric name → array of condition strings)",
      additionalProperties: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
    },
    scenarios: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["executor"],
        properties: {
          executor: { type: "string", enum: EXECUTORS as unknown as string[] },
          vus: { type: "integer", minimum: 1 },
          duration: { type: "string", pattern: DURATION_REGEX },
          iterations: { type: "integer", minimum: 1 },
          rate: { type: "number", exclusiveMinimum: 0 },
          timeUnit: { type: "string", pattern: DURATION_REGEX },
          startVUs: { type: "integer", minimum: 0 },
          stages: {
            type: "array",
            items: {
              type: "object",
              required: ["duration"],
              properties: {
                duration: { type: "string", pattern: DURATION_REGEX },
                target: { type: "integer", minimum: 0 },
              },
              additionalProperties: true,
            },
          },
          maxDuration: { type: "string", pattern: DURATION_REGEX },
          gracefulStop: { type: "string", pattern: DURATION_REGEX },
          gracefulRampDown: { type: "string", pattern: DURATION_REGEX },
          env: { type: "object", additionalProperties: { type: "string" } },
          tags: { type: "object", additionalProperties: { type: "string" } },
          exec: { type: "string" },
          startTime: { type: "string" },
        },
        additionalProperties: true,
      },
    },
    auth: {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string", enum: AUTH_TYPES as unknown as string[] },
        tokenEnvVar: { type: "string" },
        usernameEnvVar: { type: "string" },
        passwordEnvVar: { type: "string" },
        headerEnvVar: { type: "string" },
        headerName: { type: "string" },
      },
      additionalProperties: true,
    },
    retries: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        maxRetries: { type: "integer", minimum: 0, maximum: 10 },
        retryOn: { type: "array", items: { type: "integer" } },
        backoffMs: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    browser: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        type: { type: "string", enum: ["chromium"] },
        headless: { type: "boolean" },
      },
      additionalProperties: true,
    },
    tags: {
      type: "object",
      additionalProperties: { type: "string" },
    },
  },
};

/** A single config-validation error with JSON path context */
export interface ConfigValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: unknown;
}

/** Result of ConfigValidator.validate() */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  missingVars?: string[];
}

/** @deprecated renamed to ConfigValidationError — collided with types/ai.d.ts::ValidationError. */
export type ValidationError = ConfigValidationError;
/** @deprecated renamed to ConfigValidationResult — collided with two other ValidationResult shapes. */
export type ValidationResult = ConfigValidationResult;

// ── AJV instance (singleton) ──────────────────────────────────────────────────

let _ajv: InstanceType<typeof Ajv> | null = null;

function getAjv(): InstanceType<typeof Ajv> {
  if (!_ajv) {
    _ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(_ajv);
  }
  return _ajv;
}

// ── Environment variable resolution ───────────────────────────────────────────

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Walk a parsed config object and resolve `${VAR}` references.
 * Returns list of missing variable names (does not throw).
 */
function resolveEnvVars(obj: unknown, missing: Set<string> = new Set()): unknown {
  if (typeof obj === "string") {
    return obj.replace(ENV_VAR_PATTERN, (_, name) => {
      const val = process.env[name];
      if (val === undefined) {
        missing.add(name);
        return `\${${name}}`; // preserve original for error reporting
      }
      return val;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item, missing));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvVars(value, missing);
    }
    return result;
  }
  return obj;
}

// ── Format helpers ────────────────────────────────────────────────────────────

/**
 * Convert an AJV error into a human-readable ConfigValidationError with path + expected/actual.
 */
function formatAjvError(
  err: NonNullable<InstanceType<typeof Ajv>["errors"]>[number]
): ConfigValidationError {
  const path = err.instancePath || "/";

  if (err.keyword === "enum") {
    const allowed = (err.params as { allowedValues: unknown[] }).allowedValues;
    return {
      path,
      message: `"${path}": expected one of [${allowed.join(", ")}], got "${err.data}"`,
      expected: allowed.join(" | "),
      actual: err.data,
    };
  }

  if (err.keyword === "format") {
    return {
      path,
      message: `"${path}": expected format "${(err.params as { format: string }).format}", got "${err.data}"`,
      expected: (err.params as { format: string }).format,
      actual: err.data,
    };
  }

  if (err.keyword === "pattern") {
    return {
      path,
      message: `"${path}": value "${err.data}" does not match pattern ${(err.params as { pattern: string }).pattern}`,
      expected: (err.params as { pattern: string }).pattern,
      actual: err.data,
    };
  }

  if (err.keyword === "required") {
    const missing = (err.params as { missingProperty: string }).missingProperty;
    return {
      path: `${path}/${missing}`,
      message: `"${path}/${missing}": required field is missing`,
    };
  }

  if (err.keyword === "type") {
    return {
      path,
      message: `"${path}": expected type "${(err.params as { type: string }).type}", got "${typeof err.data}"`,
      expected: (err.params as { type: string }).type,
      actual: typeof err.data,
    };
  }

  if (err.keyword === "additionalProperties") {
    const extra = (err.params as { additionalProperty: string }).additionalProperty;
    return {
      path: `${path}/${extra}`,
      message: `"${path}/${extra}": unexpected additional property`,
    };
  }

  return {
    path,
    message: `"${path}": ${err.message ?? "validation failed"}`,
    actual: err.data,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ConfigValidator {
  private _ajvValidate = getAjv().compile(CONFIG_SCHEMA);

  /**
   * Validate a config object (already parsed from JSON or YAML).
   * Resolves ${VAR} references before validation.
   * Reports all missing env vars in one pass.
   */
  validate(config: Record<string, unknown>): ConfigValidationResult {
    const missingVars = new Set<string>();
    const resolved = resolveEnvVars(config, missingVars) as Record<string, unknown>;

    if (missingVars.size > 0) {
      return {
        valid: false,
        errors: [
          {
            path: "/",
            message: `Missing environment variables: ${[...missingVars].join(", ")}`,
          },
        ],
        missingVars: [...missingVars],
      };
    }

    const ok = this._ajvValidate(resolved);
    if (ok) {
      return { valid: true, errors: [] };
    }

    const errors = (this._ajvValidate.errors ?? []).map(formatAjvError);
    return { valid: false, errors };
  }

  /**
   * Validate a raw JSON or YAML string.
   * Auto-detects format, parses, then validates.
   */
  validateString(raw: string, hint?: "json" | "yaml"): ConfigValidationResult {
    let parsed: Record<string, unknown>;
    const format = hint ?? detectFormat(raw);

    try {
      parsed = format === "yaml" ? parseYamlSafe(raw) : JSON.parse(raw);
    } catch (err) {
      return {
        valid: false,
        errors: [{ path: "/", message: `Parse error (${format}): ${(err as Error).message}` }],
      };
    }

    return this.validate(parsed);
  }

  /**
   * Validate a config file at the given path.
   * Auto-detects JSON vs YAML by content.
   */
  validateFile(filePath: string): ConfigValidationResult {
    const fs = require("fs") as typeof import("fs");
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      return {
        valid: false,
        errors: [
          { path: "/", message: `Cannot read file '${filePath}': ${(err as Error).message}` },
        ],
      };
    }
    return this.validateString(raw);
  }
}

// ── Format detection ──────────────────────────────────────────────────────────

/**
 * Detect whether raw content is JSON or YAML by inspecting the first non-whitespace char.
 * Detects by content, not file extension (as per T-144/T-155 requirements).
 */
export function detectFormat(raw: string): "json" | "yaml" {
  const trimmed = raw.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "yaml";
}

// ── Conversion ────────────────────────────────────────────────────────────────

/**
 * Convert JSON string to YAML string (lossless roundtrip).
 */
export function jsonToYaml(jsonStr: string): string {
  const obj = JSON.parse(jsonStr);
  return jsYaml.dump(obj, { indent: 2, lineWidth: 120, noRefs: true });
}

/**
 * Convert YAML string to JSON string (lossless roundtrip).
 */
export function yamlToJson(yamlStr: string, pretty = true): string {
  const obj = parseYamlSafe(yamlStr);
  return JSON.stringify(obj, null, pretty ? 2 : 0);
}

// ── Example generator ─────────────────────────────────────────────────────────

/**
 * Generate a valid example configuration object with comments in YAML format.
 */
export function generateExampleConfig(format: "json" | "yaml" = "yaml"): string {
  const example: Record<string, unknown> = {
    client: "my-team",
    version: "1.0.0",
    description: "Example k6 Enterprise Framework configuration",
    environment: "staging",
    baseUrl: "https://api.example.com",
    endpoints: {
      api: { baseUrl: "https://api.example.com", timeout: "30s" },
      auth: { baseUrl: "https://auth.example.com", timeout: "10s" },
    },
    auth: {
      type: "bearer",
      tokenEnvVar: "APP_API_TOKEN",
    },
    thresholds: {
      http_req_duration: ["p(95)<500", "p(99)<1000"],
      http_req_failed: ["rate<0.01"],
      checks: ["rate>0.99"],
    },
    scenarios: {
      default: {
        executor: "ramping-vus",
        startVUs: 0,
        stages: [
          { duration: "1m", target: 10 },
          { duration: "3m", target: 10 },
          { duration: "1m", target: 0 },
        ],
        gracefulRampDown: "30s",
      },
    },
    retries: {
      enabled: true,
      maxRetries: 3,
      retryOn: [429, 503],
      backoffMs: 500,
    },
    tags: {
      team: "platform",
      service: "user-api",
    },
  };

  if (format === "json") {
    return JSON.stringify(example, null, 2);
  }

  // YAML with header comment
  const yaml = jsYaml.dump(example, { indent: 2, lineWidth: 120, noRefs: true });
  return [
    "# k6 Enterprise Framework — Example Configuration",
    "# Run: node bin/validate-config.js --file=config.yml",
    "# Docs: docs/configuration.md",
    "#",
    "# Environment variables (${VAR}) are resolved at validation/run time.",
    "# Never store actual secrets here — use .env or your secrets manager.",
    "",
    yaml,
  ].join("\n");
}
