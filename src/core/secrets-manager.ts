/** T-023/T-024/T-025: Multi-backend secrets manager with masking */
/** T-130: Secret key validation and sensitive var name detection */

export type SecretsBackend = "env" | "vault" | "aws-sm" | "azure-kv";

export interface SecretOptions {
  backends?: SecretsBackend[];
  maskInLogs?: boolean;
}

export interface ResolvedSecret {
  key: string;
  value: string;
  backend: SecretsBackend;
  masked: string;
}

// ── Key validation (T-130) ────────────────────────────────────────────────────

/** Allowed format for secret keys: uppercase letters, digits, underscores only */
const SECRET_KEY_PATTERN = /^[A-Z0-9_]{1,128}$/;

/**
 * Validate that a secret key follows the allowed naming convention.
 * Only uppercase alphanumeric + underscore, max 128 characters.
 * Throws if the key is invalid to prevent subtle resolution bugs.
 */
function validateSecretKey(key: string): void {
  if (!SECRET_KEY_PATTERN.test(key)) {
    throw new Error(
      `SecretsManager: invalid key format '${key.slice(0, 32)}'. ` +
        `Only uppercase letters, digits, and underscores are allowed (max 128 chars). ` +
        `Example: 'APP_API_KEY', 'DB_PASSWORD'`
    );
  }
}

/** Patterns in variable names that indicate the variable holds sensitive data */
const SECRET_VAR_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api_key/i,
  /apikey/i,
  /private_key/i,
  /credentials/i,
];

/**
 * Check whether an environment variable name suggests it holds a secret.
 * Useful for deciding whether to mask a value before logging.
 *
 * @param varName - The environment variable name to check
 * @returns true if the name matches a sensitive-data pattern
 */
export function isSecretEnvVar(varName: string): boolean {
  return SECRET_VAR_PATTERNS.some((p) => p.test(varName));
}

// ── Masking ───────────────────────────────────────────────────────────────────

/** Mask a secret value for safe logging — always call before printing */
export function maskSecret(value: string): string {
  if (!value) return "****";
  if (value.length <= 4) return "****";
  const visible = Math.min(2, Math.floor(value.length * 0.1));
  return (
    value.slice(0, visible) +
    "*".repeat(Math.min(value.length - visible * 2, 12)) +
    value.slice(-visible)
  );
}

/**
 * Scan an arbitrary text blob and redact common secret patterns in place.
 * Use on free-form text (error messages, log lines, query strings) where the
 * structure is unknown. For single values, prefer maskSecret().
 *
 * Covers: Bearer/Basic auth headers, Authorization header, password and token
 * in both URL (key=value) and colon (key: value) forms.
 */
export function maskSensitive(text: string): string {
  if (!text) return text;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{10,}/gi, "Bearer ***")
    .replace(/Basic\s+[A-Za-z0-9+/=]{10,}/gi, "Basic ***")
    .replace(/Authorization:\s*\S+/gi, "Authorization: ***")
    .replace(/password[=:]\s*[^&\s"']{4,}/gi, "password=***")
    .replace(/token[=:]\s*[A-Za-z0-9._\-+/=]{8,}/gi, "token=***");
}

// ── Backend implementations ───────────────────────────────────────────────────

/**
 * T-023: Env backend — resolves secrets from k6 __ENV (injected via -e or --env-file).
 * This is the primary backend for local dev and CI/CD environments.
 */
function resolveFromEnv(key: string): string | null {
  const value = __ENV[key];
  return value !== undefined && value !== "" ? value : null;
}

/**
 * T-024/T-025: Vault backend stub.
 * Full implementation requires Node.js HTTP calls in k6 setup() phase
 * or pre-fetching secrets into __ENV before k6 execution.
 * In Phase 1, Vault secrets should be pre-resolved into env vars by run-test.sh.
 */
function resolveFromVault(key: string): string | null {
  // Vault pre-resolution: run-test.sh fetches secrets and injects as K6_SECRET_<KEY>=<value>
  const envKey = `K6_SECRET_${key.toUpperCase().replace(/-/g, "_")}`;
  return resolveFromEnv(envKey);
}

/**
 * AWS Secrets Manager stub — same pre-resolution pattern as Vault.
 * aws-sm backend pre-fetches in run-test.sh before k6 execution.
 */
function resolveFromAwsSM(key: string): string | null {
  const envKey = `K6_SECRET_${key.toUpperCase().replace(/-/g, "_")}`;
  return resolveFromEnv(envKey);
}

/**
 * Azure Key Vault stub — same pre-resolution pattern.
 */
function resolveFromAzureKV(key: string): string | null {
  const envKey = `K6_SECRET_${key.toUpperCase().replace(/-/g, "_")}`;
  return resolveFromEnv(envKey);
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a secret by key from configured backends (priority order).
 * Backends tried in order until one returns a non-null value.
 * Throws with descriptive error if no backend resolves the key.
 */
export function resolveSecret(key: string, opts: SecretOptions = {}): string {
  validateSecretKey(key); // T-130: enforce key naming convention
  const backends = opts.backends ?? parseBackendsFromEnv();

  for (const backend of backends) {
    let value: string | null = null;

    switch (backend) {
      case "env":
        value = resolveFromEnv(key);
        break;
      case "vault":
        value = resolveFromVault(key);
        break;
      case "aws-sm":
        value = resolveFromAwsSM(key);
        break;
      case "azure-kv":
        value = resolveFromAzureKV(key);
        break;
    }

    if (value !== null) {
      return value;
    }
  }

  const backendsStr = backends.join(", ");
  throw new Error(
    `SecretsManager: key '${key}' not found in any backend [${backendsStr}]. ` +
      `Set it via: -e ${key}=<value> or K6_SECRET_${key.toUpperCase()}=<value>`
  );
}

/**
 * Resolve a secret and return full metadata including masked value for logging.
 */
export function resolveSecretWithMetadata(key: string, opts: SecretOptions = {}): ResolvedSecret {
  validateSecretKey(key); // T-130: enforce key naming convention
  const backends = opts.backends ?? parseBackendsFromEnv();

  for (const backend of backends) {
    let value: string | null = null;

    switch (backend) {
      case "env":
        value = resolveFromEnv(key);
        break;
      case "vault":
        value = resolveFromVault(key);
        break;
      case "aws-sm":
        value = resolveFromAwsSM(key);
        break;
      case "azure-kv":
        value = resolveFromAzureKV(key);
        break;
    }

    if (value !== null) {
      return { key, value, backend, masked: maskSecret(value) };
    }
  }

  throw new Error(`SecretsManager: key '${key}' not found in any backend`);
}

/**
 * Resolve a secret with a fallback value (for optional secrets).
 * Falls back silently without throwing.
 */
export function resolveSecretOr(key: string, fallback: string, opts: SecretOptions = {}): string {
  try {
    return resolveSecret(key, opts);
  } catch {
    return fallback;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBackendsFromEnv(): SecretsBackend[] {
  const raw = __ENV["K6_SECRETS_BACKENDS"] ?? "env";
  const parts = raw.split(",").map((s: string) => s.trim()) as SecretsBackend[];
  const valid: SecretsBackend[] = ["env", "vault", "aws-sm", "azure-kv"];
  return parts.filter((b) => valid.includes(b));
}
