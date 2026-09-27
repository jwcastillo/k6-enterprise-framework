/**
 * Generation gate — bin/validate-generated.js, one good + one bad fixture per kind.
 * Spawned as a CLI so the exit-code and --format=json contract is what's under test.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

function gate(
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; script?: string } = {}
): { status: number | null; result: Result } {
  const res = spawnSync(process.execPath, [opts.script ?? "bin/validate-generated.js", "--format=json", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: opts.env ?? process.env,
  });
  return { status: res.status, result: JSON.parse(res.stdout || "null") };
}

const failed = (r: Result) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);
const statusOf = (r: Result, id: string) => r.checks.filter((c) => c.id === id).map((c) => c.status);
const HAS_K6 = !spawnSync("k6", ["version"], { encoding: "utf8" }).error;

describe("validate-generated --kind=scenario", () => {
  it("passes a clean scenario (full webpack build + k6 inspect when available)", () => {
    const { status, result } = gate(["--kind=scenario", `--config=${FX}/config.json`, `${FX}/scenarios/api/good.ts`]);
    expect(failed(result)).toEqual([]);
    expect(status).toBe(0);
    expect(result.checks.find((c) => c.id === "compile")?.status).toBe("pass");
  }, 90_000);

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

describe("validate-generated --kind=scenario, options from another module", () => {
  const cfg = `--config=${FX}/config.json`;

  it.each(["reexport", "helper-options"])("--no-build warns (not fails) on thresholds for %s", (name) => {
    const { status, result } = gate(["--kind=scenario", "--no-build", cfg, `${FX}/scenarios/api/${name}.ts`]);
    expect(statusOf(result, "thresholds")).toEqual(["warn"]);
    expect(status).toBe(0);
  });

  it("still fails a scenario with no options at all in --no-build", () => {
    const { result } = gate(["--kind=scenario", "--no-build", `${FX}/scenarios/perf/bad.ts`]);
    expect(statusOf(result, "thresholds")).toEqual(["fail"]);
  });
});

describe.skipIf(!HAS_K6)("validate-generated --kind=scenario, resolved options (real k6 inspect)", () => {
  const cfg = `--config=${FX}/config.json`;

  it("passes re-exported options through the full gate", () => {
    const { status, result } = gate(["--kind=scenario", "--strict", cfg, `${FX}/scenarios/api/reexport.ts`]);
    expect(failed(result)).toEqual([]);
    expect(status).toBe(0);
    expect(result.checks.find((c) => c.id === "thresholds")?.message).toMatch(/resolved/);
  }, 90_000);

  it("catches missing thresholds, 'url' systemTag and ceiling breach built in a helper module", () => {
    const { status, result } = gate(["--kind=scenario", "--strict", cfg, `${FX}/scenarios/api/helper-options.ts`]);
    expect(status).toBe(1);
    expect(new Set(failed(result))).toEqual(new Set(["thresholds", "system-tags", "load-ceiling"]));
    const ceiling = result.checks.filter((c) => c.id === "load-ceiling").map((c) => c.message);
    expect(ceiling).toEqual(["browse: 150 VUs exceeds ceiling 100", "orders: rate 300 exceeds ceiling 200"]);
  }, 90_000);

  it("--k6-env reaches k6 inspect (init opens a path from __ENV)", () => {
    const file = `${FX}/scenarios/api/data-env.ts`;
    const without = gate(["--kind=scenario", cfg, file]).result;
    expect(statusOf(without, "k6-inspect")).toEqual(["fail"]);
    const withEnv = gate(["--kind=scenario", cfg, `--k6-env=GATE_DATA_FILE=${path.join(ROOT, FX, "data-env.csv")}`, file]);
    expect(failed(withEnv.result)).toEqual([]);
    expect(withEnv.status).toBe(0);
  }, 90_000);
});

describe("validate-generated --kind=scenario, resolved options (stub k6)", () => {
  // CI has no k6: a stub on PATH records its argv and prints options at the top level
  // of its JSON, like k6 inspect does.
  it("passes --k6-env as -e and checks the top-level options k6 prints", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-k6-"));
    const argvFile = path.join(dir, "argv.json");
    const stub = path.join(dir, "k6");
    const printed = {
      vus: null,
      scenarios: { spike: { executor: "constant-arrival-rate", rate: 500, preAllocatedVUs: 20, maxVUs: 40 } },
      thresholds: { checks: ["rate>0.99"] },
      systemTags: ["status"],
    };
    fs.writeFileSync(
      stub,
      `#!${process.execPath}\n` +
        `const a = process.argv.slice(2);\n` +
        `if (a[0] === "inspect") require("fs").writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(a));\n` +
        `process.stdout.write(${JSON.stringify(JSON.stringify(printed))});\n`,
      { mode: 0o755 }
    );
    try {
      const { result } = gate(
        ["--kind=scenario", "--strict", `--config=${FX}/config.json`, "--k6-env=A=1", "--k6-env=B=x=y", `${FX}/scenarios/api/good.ts`],
        { env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } }
      );
      const argv = JSON.parse(fs.readFileSync(argvFile, "utf8")) as string[];
      expect(argv.slice(0, 5)).toEqual(["inspect", "-e", "A=1", "-e", "B=x=y"]);
      expect(statusOf(result, "thresholds")).toEqual(["pass"]);
      expect(statusOf(result, "system-tags")).toEqual(["pass"]);
      expect(result.checks.filter((c) => c.id === "load-ceiling").map((c) => c.message)).toEqual([
        "spike: rate 500 exceeds ceiling 200",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

describe("validate-generated in a standalone export layout", () => {
  // framework/src + framework/shared + config/<env>.json, no clients/ and no target-guard.js.
  it("resolves config/<env>.json without --client and profiles/schemas from framework/shared", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-standalone-"));
    try {
      fs.mkdirSync(path.join(dir, "bin"));
      for (const f of ["validate-generated.js", "_secret-patterns.js", "_help.js"]) {
        fs.copyFileSync(path.join(ROOT, "bin", f), path.join(dir, "bin", f));
      }
      fs.mkdirSync(path.join(dir, "framework/src"), { recursive: true });
      fs.cpSync(path.join(ROOT, "shared/schemas"), path.join(dir, "framework/shared/schemas"), { recursive: true });
      fs.mkdirSync(path.join(dir, "framework/shared/profiles"), { recursive: true });
      fs.writeFileSync(path.join(dir, "framework/shared/profiles/load.json"), "{}");
      fs.mkdirSync(path.join(dir, "config"));
      fs.writeFileSync(path.join(dir, "config/default.json"), JSON.stringify({ allowedHosts: ["other.test"] }));
      fs.copyFileSync(path.join(ROOT, FX, "config.json"), path.join(dir, "config/staging.json"));
      fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
      const script = path.join(dir, "bin/validate-generated.js");
      const plan = path.join(ROOT, FX, "testplan-good.json");

      const staging = gate(["--kind=testplan", "--env=staging", plan], { script });
      expect(failed(staging.result)).toEqual([]);
      expect(staging.status).toBe(0);

      // Without --env the gate falls back to config/default.json, whose allowedHosts rejects the plan host.
      const fallback = gate(["--kind=testplan", plan], { script });
      expect(failed(fallback.result)).toEqual(["hosts"]);

      // Profiles resolve from framework/shared/profiles (only load.json exists there).
      fs.rmSync(path.join(dir, "framework/shared/profiles/load.json"));
      expect(failed(gate(["--kind=testplan", "--env=staging", plan], { script }).result)).toEqual(["profiles"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
  it("exits 2 on a --k6-env without KEY=VAL", () => {
    const res = spawnSync(process.execPath, ["bin/validate-generated.js", "--kind=scenario", "--k6-env=novalue", "x"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(res.status).toBe(2);
  });

  it("exits 2 on a bad --kind", () => {
    const res = spawnSync(process.execPath, ["bin/validate-generated.js", "--kind=nope", "x"], { cwd: ROOT, encoding: "utf8" });
    expect(res.status).toBe(2);
  });
});
