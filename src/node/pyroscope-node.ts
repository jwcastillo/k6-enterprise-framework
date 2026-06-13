/**
 * Node-only pyroscope helpers extracted from src/observability/pyroscope-instrumentation.ts
 * in Phase 4 ARC-06 (per D-37). Uses Node http/https -- NOT k6-runtime safe.
 *
 * k6-safe functions (resolvePyroscopeConfig, buildPyroscopeHeader, withPyroscopeLabels,
 * logPyroscopeStatus) remain in src/observability/pyroscope-instrumentation.ts.
 */

import type { PyroscopeHealthResult } from "@observability/pyroscope-instrumentation";

/**
 * Check Pyroscope reachability before starting the test.
 * Returns a health result -- callers decide whether to abort or warn.
 *
 * Node.js context only.
 */
export async function checkPyroscopeHealth(endpoint: string): Promise<PyroscopeHealthResult> {
  const http = require("http") as typeof import("http");
  const https = require("https") as typeof import("https");
  const { URL } = require("url") as typeof import("url");

  const start = Date.now();

  return new Promise((resolve) => {
    let parsedUrl: InstanceType<typeof URL>;
    try {
      parsedUrl = new URL(`${endpoint}/ready`);
    } catch {
      resolve({ reachable: false, latencyMs: 0, error: `Invalid endpoint URL: ${endpoint}` });
      return;
    }

    const lib = parsedUrl.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: parsedUrl.pathname,
        method: "GET",
        timeout: 3000,
      },
      (res) => {
        const latencyMs = Date.now() - start;
        res.resume(); // drain response
        if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400) {
          resolve({ reachable: true, latencyMs });
        } else {
          resolve({
            reachable: false,
            latencyMs,
            error: `HTTP ${res.statusCode}`,
          });
        }
      }
    );

    req.on("error", (err) => {
      resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ reachable: false, latencyMs: Date.now() - start, error: "timeout" });
    });

    req.end();
  });
}

// ── Continuous profiling (OBS2-02) ──────────────────────────────────────────
//
// startContinuous + stopContinuous push CPU profile samples to a Pyroscope
// server for the duration of a k6 run on the Node host (orchestrator side).
// They are intentionally Node-only and never k6-runtime safe -- the
// `@pyroscope/nodejs` SDK uses Node built-ins (perf_hooks, async_hooks) that
// the goja runtime does not implement.
//
// The SDK is an optional dependency: if it is not installed, startContinuous
// degrades to a warn + no-op so an operator without the package can still run
// k6 normally. The ESLint `no-restricted-imports` rule keeps imports of
// `@pyroscope/nodejs` confined to this file (src/node/**/*.ts).

/**
 * Options for {@link startContinuous}.
 *
 * The tags map should include at least `app`, `client`, `scenario`,
 * `profile`, and `run_id` so that profile samples can be correlated with
 * traces emitted by OBS2-01 (which uses the same resource attribute keys).
 */
export interface ContinuousProfilingOptions {
  appName: string;
  serverAddress: string;
  tags: Record<string, string>;
  sampleRate?: number;
}

// Minimal local typing for the SDK surface we use. Avoids a hard `typeof
// import("@pyroscope/nodejs")` reference that tsc would try to resolve at
// type-check time -- the package is an optionalDependency and may be absent.
interface PyroscopeModuleShape {
  init(cfg: {
    appName: string;
    serverAddress: string;
    tags: Record<string, string>;
    sampleRate?: number;
  }): void;
  start(): void;
  stop(): Promise<void> | void;
}

// Module-level state guards. The Pyroscope SDK is global per-process, so we
// must prevent double-init (each call re-attaches sampling hooks) and we keep
// the module reference around so stopContinuous can flush + detach.
let _pyroscope: PyroscopeModuleShape | null = null;
let _started: boolean = false;

/**
 * Loader function for the optional @pyroscope/nodejs SDK. Returns the loaded
 * module on success or throws if the package is not installed. Defaults to a
 * CommonJS require, which is what the sidecar (bin/_pyroscope-continuous.js)
 * uses at runtime. Vitest runs the source under an ESM context where
 * `require` is not defined and `vi.mock("@pyroscope/nodejs", ...)` only
 * intercepts ESM `import`, so tests inject a stub via
 * {@link _setPyroscopeLoaderForTesting}.
 */
type PyroscopeLoader = () => PyroscopeModuleShape;
let _loader: PyroscopeLoader = () =>
  // The Function() wrapper avoids vitest's ESM transform of `require`. In a
  // real Node CJS context this still resolves to the global CJS require.
  (new Function("name", "return require(name)") as (name: string) => PyroscopeModuleShape)(
    "@pyroscope/nodejs"
  );

/**
 * Test-only seam: replace the loader used by {@link startContinuous}. Pass
 * `null` to restore the default require-based loader. Exported with an
 * underscore prefix to signal "private" -- production code MUST NOT call
 * this. Vitest tests use it to inject a mocked SDK shape without needing
 * `vi.mock` (which only hooks ESM imports, not CommonJS require).
 */
export function _setPyroscopeLoaderForTesting(loader: PyroscopeLoader | null): void {
  _loader =
    loader ??
    ((): PyroscopeModuleShape =>
      (new Function("name", "return require(name)") as (name: string) => PyroscopeModuleShape)(
        "@pyroscope/nodejs"
      ));
}

/**
 * Test-only seam: reset the module-level _started / _pyroscope state guards
 * so a single vitest worker can run multiple lifecycle scenarios. Production
 * code MUST NOT call this.
 */
export function _resetPyroscopeStateForTesting(): void {
  _pyroscope = null;
  _started = false;
}

/**
 * Start the Pyroscope continuous profiler (OBS2-02).
 *
 * Lazy-requires `@pyroscope/nodejs`; if the optional dep is not installed,
 * logs a warning and returns without throwing. Idempotent -- a second call
 * while already started logs a warning and returns.
 *
 * Node.js context only.
 *
 * @example
 *   startContinuous({
 *     appName: "k6-_reference.smoke",
 *     serverAddress: "http://localhost:4040",
 *     tags: { app: "k6", client: "_reference", scenario: "api/smoke-users", profile: "smoke", run_id: "abc123" },
 *   });
 */
export function startContinuous(opts: ContinuousProfilingOptions): void {
  if (_started) {
    console.warn("[pyroscope] startContinuous called twice — ignoring second call");
    return;
  }

  let mod: PyroscopeModuleShape;
  try {
    // Dynamic load via the injectable _loader so the optional dependency is
    // not a hard load. Production: a CommonJS `require("@pyroscope/nodejs")`.
    // Test: a vi.fn() stub via _setPyroscopeLoaderForTesting. The shape
    // interface keeps tsc happy without needing the package present at
    // type-check time (the package is in optionalDependencies).
    mod = _loader();
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.warn(
      `[pyroscope] @pyroscope/nodejs is not installed — continuous profiling disabled ` +
        `(install via 'pnpm add -O @pyroscope/nodejs' to enable). Cause: ${message}`
    );
    return;
  }

  _pyroscope = mod;
  mod.init({
    appName: opts.appName,
    serverAddress: opts.serverAddress,
    tags: opts.tags,
    sampleRate: opts.sampleRate ?? 100,
  });
  mod.start();
  _started = true;
  console.log(
    `[pyroscope] continuous profiling started — appName=${opts.appName} ` +
      `server=${opts.serverAddress} tags=${JSON.stringify(opts.tags)}`
  );
}

/**
 * Stop the Pyroscope continuous profiler (OBS2-02).
 *
 * Flushes any pending samples and detaches the sampler. Safe to call when
 * startContinuous was never called or when it degraded gracefully (no-op).
 * Errors from the SDK stop() are swallowed -- the run-test exit path must
 * not be derailed by a profiler shutdown failure.
 *
 * Node.js context only.
 *
 * @example
 *   await stopContinuous();
 */
export async function stopContinuous(): Promise<void> {
  if (!_started || _pyroscope == null) {
    return;
  }
  try {
    await _pyroscope.stop();
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.warn(`[pyroscope] stopContinuous error: ${message}`);
  }
  _started = false;
  _pyroscope = null;
  console.log("[pyroscope] continuous profiling stopped");
}
