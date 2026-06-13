#!/usr/bin/env node
/**
 * OBS2-02 (Phase 09 / 09-01): Strategy A sidecar shim for Pyroscope continuous
 * profiling. Invoked by bin/run-test.sh before k6 ("start") and on the EXIT
 * trap ("stop"). Receives args via argv (NOT shell-interpolated -e strings) so
 * operator-supplied CLIENT/SCENARIO/PROFILE values cannot inject shell.
 *
 * Loads the TypeScript source src/node/pyroscope-node.ts directly via
 * ts-node/register so we never need a separate build step for the sidecar.
 * Mirrors the bin/_help.js pattern (zero-dep shared Node script).
 *
 * Usage:
 *   node bin/_pyroscope-continuous.js start --app-name <name> --server <url> \
 *     --tag k=v [--tag k=v ...]
 *   node bin/_pyroscope-continuous.js stop
 */

"use strict";

// Run ts-node in CommonJS mode so the loaded TS source (which uses
// `require(...)` for the optional @pyroscope/nodejs dep) executes under
// Node's CJS loader. The project's tsconfig.json targets ES2020 modules for
// the webpack bundle, but this sidecar is a pure Node host script.
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { startContinuous, stopContinuous } = require("../src/node/pyroscope-node");

/**
 * Parse `--key value` / `--tag k=v` style argv slice.
 *
 * @param {string[]} args - process.argv.slice(3) (after op).
 * @returns {{ appName: string, serverAddress: string, tags: Record<string,string> }}
 */
function parseStartArgs(args) {
  let appName = "";
  let serverAddress = "";
  const tags = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--app-name" && i + 1 < args.length) {
      appName = args[++i];
    } else if (a === "--server" && i + 1 < args.length) {
      serverAddress = args[++i];
    } else if (a === "--tag" && i + 1 < args.length) {
      const kv = args[++i];
      const eq = kv.indexOf("=");
      if (eq > 0) {
        const k = kv.slice(0, eq);
        const v = kv.slice(eq + 1);
        tags[k] = v;
      } else {
        console.warn(`[pyroscope-sidecar] ignoring malformed --tag '${kv}' (expected key=value)`);
      }
    } else {
      console.warn(`[pyroscope-sidecar] ignoring unknown arg '${a}'`);
    }
  }

  if (!appName || !serverAddress) {
    console.error("[pyroscope-sidecar] --app-name and --server are required for 'start' op");
    process.exit(2);
  }

  return { appName, serverAddress, tags };
}

async function main() {
  const op = process.argv[2];
  const rest = process.argv.slice(3);

  if (op === "start") {
    const { appName, serverAddress, tags } = parseStartArgs(rest);
    startContinuous({ appName, serverAddress, tags });
    // Keep the sidecar process alive so the SDK keeps sampling until the
    // run-test.sh EXIT trap fires "stop" (or SIGTERM us). A long no-op
    // interval is cheaper than spinning the event loop.
    setInterval(() => {}, 1 << 30);
    return;
  }

  if (op === "stop") {
    await stopContinuous();
    process.exit(0);
  }

  console.error(`[pyroscope-sidecar] unknown op '${op}' (expected: start | stop)`);
  process.exit(2);
}

main().catch((err) => {
  console.error(`[pyroscope-sidecar] fatal: ${(err && err.message) || err}`);
  process.exit(1);
});
