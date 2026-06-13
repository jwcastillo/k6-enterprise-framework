/**
 * T-137: k6 binary and jslib import validation
 *
 * Node.js context only (bin/) — DO NOT import from k6 scripts.
 *
 * Protections:
 * - K6_BINARY_PATH is validated against a whitelist of trusted directories
 * - Custom binary paths must be executable and respond to `k6 version`
 * - jslib import URLs must resolve to trusted domains only
 */

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");
const { execSync } = require("child_process") as typeof import("child_process");

// ── Trusted binary paths ──────────────────────────────────────────────────────

/**
 * Resolve the list of trusted directories where a k6 binary may reside.
 * Defaults: /usr/local/bin, /usr/bin, /opt/k6, ~/.local/bin
 * Extensible via K6_BINARY_ALLOWED_PATHS (colon-separated).
 */
function getAllowedBinaryPaths(): string[] {
  const home = process.env["HOME"] ?? "";

  const defaults = [
    "/usr/local/bin",
    "/usr/bin",
    "/opt/k6",
    "/opt/homebrew/bin",
    home ? path.join(home, ".local", "bin") : "",
  ].filter(Boolean);

  const extra = process.env["K6_BINARY_ALLOWED_PATHS"]
    ? process.env["K6_BINARY_ALLOWED_PATHS"]
        .split(":")
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  return [...defaults, ...extra];
}

// ── Binary validation ─────────────────────────────────────────────────────────

/**
 * Validate a custom k6 binary path.
 * Checks:
 * 1. The resolved (real) path is inside an allowed directory
 * 2. The file is executable
 * 3. The binary identifies itself as k6 via `k6 version`
 *
 * @param binaryPath - Path to the k6 binary to validate
 * @throws Error if any check fails
 */
export function validateK6Binary(binaryPath: string): void {
  // Resolve symlinks to get the real path
  let resolved: string;
  try {
    resolved = fs.realpathSync(binaryPath);
  } catch (err) {
    throw new Error(
      `[binary-validator] Cannot resolve binary path '${binaryPath}': ` +
        `${(err as Error).message}`,
    );
  }

  const allowedPaths = getAllowedBinaryPaths();
  const inAllowedPath = allowedPaths.some(
    (allowed) =>
      resolved === allowed ||
      resolved.startsWith(allowed + path.sep),
  );

  if (!inAllowedPath) {
    throw new Error(
      `[binary-validator] k6 binary at '${path.basename(binaryPath)}' ` +
        `is not in a trusted directory. ` +
        `Allowed paths: ${allowedPaths.join(", ")}. ` +
        `Override via K6_BINARY_ALLOWED_PATHS (colon-separated).`,
    );
  }

  // Check the file is executable
  try {
    fs.accessSync(resolved, fs.constants.X_OK);
  } catch {
    throw new Error(
      `[binary-validator] Binary '${path.basename(binaryPath)}' is not executable.`,
    );
  }

  // Verify it responds to `k6 version` and identifies as k6
  try {
    const output = execSync(`"${resolved}" version 2>&1`, {
      timeout: 5_000,
      encoding: "utf-8",
    });
    if (!output.toLowerCase().includes("k6")) {
      throw new Error("Binary output does not contain 'k6'");
    }
  } catch (err) {
    throw new Error(
      `[binary-validator] Binary '${path.basename(binaryPath)}' failed identity check: ` +
        `${(err as Error).message}`,
    );
  }
}

// ── jslib import validation ───────────────────────────────────────────────────

/** Trusted domains for k6 jslib imports */
const ALLOWED_JSLIB_DOMAINS = [
  "jslib.k6.io",
  "cdn.jsdelivr.net",  // for npm/k6-* packages via jsDelivr
];

/**
 * Validate that a jslib import URL resolves to a trusted domain.
 * Prevents loading malicious extensions from arbitrary hosts.
 *
 * @param importUrl - The full URL of the jslib import to validate
 * @throws Error if the URL's hostname is not in the trusted list
 */
export function validateJslibImport(importUrl: string): void {
  let url: URL;
  try {
    url = new URL(importUrl);
  } catch {
    throw new Error(
      `[binary-validator] Invalid jslib import URL: '${importUrl}'`,
    );
  }

  const hostname = url.hostname.toLowerCase();
  const isAllowed = ALLOWED_JSLIB_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith("." + domain),
  );

  if (!isAllowed) {
    throw new Error(
      `[binary-validator] jslib import from untrusted domain '${hostname}' rejected. ` +
        `Allowed domains: ${ALLOWED_JSLIB_DOMAINS.join(", ")}`,
    );
  }
}
