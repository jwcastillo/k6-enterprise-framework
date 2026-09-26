/**
 * Claude Code hooks — .claude/hooks/guardrails.js.
 * Pure checks are unit-tested; one spawn per mode locks the stdin → exit-code contract.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const HOOK = path.join(ROOT, ".claude/hooks/guardrails.js");
const { checkBash, checkWrite, checkScenario } = require(HOOK);

function runHook(mode: string, toolInput: Record<string, unknown>, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [HOOK, mode], {
    cwd: ROOT,
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "x", tool_input: toolInput }),
    env: { ...process.env, K6_AGENT_ALLOW_UNSAFE: "", ...env },
    timeout: 10_000,
  });
}

describe("checkBash", () => {
  it("blocks a bare k6 run / k6 cloud", () => {
    expect(checkBash("k6 run dist/x.js", {})).toMatch(/run-test\.sh/);
    expect(checkBash("cd dist && k6 cloud x.js", {})).toMatch(/run-test\.sh/);
  });

  it("allows the runner and k6 subcommands that fire no load", () => {
    expect(checkBash("./bin/run-test.sh --client=_reference --scenario=api/smoke-users", {})).toBeNull();
    expect(checkBash("k6 inspect dist/x.js && k6 version", {})).toBeNull();
  });

  it("blocks --unsafe and K6_ALLOW_PROD_LOAD=true unless the human opted in", () => {
    expect(checkBash("./bin/run-test.sh --scenario=perf/x --unsafe", {})).toMatch(/K6_AGENT_ALLOW_UNSAFE/);
    expect(checkBash("K6_ALLOW_PROD_LOAD=true ./bin/run-test.sh --env=production", {})).toMatch(/human/);
    expect(checkBash("./bin/run-test.sh --scenario=perf/x --unsafe", { K6_AGENT_ALLOW_UNSAFE: "1" })).toBeNull();
  });
});

describe("checkWrite", () => {
  it("blocks HAR / replay files on tracked paths, allows them in ignored dirs", () => {
    const tracked = () => false;
    const ignored = () => true;
    expect(checkWrite("clients/acme/flow.har", tracked)).toMatch(/gitignored/);
    expect(checkWrite("clients/acme/replay-2026.json", tracked)).toMatch(/gitignored/);
    expect(checkWrite("data/flow.har", ignored)).toBeNull();
    expect(checkWrite("src/core/config.ts", tracked)).toBeNull();
  });

  it("fails open when git cannot tell", () => {
    expect(checkWrite("x.har", () => null)).toBeNull();
  });

  it("uses real gitignore rules end to end", () => {
    expect(runHook("write", { file_path: path.join(ROOT, "clients/_reference/flow.har") }).status).toBe(2);
    expect(runHook("write", { file_path: path.join(ROOT, "reports/flow.har") }).status).toBe(0);
  });
});

describe("checkScenario (PostToolUse)", () => {
  it("ignores files outside scenarios/", () => {
    expect(checkScenario("src/core/config.ts")).toBeNull();
  });

  it("surfaces gate failures for a scenario", () => {
    const fake = () => ({
      status: 1,
      stdout: JSON.stringify({ checks: [{ id: "thresholds", status: "fail", message: "options must declare thresholds" }] }),
    });
    expect(checkScenario("clients/acme/scenarios/api/x.ts", fake)).toMatch(/thresholds: options must declare thresholds/);
  });

  it("fails open when the gate itself errors", () => {
    expect(checkScenario("clients/acme/scenarios/api/x.ts", () => ({ status: 2, stdout: "" }))).toBeNull();
  });

  it("passes a clean reference scenario end to end, fast", () => {
    const t0 = Date.now();
    const res = runHook("post-scenario", { file_path: path.join(ROOT, "clients/_reference/scenarios/api/smoke-users.ts") });
    expect(res.status).toBe(0);
    // ~0.5 s on an idle machine; the bound leaves room for a loaded CI runner.
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("hook process", () => {
  it("denies with exit 2 and a message on stderr", () => {
    const res = runHook("bash", { command: "k6 run x.js" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/run-test\.sh/);
  });

  it("fails open on garbage input", () => {
    const res = spawnSync(process.execPath, [HOOK, "bash"], { input: "not json", encoding: "utf8" });
    expect(res.status).toBe(0);
  });
});
