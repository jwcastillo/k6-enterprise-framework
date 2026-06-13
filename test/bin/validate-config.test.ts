/**
 * COV-05 — bin/validate-config.js spawn-based tests (D-08, D-09, D-10).
 *
 * Asserts the validation contract for client/config JSON files:
 *   exit 0 = valid; exit 1 = invalid or missing required args.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "bin/validate-config.js");
const FIX = path.join(ROOT, "test/fixtures/validate-config");

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describe("bin/validate-config.js (COV-05)", () => {
  it("exits 0 for a valid config (generated from --example)", () => {
    const { code } = run([`--file=${FIX}/valid.json`]);
    expect(code).toBe(0);
  });

  it("exits 1 when required field 'client' is missing", () => {
    const { code, stdout, stderr } = run([`--file=${FIX}/invalid-missing-client.json`]);
    expect(code).toBe(1);
    const out = stdout + stderr;
    expect(out).toMatch(/client/i);
  });

  it("exits 1 when a field has the wrong type", () => {
    const { code } = run([`--file=${FIX}/invalid-wrong-type.json`]);
    expect(code).toBe(1);
  });

  it("exits 1 on malformed JSON input", () => {
    const { code, stdout, stderr } = run([`--file=${FIX}/invalid-malformed.json`]);
    expect(code).toBe(1);
    const out = stdout + stderr;
    expect(out).toMatch(/json|parse|syntax/i);
  });

  it("exits 1 on an empty {} config (missing required fields)", () => {
    const { code } = run([`--file=${FIX}/invalid-empty.json`]);
    expect(code).toBe(1);
  });

  it("handles an unknown top-level key without crashing (exit 0 or 1, no exception)", () => {
    const { code, stderr } = run([`--file=${FIX}/invalid-unknown-key.json`]);
    expect([0, 1]).toContain(code);
    expect(stderr).not.toMatch(/TypeError|SyntaxError at|undefined is not/);
  });

  it("--help exits 0 with usage text", () => {
    const { code, stdout } = run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/validate-config/i);
    expect(stdout).toMatch(/--file|--example/i);
  });

  it("--example exits 0 and prints sample config", () => {
    const { code, stdout } = run(["--example", "--format=json"]);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("client");
    expect(parsed).toHaveProperty("baseUrl");
  });

  it("missing --file argument with no other action exits non-zero", () => {
    const { code } = run([]);
    expect(code).not.toBe(0);
  });
});
