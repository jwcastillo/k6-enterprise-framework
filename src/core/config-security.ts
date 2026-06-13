/**
 * T-129/T-130: Configuration security utilities
 *
 * Node.js context only (bin/) — DO NOT import from k6 scripts.
 *
 * Provides:
 * - JSON config validation with size limits
 * - Shell value escaping
 * - Hardcoded secret detection
 * - Sensitive field redaction for safe logging
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CONFIG_BYTES = 512_000; // 512 KB

/** Key name patterns that typically indicate a secret value */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api_key/i,
  /apikey/i,
  /private_key/i,
  /credentials/i,
  /auth/i,
  /credential/i,
];

/** Value patterns that look like known secret formats */
const SECRET_VALUE_PATTERNS = [
  /^eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/, // JWT
  /^AKIA[0-9A-Z]{16}$/,                                        // AWS Access Key
  /^ghp_[A-Za-z0-9]{36}$/,                                     // GitHub PAT
  /^ghs_[A-Za-z0-9]{36}$/,                                     // GitHub App token
  /^sk-[A-Za-z0-9]{20,}$/,                                     // OpenAI / Stripe key
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,                     // PEM private key
  /^xox[baprs]-[0-9A-Za-z\-]{10,}$/,                           // Slack token
  /^[A-Za-z0-9+/]{40,}={0,2}$/,                                // Base64 blob (40+ chars)
];

/** Minimum length to flag a literal value as potentially sensitive */
const MIN_SECRET_LENGTH = 16;

// ── JSON config validation ────────────────────────────────────────────────────

/**
 * Parse and validate a JSON config string.
 * Enforces a maximum byte size to prevent DoS via large configs.
 *
 * @param raw - Raw JSON string to validate
 * @param maxBytes - Maximum allowed size in bytes (default: 512 KB)
 * @returns Parsed config object
 * @throws Error if the JSON is invalid or exceeds size limit
 */
export function validateConfigJson(
  raw: string,
  maxBytes: number = DEFAULT_MAX_CONFIG_BYTES,
): Record<string, unknown> {
  const byteLength = Buffer.byteLength(raw, "utf-8");
  if (byteLength > maxBytes) {
    throw new Error(
      `[config-security] Config exceeds maximum size limit ` +
        `(${byteLength} bytes > ${maxBytes} bytes)`,
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Config must be a JSON object (not an array or primitive)");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `[config-security] Invalid JSON config: ${(err as Error).message}`,
    );
  }
}

// ── Shell value escaping ──────────────────────────────────────────────────────

/**
 * Escape a value for safe inclusion in shell single-quoted strings.
 * Single-quoted strings in bash are literal except for single quotes themselves.
 * This function escapes any single quote by ending the quote, adding an escaped
 * single quote, and reopening the quote.
 *
 * Use as: echo '${escapeShellValue(value)}'
 *
 * @param value - The value to escape
 * @returns Shell-safe escaped value (for use inside single quotes)
 */
export function escapeShellValue(value: string): string {
  // Replace ' with '\''
  return value.replace(/'/g, "'\\''");
}

// ── Hardcoded secret detection ────────────────────────────────────────────────

/**
 * Heuristically determine whether a string value looks like a hardcoded secret.
 * Uses known prefix patterns and entropy heuristics.
 *
 * @param value - The string value to inspect
 * @returns true if the value appears to be a hardcoded secret
 */
export function looksLikeHardcodedSecret(value: string): boolean {
  if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) {
    return false;
  }

  // Skip obvious placeholders
  const lower = value.toLowerCase();
  const PLACEHOLDER_MARKERS = [
    "${", "{{", "<", "your-", "replace-", "example", "placeholder",
    "todo", "fixme", "changeme", "xxx", "yyy", "zzz",
  ];
  if (PLACEHOLDER_MARKERS.some((m) => lower.includes(m))) {
    return false;
  }

  // Check against known secret patterns
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether an environment variable name indicates it holds a secret.
 *
 * @param varName - The environment variable name to check
 * @returns true if the name suggests the variable holds sensitive data
 */
export function isSecretEnvVar(varName: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(varName));
}

// ── Config audit for secrets ──────────────────────────────────────────────────

export interface SecretFinding {
  path: string;
  reason: string;
}

/**
 * Recursively audit a config object for hardcoded secrets.
 * Returns a list of findings with JSON-path location and reason.
 *
 * @param config - The config object to audit
 * @param basePath - JSON path prefix for nested calls (default: "")
 * @returns Array of findings; empty array means no secrets detected
 */
export function auditConfigForSecrets(
  config: Record<string, unknown>,
  basePath = "",
): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const [key, value] of Object.entries(config)) {
    const currentPath = basePath ? `${basePath}.${key}` : key;

    if (typeof value === "string") {
      // Flag if the key name suggests a secret AND the value looks hardcoded
      const keySuggectsSecret = SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
      const valueLooksLiteral = looksLikeHardcodedSecret(value);

      if (keySuggectsSecret && value.length >= MIN_SECRET_LENGTH && !value.startsWith("${")) {
        findings.push({
          path: currentPath,
          reason: `Key '${key}' suggests sensitive data with a literal value (not a variable reference)`,
        });
      } else if (valueLooksLiteral) {
        findings.push({
          path: currentPath,
          reason: `Value at '${currentPath}' matches a known secret pattern`,
        });
      }
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Recurse into nested objects
      findings.push(
        ...auditConfigForSecrets(value as Record<string, unknown>, currentPath),
      );
    }
  }

  return findings;
}

// ── Sensitive field redaction ─────────────────────────────────────────────────

/** Redaction placeholder used in place of sensitive values */
const REDACTED = "****";

/**
 * Recursively redact sensitive fields from an object for safe logging.
 * Fields whose keys match SENSITIVE_KEY_PATTERNS have their values replaced
 * with "****". Does not mutate the original object.
 *
 * @param obj - The object to redact
 * @returns A new object with sensitive values replaced
 */
export function redactSensitiveFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));

    if (isSensitive) {
      result[key] = REDACTED;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}
