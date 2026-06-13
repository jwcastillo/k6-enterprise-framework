/**
 * Config loader — Phase 2 implementation
 *
 * Note on k6 runtime constraints:
 * - k6 scripts run in the goja runtime (no Node.js fs, no require())
 * - JSON config files must be imported via `open()` (k6 built-in) or bundled by webpack
 * - This module provides:
 *   (a) k6-compatible config resolution using __ENV (pre-injected by run-test.sh)
 *   (b) TypeScript type-safe config merging for use inside scenario scripts
 *
 * Full JSON/YAML file loading happens in bin/run-test.sh (Node.js context),
 * which pre-validates and injects config values as k6 env vars.
 */

import { ClientConfig, Environment, TestConfig } from "../types/config.d";
import { ProfileName } from "../types/profile.d";
import { profileToOptions } from "./profile-loader";
import { resolveSecretOr } from "./secrets-manager";

// ── Config resolution from __ENV (k6 runtime) ────────────────────────────────

/**
 * Read the active client configuration from k6 __ENV variables.
 * run-test.sh pre-injects these from the JSON config files.
 */
export function getActiveConfig(): {
  client: string;
  env: Environment;
  profile: ProfileName;
} {
  return {
    client: __ENV["K6_CLIENT"] ?? "_reference",
    env: (__ENV["K6_ENV"] ?? "default") as Environment,
    profile: (__ENV["K6_PROFILE"] ?? "smoke") as ProfileName,
  };
}

/**
 * Build a k6 options object by combining the active profile with scenario overrides.
 * Use this in scenario scripts to apply the correct profile thresholds.
 *
 * @example
 * export const options = buildOptions({ http_req_duration: ["p(99)<5000"] });
 */
export function buildOptions(
  thresholdOverrides: Record<string, string[]> = {},
): Record<string, unknown> {
  const { profile, client, env } = getActiveConfig();
  const profileOptions = profileToOptions(profile, thresholdOverrides);

  return {
    ...profileOptions,
    tags: {
      client,
      environment: env,
      profile,
      test_timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Build a minimal ClientConfig from __ENV for use in scenario init.
 * Full config merging from JSON files happens in bin/ (Node.js context).
 */
export function buildClientConfig(
  baseUrl: string,
  overrides: Partial<ClientConfig> = {},
): ClientConfig {
  const { client, env } = getActiveConfig();

  return {
    client,
    version: "0.1.0",
    environment: env,
    endpoints: {
      api: { baseUrl },
    },
    tags: { client, environment: env },
    ...overrides,
  };
}

// ── Validation (runs at script init time in k6) ───────────────────────────────

const REQUIRED_ENV_KEYS = ["K6_CLIENT", "K6_PROFILE", "K6_ENV"];

/**
 * Validate that required env vars are set.
 * Call in setup() to catch misconfiguration before load starts.
 */
export function validateEnvConfig(): void {
  const missing = REQUIRED_ENV_KEYS.filter((k) => !__ENV[k]);
  if (missing.length > 0) {
    console.warn(
      `ConfigLoader: missing recommended env vars: ${missing.join(", ")}. Using defaults.`,
    );
  }
}

/**
 * Resolve a named secret from the configured backends.
 * Thin wrapper that reads K6_SECRETS_BACKENDS from env.
 */
export function getSecret(key: string, fallback = ""): string {
  return resolveSecretOr(key, fallback);
}

// ── TestConfig builder ────────────────────────────────────────────────────────

/** Build a TestConfig from __ENV for use in execution-engine */
export function buildTestConfig(
  script: string,
  overrides: Partial<TestConfig> = {},
): TestConfig {
  const { client, env, profile } = getActiveConfig();
  return {
    name: __ENV["K6_TEST_NAME"] ?? script,
    profile,
    client,
    environment: env,
    script,
    tags: { client, environment: env, profile },
    ...overrides,
  };
}
