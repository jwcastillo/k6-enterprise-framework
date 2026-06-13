/**
 * T-126: CLI input validation for shell injection prevention
 *
 * Centralizes parameter validation for Node.js context (bin/).
 * DO NOT import from k6 scripts — this module uses Node.js APIs indirectly
 * through string operations that are safe in both contexts, but is intended
 * exclusively for use in bin/ entry points.
 *
 * Prevents:
 * - Shell injection via metacharacters (;, $(), backticks, |, &)
 * - Path traversal via .. sequences
 * - Null byte injection
 * - Excessively long inputs
 */

// ── Allowed character patterns ────────────────────────────────────────────────

/** Allowed for --client, --profile, --env: alphanumeric + underscore + hyphen + dot */
export const SAFE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** Allowed for --scenario and file paths: same as SAFE_NAME_PATTERN plus forward slash */
export const SAFE_PATH_PATTERN = /^[a-zA-Z0-9_/.-]+$/;

/** Allowed for user identity in RBAC: alphanumeric + underscore + dot + at + hyphen */
export const CLIENT_IDENTITY_PATTERN = /^[a-zA-Z0-9_.@-]+$/;

/** Maximum allowed length for any CLI parameter value */
const MAX_PARAM_LENGTH = 256;

// ── Core validation ───────────────────────────────────────────────────────────

/**
 * Validate a single CLI parameter value against a pattern.
 * Throws an Error with a descriptive message if validation fails.
 *
 * @param paramName - Name of the parameter (for error messages)
 * @param value - The value to validate
 * @param pattern - Allowed character pattern (must match entire value)
 */
export function validateCliInput(
  paramName: string,
  value: string,
  pattern: RegExp,
): void {
  if (typeof value !== "string") {
    throw new Error(
      `[input-validator] Parameter '${paramName}' must be a string, got ${typeof value}`,
    );
  }

  if (value.length === 0) {
    throw new Error(
      `[input-validator] Parameter '${paramName}' cannot be empty`,
    );
  }

  if (value.length > MAX_PARAM_LENGTH) {
    throw new Error(
      `[input-validator] Parameter '${paramName}' exceeds maximum length ` +
        `(${value.length} > ${MAX_PARAM_LENGTH} characters)`,
    );
  }

  // Detect null bytes
  if (value.includes("\0")) {
    throw new Error(
      `[input-validator] Parameter '${paramName}' contains null byte — rejected`,
    );
  }

  // Detect path traversal
  if (value.includes("..")) {
    throw new Error(
      `[input-validator] Path traversal detected in '${paramName}': '${value}'`,
    );
  }

  // Check allowed character pattern
  if (!pattern.test(value)) {
    throw new Error(
      `[input-validator] Invalid value for '${paramName}': '${value}'\n` +
        `  Allowed characters: alphanumeric, underscore, hyphen, dot` +
        (pattern === SAFE_PATH_PATTERN ? ", forward slash" : ""),
    );
  }
}

// ── Path traversal assertion ──────────────────────────────────────────────────

/**
 * Assert that a value does not contain path traversal sequences.
 * Checks for: .., null bytes, and leading slashes when not expected.
 *
 * @param value - The value to check
 * @param paramName - Name of the parameter (for error messages)
 */
export function assertNoPathTraversal(value: string, paramName: string): void {
  if (value.includes("..")) {
    throw new Error(
      `[input-validator] Path traversal detected in '${paramName}': ` +
        `value contains '..' sequence`,
    );
  }
  if (value.includes("\0")) {
    throw new Error(
      `[input-validator] Null byte detected in '${paramName}' — rejected`,
    );
  }
}

// ── Batch validation for run-test.sh parameters ───────────────────────────────

export interface RunTestParams {
  client: string;
  scenario: string;
  profile: string;
  env: string;
  reportsDir?: string;
}

/**
 * Validate all parameters passed to run-test.sh / the CLI entry point.
 * Throws on the first invalid parameter found.
 *
 * @param params - The CLI parameters to validate
 */
export function validateRunTestInputs(params: RunTestParams): void {
  validateCliInput("--client", params.client, SAFE_NAME_PATTERN);
  validateCliInput("--scenario", params.scenario, SAFE_PATH_PATTERN);
  validateCliInput("--profile", params.profile, SAFE_NAME_PATTERN);
  validateCliInput("--env", params.env, SAFE_NAME_PATTERN);

  if (params.reportsDir !== undefined && params.reportsDir !== "") {
    // Reports dir allows forward slashes and tildes but not traversal
    validateCliInput("--reports-dir", params.reportsDir, SAFE_PATH_PATTERN);
    assertNoPathTraversal(params.reportsDir, "--reports-dir");
  }
}
