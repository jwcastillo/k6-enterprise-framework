/**
 * T-128: Safe YAML parser wrapper
 *
 * Node.js context only (bin/) — DO NOT import from k6 scripts.
 * Requires: npm install js-yaml
 *
 * Protections:
 * - Uses SAFE_SCHEMA to reject !!js/function, !!python/object, and other
 *   dangerous YAML tags that could execute code during parsing
 * - Enforces maximum file size (1 MB) to prevent DoS
 * - Detects billion laughs / anchor expansion attacks before parsing
 * - Enforces maximum nesting depth (10 levels) to limit memory usage
 *
 * The framework currently uses JSON for configuration. This module provides
 * a safe YAML parser for future use when YAML support is needed.
 */

 
const jsYaml = require("js-yaml") as typeof import("js-yaml");

// ── Safety limits ─────────────────────────────────────────────────────────────

/** Maximum allowed YAML file size in bytes (1 MB) */
const MAX_YAML_BYTES = 1_048_576;

/** Maximum allowed nesting depth of the parsed YAML structure */
const MAX_YAML_DEPTH = 10;

/** Threshold for billion laughs heuristic: anchors vs. aliases ratio */
const BILLION_LAUGHS_ANCHOR_THRESHOLD = 5;
const BILLION_LAUGHS_ALIAS_THRESHOLD = 50;

// ── Options ───────────────────────────────────────────────────────────────────

export interface SafeYamlOptions {
  /** Maximum YAML source size in bytes. Default: 1 MB */
  maxBytes?: number;
  /** Maximum nesting depth of parsed result. Default: 10 */
  maxDepth?: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Heuristic detection of billion laughs (anchor expansion) attacks.
 * If a YAML document defines many anchors and references many aliases,
 * it may expand exponentially in memory during parsing.
 *
 * @param raw - Raw YAML string to inspect
 * @returns true if the document matches the billion laughs heuristic
 */
function detectBillionLaughs(raw: string): boolean {
  const anchors = (raw.match(/&\w+/g) ?? []).length;
  const aliases = (raw.match(/\*\w+/g) ?? []).length;
  return anchors >= BILLION_LAUGHS_ANCHOR_THRESHOLD && aliases >= BILLION_LAUGHS_ALIAS_THRESHOLD;
}

/**
 * Recursively check the nesting depth of a parsed value.
 * Throws if the depth exceeds the allowed maximum.
 *
 * @param value - The value to check
 * @param current - Current depth (starts at 0)
 * @param max - Maximum allowed depth
 */
function checkDepth(value: unknown, current = 0, max = MAX_YAML_DEPTH): void {
  if (current > max) {
    throw new Error(
      `[yaml-parser] Nesting depth exceeds maximum (${max} levels). ` +
        `Found at least ${current} levels deep.`
    );
  }

  if (value !== null && typeof value === "object") {
    const children = Array.isArray(value)
      ? (value as unknown[])
      : Object.values(value as Record<string, unknown>);

    for (const child of children) {
      checkDepth(child, current + 1, max);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a YAML string safely.
 * Applies all safety checks: size limit, billion laughs detection,
 * SAFE_SCHEMA parsing, and depth validation.
 *
 * @param raw - Raw YAML string to parse
 * @param opts - Optional safety limit overrides
 * @returns Parsed object
 * @throws Error if any safety check fails
 */
export function parseYamlSafe(raw: string, opts: SafeYamlOptions = {}): Record<string, unknown> {
  const maxBytes = opts.maxBytes ?? MAX_YAML_BYTES;
  const maxDepth = opts.maxDepth ?? MAX_YAML_DEPTH;

  // 1. Size limit check
  const byteLength = Buffer.byteLength(raw, "utf-8");
  if (byteLength > maxBytes) {
    throw new Error(
      `[yaml-parser] YAML source exceeds size limit ` + `(${byteLength} bytes > ${maxBytes} bytes)`
    );
  }

  // 2. Billion laughs detection (before parsing to avoid the attack)
  if (detectBillionLaughs(raw)) {
    throw new Error(
      `[yaml-parser] Suspicious anchor expansion pattern detected. ` +
        `Document may be a billion laughs attack — parsing rejected.`
    );
  }

  // 3. Parse with CORE_SCHEMA (js-yaml v4) — rejects !!js/function, !!python/object,
  //    and all other non-standard YAML tags. In js-yaml v4, the default schema
  //    is already safe (SAFE_SCHEMA was renamed to CORE_SCHEMA in v4).
  let parsed: unknown;
  try {
    parsed = jsYaml.load(raw, {
      schema: jsYaml.CORE_SCHEMA,
    });
  } catch (err) {
    // T-177: Enrich YAML parse errors with line, column, and context snippet
    const yamlErr = err as {
      mark?: { line?: number; column?: number; name?: string };
      reason?: string;
      message?: string;
    };
    if (yamlErr.mark !== undefined) {
      const line = (yamlErr.mark.line ?? 0) + 1;
      const col = (yamlErr.mark.column ?? 0) + 1;
      const reason = yamlErr.reason ?? yamlErr.message ?? "parse error";
      // Extract context: the line where the error occurred
      const lines = raw.split("\n");
      const contextLine = lines[line - 1] ?? "";
      const pointer = " ".repeat(Math.max(0, col - 1)) + "^";
      throw new Error(
        `[yaml-parser] Syntax error at line ${line}, column ${col}: ${reason}.\n` +
          `  Context: ${contextLine.trim()}\n` +
          `           ${pointer}`
      );
    }
    throw new Error(`[yaml-parser] YAML parsing failed: ${(err as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `[yaml-parser] YAML must parse to an object (mapping), ` +
        `got: ${parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed}`
    );
  }

  // 4. Depth validation
  checkDepth(parsed, 0, maxDepth);

  return parsed as Record<string, unknown>;
}

/**
 * Parse a YAML file safely.
 * Reads the file, checks its size, then delegates to parseYamlSafe.
 *
 * @param filePath - Absolute path to the YAML file
 * @param opts - Optional safety limit overrides
 * @returns Parsed object
 * @throws Error if the file is too large or any safety check fails
 */
export function parseYamlFileSafe(
  filePath: string,
  opts: SafeYamlOptions = {}
): Record<string, unknown> {
   
  const fs = require("fs") as typeof import("fs");
  const maxBytes = opts.maxBytes ?? MAX_YAML_BYTES;

  let stat: import("fs").Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    throw new Error(`[yaml-parser] Cannot read file '${filePath}': ${(err as Error).message}`);
  }

  if (stat.size > maxBytes) {
    throw new Error(
      `[yaml-parser] YAML file exceeds size limit ` +
        `(${stat.size} bytes > ${maxBytes} bytes): ${filePath}`
    );
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  return parseYamlSafe(raw, opts);
}
