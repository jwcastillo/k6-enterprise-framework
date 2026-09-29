/**
 * Contract suite for `bin/create-client.sh`.
 *
 * Locks in three fixes:
 *   1. `--client=<name>` (the form documented in the README) works, as well as
 *      the positional `<name>`.
 *   2. Only the canonical scenario buckets accepted by `bin/run-test.sh`
 *      (CANONICAL_BUCKETS: api/flow/domain/chaos/perf) are created — no
 *      `integration/` or `mixed/`.
 *   3. The generated service class name is PascalCase on any platform. The old
 *      `sed 's/.../\U\2/'` only works with GNU sed; BSD sed (macOS) produced
 *      `UordersService`.
 *
 * The script resolves ROOT_DIR from its own location, so each test copies it
 * into a temp root and runs it there (nothing is written under clients/).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "bin", "create-client.sh");
const RUNNER = path.join(ROOT, "bin", "run-test.sh");

function canonicalBuckets(): string[] {
  const src = fs.readFileSync(RUNNER, "utf8");
  const m = src.match(/^CANONICAL_BUCKETS=\(([^)]*)\)/m);
  if (!m) throw new Error("CANONICAL_BUCKETS not found in bin/run-test.sh");
  return m[1].trim().split(/\s+/).sort();
}

let tmpRoot: string;

function run(args: string[]) {
  const res = spawnSync("bash", [path.join(tmpRoot, "bin", "create-client.sh"), ...args], {
    encoding: "utf8",
    timeout: 10_000,
    cwd: tmpRoot,
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function scenarioDirs(client: string): string[] {
  return fs
    .readdirSync(path.join(tmpRoot, "clients", client, "scenarios"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "create-client-"));
  fs.mkdirSync(path.join(tmpRoot, "bin"));
  fs.mkdirSync(path.join(tmpRoot, "clients"));
  fs.copyFileSync(SCRIPT, path.join(tmpRoot, "bin", "create-client.sh"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("bin/create-client.sh", () => {
  it("accepts --client=<name> (README form)", () => {
    const res = run(["--client=demo-x"]);
    expect(res.stderr).not.toMatch(/Invalid client name/);
    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(tmpRoot, "clients", "demo-x", "config", "default.json"))).toBe(true);
  });

  it("still accepts the positional name", () => {
    const res = run(["demo-y", "--service=orders"]);
    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(tmpRoot, "clients", "demo-y"))).toBe(true);
  });

  it("rejects two different names", () => {
    const res = run(["demo-a", "--client=demo-b"]);
    expect(res.status).not.toBe(0);
    expect(fs.existsSync(path.join(tmpRoot, "clients", "demo-a"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, "clients", "demo-b"))).toBe(false);
  });

  it("creates only the canonical buckets accepted by run-test.sh", () => {
    expect(run(["--client=demo-x"]).status).toBe(0);
    const dirs = scenarioDirs("demo-x");
    expect(dirs).toEqual(canonicalBuckets());
    expect(dirs).not.toContain("integration");
    expect(dirs).not.toContain("mixed");
  });

  it.each([
    ["orders", "OrdersService"],
    ["order-items", "OrderItemsService"],
    ["order_items", "OrderItemsService"],
    ["api", "ApiService"],
  ])("generates a PascalCase class for service %s", (service, expected) => {
    expect(run(["--client=demo-x", `--service=${service}`]).status).toBe(0);
    const svc = fs.readFileSync(
      path.join(tmpRoot, "clients", "demo-x", "lib", "services", `${service}.service.ts`),
      "utf8",
    );
    expect(svc).toContain(`export class ${expected} {`);
  });

  it("does not depend on GNU-only sed case escapes (\\U, \\u, \\L)", () => {
    // Guards the macOS regression even when CI runs on GNU sed.
    const src = fs.readFileSync(SCRIPT, "utf8");
    const sedLines = src.split("\n").filter((l) => /\bsed\b/.test(l) && !/^\s*#/.test(l));
    for (const line of sedLines) {
      expect(line).not.toMatch(/\\[UuLl]/);
    }
  });
});
