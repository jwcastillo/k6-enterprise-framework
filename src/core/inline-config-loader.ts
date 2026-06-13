// T-088: Configuracion inline via variables de entorno del pipeline
//
// Supports two modes:
//   1. TEST_CONFIG env var: JSON string with full config (written to temp file)
//   2. --config=<https-url>: download config from HTTPS URL
//
// This module runs in Node.js context (bin/ scripts), NOT in k6 runtime.
// It validates the config against JSON Schema before passing to execution engine.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InlineConfigResult {
  configPath: string;
  tempFile: boolean;         // true if a temp file was created and must be cleaned up
  source: 'env' | 'url' | 'file';
}

export class InlineConfigError extends Error {
  constructor(
    message: string,
    public readonly position?: number
  ) {
    super(message);
    this.name = 'InlineConfigError';
  }
}

// ── TEST_CONFIG env var processing ────────────────────────────────────────────

/**
 * Reads TEST_CONFIG env var, validates JSON, writes to a secure temp file.
 * Returns the temp file path. Caller must call cleanup() after use.
 *
 * @throws InlineConfigError on malformed JSON or validation failure
 */
export function processTestConfigEnv(testConfigJson?: string): InlineConfigResult | null {
  const raw = testConfigJson ?? process.env['TEST_CONFIG'];
  if (!raw || raw.trim() === '') return null;

  // Validate JSON and report position on error
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const e = err as SyntaxError;
    // Extract position from error message (e.g., "Unexpected token at position 42")
    const posMatch = e.message.match(/position (\d+)/i);
    const position = posMatch ? parseInt(posMatch[1], 10) : undefined;
    throw new InlineConfigError(
      `TEST_CONFIG contains invalid JSON: ${e.message}` +
        (position !== undefined ? ` (at position ${position})` : ''),
      position
    );
  }

  // Basic structural validation
  validateConfigShape(parsed, 'TEST_CONFIG');

  // Write to secure temp file (0600 permissions)
  const uuid = crypto.randomUUID();
  const tempPath = path.join(os.tmpdir(), `k6-config-${uuid}.json`);

  // Write with restrictive permissions (CHK-SEC: temp file 0600)
  const fd = fs.openSync(tempPath, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(parsed, null, 2));
  } finally {
    fs.closeSync(fd);
  }

  console.log(`[InlineConfig] TEST_CONFIG written to temp file: ${tempPath}`);
  return { configPath: tempPath, tempFile: true, source: 'env' };
}

// ── --config=<url> remote loading ─────────────────────────────────────────────

/**
 * Downloads a config from an HTTPS URL, validates, and writes to temp file.
 * Only HTTPS is supported (not HTTP).
 *
 * @throws InlineConfigError on HTTP errors, non-HTTPS URLs, or invalid JSON
 */
export function downloadRemoteConfig(url: string): Promise<InlineConfigResult> {
  if (!url.startsWith('https://')) {
    throw new InlineConfigError(
      `Remote config URL must use HTTPS (got: ${url}). HTTP is not supported for security reasons.`
    );
  }

  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15_000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new InlineConfigError(
          `Failed to download remote config from ${url}: HTTP ${res.statusCode}`
        ));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');

        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch (err: unknown) {
          const e = err as SyntaxError;
          const posMatch = e.message.match(/position (\d+)/i);
          const position = posMatch ? parseInt(posMatch[1], 10) : undefined;
          reject(new InlineConfigError(
            `Remote config at ${url} contains invalid JSON: ${e.message}`,
            position
          ));
          return;
        }

        try {
          validateConfigShape(parsed, `remote config (${url})`);
        } catch (ve) {
          reject(ve);
          return;
        }

        const uuid = crypto.randomUUID();
        const tempPath = path.join(os.tmpdir(), `k6-config-${uuid}.json`);
        const fd = fs.openSync(tempPath, 'wx', 0o600);
        try {
          fs.writeSync(fd, JSON.stringify(parsed, null, 2));
        } finally {
          fs.closeSync(fd);
        }

        console.log(`[InlineConfig] Remote config downloaded to: ${tempPath}`);
        resolve({ configPath: tempPath, tempFile: true, source: 'url' });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new InlineConfigError(`Timeout downloading remote config from ${url} (15s)`));
    });

    req.on('error', (err: Error) => {
      reject(new InlineConfigError(`Network error downloading config from ${url}: ${err.message}`));
    });
  });
}

// ── Config priority resolution ────────────────────────────────────────────────

/**
 * Resolve the effective config path, respecting priority:
 *   1. --config=<path|url> CLI flag (highest)
 *   2. TEST_CONFIG env var
 *
 * If both are present, uses --config and emits a warning.
 *
 * @param cliConfig   Value of --config CLI flag (path or https:// URL), or undefined
 * @returns           Resolved config result, or null if neither is set
 */
export async function resolveInlineConfig(cliConfig?: string): Promise<InlineConfigResult | null> {
  const hasEnvConfig = !!process.env['TEST_CONFIG'];

  // --config=https://... → download
  if (cliConfig?.startsWith('https://')) {
    if (hasEnvConfig) {
      console.warn('[InlineConfig] Both --config and TEST_CONFIG are set. --config takes priority (TEST_CONFIG ignored).');
    }
    return downloadRemoteConfig(cliConfig);
  }

  // --config=<file path> → use as-is
  if (cliConfig && !cliConfig.startsWith('http')) {
    if (hasEnvConfig) {
      console.warn('[InlineConfig] Both --config and TEST_CONFIG are set. --config takes priority (TEST_CONFIG ignored).');
    }
    if (!fs.existsSync(cliConfig)) {
      throw new InlineConfigError(`Config file not found: ${cliConfig}`);
    }
    return { configPath: cliConfig, tempFile: false, source: 'file' };
  }

  // TEST_CONFIG env var
  if (hasEnvConfig) {
    return processTestConfigEnv();
  }

  return null;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/** Delete a temp config file created by this module */
export function cleanupTempConfig(result: InlineConfigResult | null): void {
  if (!result || !result.tempFile) return;
  try {
    fs.unlinkSync(result.configPath);
    console.log(`[InlineConfig] Temp config cleaned up: ${result.configPath}`);
  } catch {
    // Ignore cleanup errors — best effort
  }
}

// ── Schema validation (lightweight, no ajv dependency) ───────────────────────

const REQUIRED_FIELDS_ANY: string[] = []; // top-level config is flexible

interface ConfigLike {
  test_cases?: unknown[];
  scenarios?: Record<string, unknown>;
  baseUrl?: string;
  thresholds?: Record<string, unknown>;
}

function validateConfigShape(parsed: unknown, source: string): void {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InlineConfigError(
      `${source}: config must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
    );
  }

  const cfg = parsed as ConfigLike;

  // Must have at least one of: test_cases, scenarios, baseUrl, thresholds
  const hasContent =
    (Array.isArray(cfg.test_cases) && cfg.test_cases.length > 0) ||
    (typeof cfg.scenarios === 'object' && cfg.scenarios !== null && Object.keys(cfg.scenarios).length > 0) ||
    typeof cfg.baseUrl === 'string' ||
    (typeof cfg.thresholds === 'object' && cfg.thresholds !== null);

  if (!hasContent) {
    throw new InlineConfigError(
      `${source}: config must contain at least one of: test_cases[], scenarios{}, baseUrl, or thresholds{}`
    );
  }

  // validate test_cases[] items if present
  if (Array.isArray(cfg.test_cases)) {
    cfg.test_cases.forEach((tc, i) => {
      if (typeof tc !== 'object' || tc === null) {
        throw new InlineConfigError(`${source}: test_cases[${i}] must be an object`);
      }
    });
  }

  // Validate no obviously invalid field names that might indicate shell injection
  const dangerousPattern = /[;|&`$><\n\r\\]/;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (dangerousPattern.test(key)) {
      throw new InlineConfigError(
        `${source}: config key "${key}" contains disallowed characters`
      );
    }
    if (typeof value === 'string' && value.length > 10_000) {
      console.warn(`[InlineConfig] ${source}: field "${key}" is very large (${value.length} chars)`);
    }
  }

  void REQUIRED_FIELDS_ANY; // used implicitly
}
