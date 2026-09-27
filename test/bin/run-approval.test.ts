/**
 * Human approval for guarded runs + trusted k6 resolution (bin/_run-guard.sh,
 * bin/_run-approval.js, bin/approve-run.sh).
 *
 * The runner is spawned for real with a temp XDG_STATE_HOME (approval store), a temp
 * client whose config lists a temp stub dir in trustedBinDirs, and a stub k6 that only
 * drops a marker file. The positive TTY path of approve-run.sh is not driven here (the
 * confirmation code is random and read from /dev/tty); records are created with the
 * same module functions it uses.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const approval = require("../../bin/_run-approval.js");

const ROOT = path.resolve(__dirname, "../..");
const RUN_TEST = path.join(ROOT, "bin/run-test.sh");
const SCENARIO = "api/approval-probe";

let tmp: string;
let clientDir: string;
let clientName: string;
let trustedDir: string;
let attackerDir: string;
let stateHome: string;
let storeDir: string;
let reportsDir: string;

function stubK6(dir: string, marker: string): void {
  // Records who ran, then exits 0 without writing a summary (keeps post-processing short).
  const src = `#!/bin/sh\necho "$0" >> "${marker}"\necho "stub k6"\nexit 0\n`;
  fs.writeFileSync(path.join(dir, "k6"), src, { mode: 0o755 });
}

function runner(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["K6_BINARY_PATH", "K6_ALLOW_PROD_LOAD", "K6_PROFILE", "K6_ENV"]) delete env[k];
  Object.assign(env, {
    XDG_STATE_HOME: stateHome,
    K6_RBAC_PERMISSIVE: "true",
    PATH: `${attackerDir}:${process.env.PATH}`,
    ...extraEnv,
  });
  return spawnSync(
    "bash",
    [
      RUN_TEST,
      `--client=${clientName}`,
      `--scenario=${SCENARIO}`,
      "--skip-build",
      "--skip-validate",
      `--reports-dir=${reportsDir}`,
      ...args,
    ],
    { cwd: ROOT, encoding: "utf-8", timeout: 120_000, env }
  );
}

const out = (r: ReturnType<typeof spawnSync>) => `${r.stdout}\n${r.stderr}`;
const ran = (dir: string) =>
  fs.existsSync(path.join(dir, "ran")) && fs.readFileSync(path.join(dir, "ran"), "utf8");

function approve(fields: Partial<Record<string, string>> = {}, now = Date.now()) {
  const store = approval.openStore({ dir: storeDir, root: ROOT, create: true });
  return approval.createRecord(
    {
      client: clientName,
      scenario: SCENARIO,
      profile: "stress",
      env: "default",
      ttl: "4h",
      reason: "test",
      ...fields,
    },
    store,
    now
  );
}

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "k6approval-")));
  trustedDir = path.join(tmp, "trusted");
  attackerDir = path.join(tmp, "attacker");
  reportsDir = path.join(tmp, "reports");
  for (const d of [trustedDir, attackerDir, reportsDir]) fs.mkdirSync(d, { mode: 0o755 });
  stubK6(trustedDir, path.join(trustedDir, "ran"));
  stubK6(attackerDir, path.join(attackerDir, "ran"));

  clientDir = fs.mkdtempSync(path.join(ROOT, "clients/_test-approval-"));
  clientName = path.basename(clientDir);
  fs.mkdirSync(path.join(clientDir, "scenarios", "api"), { recursive: true });
  fs.mkdirSync(path.join(clientDir, "config"));
  fs.writeFileSync(
    path.join(clientDir, "scenarios", "api", "approval-probe.ts"),
    "export const options = { vus: 1, iterations: 1 };\nexport default function () {}\n"
  );
  fs.writeFileSync(
    path.join(clientDir, "config", "default.json"),
    JSON.stringify({
      client: clientName,
      trustedBinDirs: [trustedDir, path.dirname(fs.realpathSync(process.execPath))],
    })
  );
  const distDir = path.join(ROOT, "dist", clientName.replace(/^_/, ""), "api");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "approval-probe.js"), "export default function () {}\n");
});

beforeEach(() => {
  stateHome = fs.mkdtempSync(path.join(tmp, "state-"));
  storeDir = path.join(stateHome, "k6-framework", "approvals");
  for (const d of [trustedDir, attackerDir]) fs.rmSync(path.join(d, "ran"), { force: true });
});

afterAll(() => {
  for (const dir of [clientDir, tmp])
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const distDir = path.join(ROOT, "dist", clientName.replace(/^_/, ""));
  if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });
});

describe("run-test.sh — trusted k6 resolution", () => {
  it("non-guarded smoke needs no approval and runs the trusted k6, not the one first in PATH", () => {
    const r = runner(["--profile=smoke"]);
    expect(r.status, out(r)).toBe(0);
    expect(ran(trustedDir)).toContain(path.join(trustedDir, "k6"));
    expect(ran(attackerDir)).toBe(false);
  });

  it("ignores K6_BINARY_ALLOWED_PATHS and refuses a K6_BINARY_PATH outside trusted dirs", () => {
    const r = runner(["--profile=smoke"], {
      K6_BINARY_PATH: path.join(attackerDir, "k6"),
      K6_BINARY_ALLOWED_PATHS: attackerDir,
    });
    expect(r.status, out(r)).toBe(1);
    expect(out(r)).toMatch(/not in a trusted directory/);
    expect(ran(attackerDir)).toBe(false);
  });
});

describe("run-test.sh — human approval for guarded runs", () => {
  it("refuses a heavy profile without approval with exit 109 and approve-run instructions", () => {
    const r = runner(["--profile=stress"]);
    expect(r.status, out(r)).toBe(109);
    expect(out(r)).toContain("./bin/approve-run.sh");
    expect(ran(trustedDir)).toBe(false);
  });

  it("treats a non-listed env and production load as guarded", () => {
    expect(runner(["--profile=smoke", "--env=perf-lab"]).status).toBe(109);
    expect(runner(["--profile=smoke"], { K6_ALLOW_PROD_LOAD: "true" }).status).toBe(109);
  });

  it("runs once with a valid approval, records it, and refuses the second run", () => {
    const { rec } = approve();
    const first = runner(["--profile=stress"]);
    expect(first.status, out(first)).toBe(0);
    expect(ran(trustedDir)).toBeTruthy();
    expect(fs.existsSync(path.join(storeDir, "consumed", `${rec.id}.json`))).toBe(true);
    const artifacts = fs.readdirSync(path.join(reportsDir, clientName, "api_approval-probe"));
    const recFile = artifacts.find((f) => f.startsWith("approval-"));
    expect(recFile).toBeDefined();
    const saved = JSON.parse(
      fs.readFileSync(path.join(reportsDir, clientName, "api_approval-probe", recFile!), "utf8")
    );
    expect(saved.id).toBe(rec.id);
    expect(saved.hmac).toBeUndefined();

    const second = runner(["--profile=stress"]);
    expect(second.status, out(second)).toBe(109);
  });

  it("refuses an expired approval", () => {
    approve({ ttl: "1h" }, Date.now() - 2 * 3600e3);
    expect(runner(["--profile=stress"]).status).toBe(109);
  });

  it("refuses a tampered approval (HMAC mismatch)", () => {
    const { file } = approve({ profile: "spike" });
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    rec.profile = "stress";
    fs.writeFileSync(file, JSON.stringify(rec));
    const r = runner(["--profile=stress"]);
    expect(r.status).toBe(109);
    expect(out(r)).toContain("bad HMAC");
  });

  it("refuses an approval for another profile or env", () => {
    approve({ profile: "spike" });
    approve({ env: "staging" });
    const r = runner(["--profile=stress"]);
    expect(r.status).toBe(109);
    expect(out(r)).toMatch(/profile mismatch/);
    expect(out(r)).toMatch(/env mismatch/);
  });

  it("refuses a world-writable approval file", () => {
    const { file } = approve();
    fs.chmodSync(file, 0o666);
    const r = runner(["--profile=stress"]);
    expect(r.status).toBe(109);
    expect(out(r)).toMatch(/unsafe permissions/);
  });
});

describe("approval store (bin/_run-approval.js)", () => {
  it("refuses a store inside the repository", () => {
    expect(() =>
      approval.openStore({ dir: path.join(ROOT, "reports", "x"), root: ROOT, create: false })
    ).toThrow(/inside the repository/);
  });

  it("refuses a group-readable secret", () => {
    const store = approval.openStore({ dir: storeDir, root: ROOT, create: true });
    fs.chmodSync(path.join(store.dir, ".secret"), 0o640);
    expect(() => approval.openStore({ dir: storeDir, root: ROOT })).toThrow(/unsafe permissions/);
  });

  it("creates the store 0700 and records 0600", () => {
    const { file } = approve();
    expect(fs.statSync(storeDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("caps the ttl at 24h", () => {
    expect(() => approval.parseTtl("25h")).toThrow();
    expect(approval.parseTtl("30m")).toBe(30 * 60e3);
  });
});

describe("bin/approve-run.sh", () => {
  it("refuses without an interactive terminal", () => {
    const r = spawnSync(
      "bash",
      [
        path.join(ROOT, "bin/approve-run.sh"),
        `--scenario=${SCENARIO}`,
        "--profile=stress",
        "--env=default",
      ],
      {
        encoding: "utf-8",
        input: "",
        env: { ...process.env, XDG_STATE_HOME: stateHome },
      }
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/interactive terminal/);
    expect(fs.existsSync(storeDir)).toBe(false);
  });

  it("the approve subcommand also refuses without a TTY (no bypass around the wrapper)", () => {
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "bin/_run-approval.js"),
        "approve",
        `--client=${clientName}`,
        `--scenario=${SCENARIO}`,
        "--profile=stress",
        "--env=default",
        `--root=${ROOT}`,
      ],
      { encoding: "utf-8", input: "", env: { ...process.env, XDG_STATE_HOME: stateHome } }
    );
    expect(r.status).toBe(2);
    expect(fs.existsSync(storeDir)).toBe(false);
  });
});

// Linux util-linux `script` gives the wrapper a pseudo-terminal, like a human's shell.
const hasScript = process.platform === "linux" && spawnSync("script", ["--version"]).status === 0;

function approveInPty(
  answer: (code: string) => string
): Promise<{ code: number | null; output: string }> {
  const cmd = `bash ${path.join(ROOT, "bin/approve-run.sh")} --client=${clientName} --scenario=${SCENARIO} --profile=stress --env=default --ttl=1h --reason=e2e`;
  return new Promise((resolve) => {
    const child = spawn("script", ["-qec", cmd, "/dev/null"], {
      env: { ...process.env, XDG_STATE_HOME: stateHome },
    });
    let output = "";
    let answered = false;
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
      const m = /Type ([A-Z0-9]{6}) to approve/.exec(output);
      if (m && !answered) {
        answered = true;
        child.stdin.write(answer(m[1]) + "\n");
      }
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe.skipIf(!hasScript)("bin/approve-run.sh — interactive terminal", () => {
  it("writes nothing when the typed code does not match", async () => {
    const r = await approveInPty(() => "WRONG1");
    expect(r.code, r.output).toBe(1);
    const files = fs.existsSync(storeDir)
      ? fs.readdirSync(storeDir).filter((f) => f.endsWith(".json"))
      : [];
    expect(files).toHaveLength(0);
  });

  it("with the right code, writes an approval the runner accepts once", async () => {
    const r = await approveInPty((code) => code);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain(`scenario   ${SCENARIO}`);
    expect(runner(["--profile=stress"]).status).toBe(0);
    expect(runner(["--profile=stress"]).status).toBe(109);
  });
});

describe("run-distributed.sh — guarded runs", () => {
  it("refuses a heavy distributed run without approval before touching the cluster", () => {
    const r = spawnSync(
      "bash",
      [
        path.join(ROOT, "bin/run-distributed.sh"),
        `--client=${clientName}`,
        `--scenario=${SCENARIO}`,
        "--profile=stress",
        "--image=registry.example.com/k6:test",
      ],
      {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 60_000,
        env: { ...process.env, XDG_STATE_HOME: stateHome },
      }
    );
    expect(r.status, out(r)).toBe(109);
    expect(out(r)).not.toMatch(/kubectl not found|Pre-flight checks/);
  });
});
