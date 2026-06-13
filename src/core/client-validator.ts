/** T-003: Contrato de extension entre capa generica y capa producto-especifica */

/** Required structure every client directory must satisfy */
export const CLIENT_REQUIRED_DIRS = [
  "config",
  "data",
  "lib/services",
  "lib/factories",
  "scenarios",
];

export const CLIENT_REQUIRED_FILES = [
  "config/default.json",
];

export interface ClientManifest {
  clientId: string;
  version: string;
  description?: string;
  maintainer?: string;
  /** Override default required paths (merged with base requirements) */
  additionalRequiredPaths?: string[];
  /** Custom check registrations: name -> description */
  customChecks?: Record<string, string>;
  /** Environment-specific config files available */
  environments?: string[];
}

export interface ValidationReport {
  clientId: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that a client's manifest is structurally correct.
 * This runs at execution start (setup phase) to catch misconfiguration early.
 * Runs in Node.js context (bin/run-test.sh) not in k6 runtime.
 */
export function validateClientManifest(manifest: unknown): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { clientId: "unknown", valid: false, errors: ["Manifest must be a JSON object"], warnings };
  }

  const m = manifest as Record<string, unknown>;
  const clientId = typeof m["clientId"] === "string" ? m["clientId"] : "unknown";

  if (!m["clientId"] || typeof m["clientId"] !== "string") {
    errors.push("clientId is required and must be a string");
  }

  if (!m["version"] || typeof m["version"] !== "string") {
    errors.push("version is required and must be a semver string");
  } else if (!/^\d+\.\d+\.\d+/.test(m["version"] as string)) {
    errors.push(`version '${m["version"]}' does not follow semver (x.y.z)`);
  }

  if (m["customChecks"] && typeof m["customChecks"] !== "object") {
    errors.push("customChecks must be an object mapping check names to descriptions");
  }

  if (!m["environments"]) {
    warnings.push("No environments specified — defaulting to ['default']");
  }

  return { clientId, valid: errors.length === 0, errors, warnings };
}

/**
 * Merge client-provided additional required paths with framework defaults.
 * The product-specific layer can extend requirements without modifying the generic layer.
 */
export function resolveRequiredPaths(manifest: ClientManifest): string[] {
  const base = [...CLIENT_REQUIRED_DIRS, ...CLIENT_REQUIRED_FILES];
  const additional = manifest.additionalRequiredPaths ?? [];
  return [...new Set([...base, ...additional])];
}

/**
 * Assertion that product-specific layer cannot bypass generic security controls.
 * Called by execution engine before running any scenario.
 */
export function assertSecurityBoundary(clientId: string, operation: string): void {
  const BLOCKED_OPERATIONS = [
    "override-secrets-manager",
    "bypass-masking",
    "modify-core-thresholds",
    "disable-structured-logs",
  ];

  if (BLOCKED_OPERATIONS.includes(operation)) {
    throw new Error(
      `Security boundary violation: client '${clientId}' attempted blocked operation '${operation}'`
    );
  }
}
