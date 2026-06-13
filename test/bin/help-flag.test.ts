/**
 * Spawn-based contract suite for the `--help` / `-h` flag across all 16
 * `bin/*.js` scripts (Phase 6 / DX-01, D-04).
 *
 * For each script and each flag form, the helper must:
 *   - exit with status 0
 *   - emit stdout containing /Usage:/i AND /Examples:/i
 *
 * Asserts the shared `bin/_help.js` helper is consistently wired and the
 * short-flag form (`-h`) is detected (D-02). Pre-Phase-6 only 0/16 scripts
 * responded to `--help`; this suite locks in the post-fix contract.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

const SCRIPTS: ReadonlyArray<string> = [
  "audit-query.js",
  "check-cli-auth.js",
  "check-rbac.js",
  "clean-redis-data.js",
  "compare-results.js",
  "export-data.js",
  "generate-artifacts.js",
  "generate-data.js",
  "generate-report.js",
  "generate.js",
  "load-redis-data.js",
  "mock-server.js",
  "notify.js",
  "slo-report.js",
  "trend-analysis.js",
  "validate-config.js",
];

const FLAGS: ReadonlyArray<string> = ["--help", "-h"];

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHelp(script: string, flag: string): SpawnResult {
  const scriptPath = path.join(ROOT, "bin", script);
  const res = spawnSync(process.execPath, [scriptPath, flag], {
    encoding: "utf8",
    timeout: 10_000,
    cwd: ROOT,
  });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

describe("bin/*.js --help contract (DX-01)", () => {
  describe.each(SCRIPTS)("%s", (script) => {
    it.each(FLAGS)("exits 0 with Usage: + Examples: on %s", (flag) => {
      const { status, stdout } = runHelp(script, flag);
      expect(status, `${script} ${flag} exit code`).toBe(0);
      expect(stdout, `${script} ${flag} stdout`).toMatch(/Usage:/i);
      expect(stdout, `${script} ${flag} stdout`).toMatch(/Examples:/i);
    });
  });

  it("bin/_help.js renders banner, Usage, Options, Examples", () => {
    // Direct invocation of the helper via a one-liner — sanity-checks that
    // printHelp() itself never throws on the canonical spec shape.
    const helperPath = path.join(ROOT, "bin/_help.js");
    const code = `
      const { printHelp } = require(${JSON.stringify(helperPath)});
      printHelp({
        name: "demo",
        description: "demo description",
        usage: "node demo.js --foo VAL",
        flags: [
          { flag: "--foo", description: "sets foo" },
          { flag: "--longer-flag", description: "aligned" },
        ],
        examples: ["node demo.js --foo abc", "node demo.js --foo abc --longer-flag z"],
      });
    `;
    const res = spawnSync(process.execPath, ["-e", code], {
      encoding: "utf8",
      timeout: 5_000,
      cwd: ROOT,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/demo — demo description/);
    expect(res.stdout).toMatch(/Usage:/);
    expect(res.stdout).toMatch(/Options:/);
    expect(res.stdout).toMatch(/Examples:/);
    expect(res.stdout).toMatch(/--foo\s+sets foo/);
  });
});
