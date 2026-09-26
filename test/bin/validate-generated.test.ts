/**
 * Generation gate — bin/validate-generated.js, one good + one bad fixture per kind.
 * Spawned as a CLI so the exit-code and --format=json contract is what's under test.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const FX = "test/fixtures/generated";

interface Check {
  id: string;
  status: "pass" | "warn" | "fail" | "skip";
  message: string;
  file?: string;
  line?: number;
}
interface Result {
  kind: string;
  path: string;
  verdict: "pass" | "fail";
  checks: Check[];
}

function gate(args: string[]): { status: number | null; result: Result } {
  const res = spawnSync(process.execPath, ["bin/validate-generated.js", "--format=json", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: res.status, result: JSON.parse(res.stdout || "null") };
}

const failed = (r: Result) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

describe("validate-generated --kind=scenario", () => {
  it("passes a clean scenario (full webpack build + k6 inspect when available)", () => {
    const { status, result } = gate(["--kind=scenario", `--config=${FX}/config.json`, `${FX}/scenarios/api/good.ts`]);
    expect(failed(result)).toEqual([]);
    expect(status).toBe(0);
    expect(result.checks.find((c) => c.id === "compile")?.status).toBe("pass");
  });

  it("fails every rule the bad scenario breaks", () => {
    const { status, result } = gate([
      "--kind=scenario",
      "--no-build",
      "--strict",
      `--config=${FX}/config.json`,
      `${FX}/scenarios/perf/bad.ts`,
    ]);
    expect(status).toBe(1);
    expect(result.verdict).toBe("fail");
    expect(new Set(failed(result))).toEqual(
      new Set(["gate-marker", "imports", "hosts", "secrets", "thresholds", "system-tags", "load-ceiling"])
    );
  });

  it("load ceiling only warns without --strict", () => {
    const { result } = gate(["--kind=scenario", "--no-build", `--config=${FX}/config.json`, `${FX}/scenarios/perf/bad.ts`]);
    expect(result.checks.find((c) => c.id === "load-ceiling")?.status).toBe("warn");
  });

  it("rejects a scenario outside the five buckets", () => {
    const { status, result } = gate(["--kind=scenario", "--no-build", `${FX}/scenarios/other/wrong-bucket.ts`]);
    expect(status).toBe(1);
    expect(failed(result)).toEqual(["bucket"]);
  });
});

describe("validate-generated --kind=testplan", () => {
  it("passes a schema-valid, allowlisted plan", () => {
    const { status } = gate(["--kind=testplan", `--config=${FX}/config.json`, `${FX}/testplan-good.json`]);
    expect(status).toBe(0);
  });

  it("fails schema, host and profile checks", () => {
    const { status, result } = gate(["--kind=testplan", `--config=${FX}/config.json`, `${FX}/testplan-bad.json`]);
    expect(status).toBe(1);
    expect(new Set(failed(result))).toEqual(new Set(["schema", "hosts", "profiles"]));
  });
});

describe("validate-generated --kind=flow", () => {
  const schema = `--schema=${FX}/flow/discovery-flow.schema.json`;

  it("passes a redacted flow with guardrails", () => {
    const { status } = gate(["--kind=flow", schema, `--config=${FX}/config.json`, `${FX}/flow/good`]);
    expect(status).toBe(0);
  });

  it("fails schema, guardrails, hosts, PII and secrets", () => {
    const { status, result } = gate(["--kind=flow", schema, `--config=${FX}/config.json`, `${FX}/flow/bad/flow.json`]);
    expect(status).toBe(1);
    expect(new Set(failed(result))).toEqual(new Set(["schema", "guardrails", "hosts", "pii", "secrets"]));
  });

  it("skips schema validation with a message when the schema is absent", () => {
    const { result } = gate(["--kind=flow", `--schema=${FX}/does-not-exist.json`, `${FX}/flow/good`]);
    expect(result.checks.find((c) => c.id === "schema")?.status).toBe("skip");
    expect(result.verdict).toBe("pass");
  });
});

describe("validate-generated --kind=patch", () => {
  it("passes a scenario-only proposal", () => {
    expect(gate(["--kind=patch", `${FX}/patch-good.diff`]).status).toBe(0);
  });

  it("fails paths outside scenarios, removed guards and new hosts", () => {
    const { status, result } = gate(["--kind=patch", `${FX}/patch-bad.md`]);
    expect(status).toBe(1);
    expect(new Set(failed(result))).toEqual(new Set(["paths", "guards", "hosts"]));
  });

  it("refuses an applied source file", () => {
    const { result } = gate(["--kind=patch", `${FX}/scenarios/api/good.ts`]);
    expect(failed(result)).toEqual(["proposal-only"]);
  });
});

describe("validate-generated --kind=report", () => {
  it("passes when every number is backed by the JSON", () => {
    const { status, result } = gate(["--kind=report", "--deny-terms=acme", `${FX}/report-good.md`]);
    expect(failed(result)).toEqual([]);
    expect(status).toBe(0);
  });

  it("flags unbacked numbers, PII and denied terms without echoing the term", () => {
    const { status, result } = gate(["--kind=report", "--deny-terms=acme", `${FX}/report-bad.md`]);
    expect(status).toBe(1);
    expect(new Set(failed(result))).toEqual(new Set(["numbers", "pii", "deny-terms"]));
    expect(JSON.stringify(result).toLowerCase()).not.toContain("acme");
  });
});

describe("validate-generated usage", () => {
  it("exits 2 on a bad --kind", () => {
    const res = spawnSync(process.execPath, ["bin/validate-generated.js", "--kind=nope", "x"], { cwd: ROOT, encoding: "utf8" });
    expect(res.status).toBe(2);
  });
});
