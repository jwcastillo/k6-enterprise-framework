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

  // Review finding: regexes on raw text were bypassed by quoting and indirection.
  it("blocks k6 load hidden behind shells, eval and quoting", () => {
    for (const cmd of [`bash -c "k6 run app.js"`, `sh -c 'k6 run app.js'`, `k6" "run app.js`, `eval "k6 cloud x.js"`, `k""6 run x.js`]) {
      expect(checkBash(cmd, {}), cmd).toMatch(/run-test\.sh/);
    }
  });

  it("blocks guarded flags smuggled through variables", () => {
    for (const cmd of [
      "V=--unsafe; ./bin/run-test.sh --scenario=perf/x $V",
      "K6_ALLOW_PROD_LOAD=$V ./bin/run-test.sh --env=production",
      `V=K6_ALLOW_PROD_LOAD; export "$V=true"; ./bin/run-test.sh --profile=smoke`,
      "$RUNNER --scenario=perf/x",
      "cat cmd.txt | bash",
    ]) {
      expect(checkBash(cmd, { K6_AGENT_ALLOW_UNSAFE: "1" }), cmd).toMatch(/indirection not allowed/);
    }
  });

  // Adversarial review: a parse error used to fail open unless the raw text named k6,
  // and ANSI-C hex escapes hide the name. Any parse error now fails closed.
  it("fails closed on every parse error", () => {
    expect(checkBash(`./bin/run-test.sh --scenario="x`, {})).toMatch(/could not parse command/);
    expect(checkBash(`echo "unterminated`, {})).toMatch(/write it in a simpler form/);
    expect(checkBash("echo x | (", {})).toMatch(/could not parse command/);
  });

  it("blocks the array-assignment + hex-escape bypass", () => {
    const hidden = "$'" + "\\x6b" + "\\x36" + " run x.js'";
    // Denied as k6 load, or earlier as an assignment before a run — either way, denied.
    expect(checkBash(`arr=(x); bash -c ${hidden}`, {})).toMatch(/run-test\.sh|environment assignment/);
    expect(checkBash(`arr=(x); ${hidden}`, {})).toMatch(/run-test\.sh|environment assignment/);
    expect(checkBash(`bash -c ${hidden}`, {})).toMatch(/run-test\.sh/);
  });

  it("parses array assignments and function definitions instead of failing", () => {
    expect(checkBash("arr=(a b c); echo ok", {})).toBeNull();
    expect(checkBash("f() { echo ok; }; f", {})).toBeNull();
    expect(checkBash("f(){ k6 run x.js; }; f", {})).toMatch(/run-test\.sh/);
  });

  it("uses the payload cwd to resolve scripts", () => {
    expect(checkBash("pnpm test:reference", {}, undefined, ROOT)).toMatch(/run-test\.sh/);
  });

  it("fails closed when the shell parser module is missing", () => {
    expect(checkBash("./bin/run-test.sh --scenario=api/x", {}, null)).toMatch(/_shell-guard\.js is missing/);
    expect(checkBash("ls", {}, null)).toBeNull();
  });

  it("does not block everyday commands that only mention k6 in data", () => {
    expect(checkBash(`git log --grep "k6 run" && ls`, {})).toBeNull();
    expect(checkBash("pnpm test 2>&1 | tail -5", {})).toBeNull();
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

  it("fails closed when git cannot tell", () => {
    expect(checkWrite("x.har", () => null)).toMatch(/cannot be verified as gitignored/);
    expect(checkWrite("src/core/config.ts", () => null)).toBeNull();
  });

  it("covers Playwright traces, storage/auth state and HAR variants", () => {
    const tracked = () => false;
    for (const f of [
      "clients/acme/trace.zip",
      "clients/acme/checkout.trace.zip",
      "clients/acme/storage-state.json",
      "clients/acme/storageState.json",
      "clients/acme/storage-state-admin.json",
      "clients/acme/admin-auth-state.json",
      "clients/acme/flow.har.json",
      "clients/acme/flow.har.gz",
    ]) {
      expect(checkWrite(f, tracked), f).toMatch(/gitignored/);
      expect(checkWrite(f, () => true), f).toBeNull();
    }
    expect(checkWrite("clients/acme/config/default.json", tracked)).toBeNull();
    expect(checkWrite("docs/tracing.md", tracked)).toBeNull();
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

describe("checkBash: run approvals", () => {
  it("blocks the approval tool in any form, even with the unsafe opt-in", () => {
    for (const cmd of [
      "./bin/approve-run.sh --scenario=perf/x --profile=load --env=production",
      "bash bin/approve-run.sh",
      "source bin/approve-run.sh",
      "node bin/_run-approval.js approve",
      "script -qc bin/approve-run.sh /dev/null",
      "unbuffer bin/approve-run.sh",
    ]) {
      expect(checkBash(cmd, { K6_AGENT_ALLOW_UNSAFE: "1" }), cmd).toMatch(/approvals are human-only: ask the user to run bin\/approve-run\.sh/);
    }
    expect(checkBash("cat bin/approve-run.sh", {})).toBeNull();
  });

  it("fails closed on the approval tool when the shell parser is missing", () => {
    expect(checkBash("bin/approve-run.sh", {}, null)).toMatch(/_shell-guard\.js is missing/);
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
