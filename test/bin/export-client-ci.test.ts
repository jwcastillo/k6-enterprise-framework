/**
 * H19: the repo bin/export-client.sh generates must pass its own CI on the first push.
 *
 * Guards the generated .github/workflows/k6.yml and .gitlab-ci.yml against the
 * regressions that broke it: `npm ci` with no package-lock.json (the export uses
 * pnpm), workflow inputs interpolated into run: scripts (shell injection),
 * `typecheck || true`, a default scenario the export does not contain, and heavy
 * profiles in the CI menu (they exit 109 without a human approval).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "../..");
const EXPORT_SCRIPT = path.join(ROOT, "bin/export-client.sh");
const CREATE_SCRIPT = path.join(ROOT, "bin/create-client.sh");
const CLIENT = "_test-export-ci";
const HEAVY = ["stress", "spike", "breakpoint", "soak", "capacity", "throughput-high", "throughput-ramp"];

type Step = { name?: string; run?: string; env?: Record<string, string>; if?: string };
type Workflow = {
  on: { workflow_dispatch: { inputs: { scenario: { default: string }; profile: { options: string[] } } } };
  jobs: Record<string, { steps: Step[] }>;
};

function exportWith(ci: string, outDir: string): void {
  const res = spawnSync(
    "bash",
    [EXPORT_SCRIPT, `--client=${CLIENT}`, `--output=${outDir}`, `--ci=${ci}`, "--skip-validate", "--force"],
    { encoding: "utf-8", cwd: ROOT }
  );
  if (res.status !== 0) {
    throw new Error(`export-client.sh failed (status=${res.status})\nstderr: ${res.stderr}\nstdout: ${res.stdout}`);
  }
}

describe("bin/export-client.sh generated CI (H19)", () => {
  const clientDir = path.join(ROOT, "clients", CLIENT);
  let ghDir: string;
  let glDir: string;
  let ghText: string;
  let steps: Step[];
  let wf: Workflow;
  let glText: string;

  beforeAll(() => {
    if (fs.existsSync(clientDir)) fs.rmSync(clientDir, { recursive: true, force: true });
    const res = spawnSync("bash", [CREATE_SCRIPT, CLIENT, "--service=users"], { encoding: "utf-8", cwd: ROOT });
    if (res.status !== 0) throw new Error(`create-client.sh failed: ${res.stderr}`);

    ghDir = fs.mkdtempSync(path.join(os.tmpdir(), "h19-gh-"));
    glDir = fs.mkdtempSync(path.join(os.tmpdir(), "h19-gl-"));
    exportWith("github", ghDir);
    exportWith("gitlab", glDir);

    ghText = fs.readFileSync(path.join(ghDir, ".github/workflows/k6.yml"), "utf-8");
    wf = yaml.load(ghText) as Workflow;
    steps = wf.jobs["load-test"].steps;
    glText = fs.readFileSync(path.join(glDir, ".gitlab-ci.yml"), "utf-8");
  }, 120_000);

  afterAll(() => {
    for (const d of [clientDir, ghDir, glDir]) {
      if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("never uses `npm ci` (no package-lock.json is exported) and installs with pnpm", () => {
    expect(fs.existsSync(path.join(ghDir, "package-lock.json"))).toBe(false);
    for (const text of [ghText, glText]) {
      expect(text).not.toMatch(/\bnpm ci\b/);
      expect(text).toMatch(/pnpm install --frozen-lockfile/);
    }
    // Frozen install only when the lockfile is there (--skip-validate exports have none).
    expect(ghText).toMatch(/if \[ -f pnpm-lock\.yaml \]; then/);
    const pkg = JSON.parse(fs.readFileSync(path.join(ghDir, "package.json"), "utf-8"));
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(ghText).toMatch(/pnpm\/action-setup@[0-9a-f]{40}/);
  });

  it("never interpolates ${{ }} expressions inside run: scripts", () => {
    const offenders = steps.filter((s) => typeof s.run === "string" && s.run.includes("${{"));
    expect(offenders.map((s) => s.name)).toEqual([]);
    const runStep = steps.find((s) => s.run?.includes("./bin/run-test.sh"));
    expect(runStep?.env?.SCENARIO).toMatch(/inputs\.scenario/);
    expect(runStep?.env?.PROFILE).toMatch(/inputs\.profile/);
  });

  it("typecheck fails the job (no `|| true`)", () => {
    for (const text of [ghText, glText]) {
      expect(text).toMatch(/pnpm run typecheck/);
      expect(text).not.toMatch(/typecheck\s*\|\|\s*true/);
    }
  });

  it("defaults to a scenario that exists in the export", () => {
    const def = wf.on.workflow_dispatch.inputs.scenario.default;
    expect(def).toBe("api/smoke-users");
    expect(fs.existsSync(path.join(ghDir, "scenarios", `${def}.ts`))).toBe(true);
    expect(ghText).not.toMatch(/health-check|__DEFAULT_SCENARIO__/);
    expect(glText).toMatch(/SCENARIO: "api\/smoke-users"/);
  });

  it("offers only profiles CI can run (no heavy ones)", () => {
    const options = wf.on.workflow_dispatch.inputs.profile.options;
    expect(options).toContain("smoke");
    for (const p of options) {
      expect(HEAVY).not.toContain(p);
      expect(fs.existsSync(path.join(ROOT, "shared/profiles", `${p}.json`))).toBe(true);
    }
  });

  it("ships the mock server the CI falls back to and the target guard", () => {
    expect(fs.existsSync(path.join(ghDir, "framework/bin/mock-server.js"))).toBe(true);
    const routes = JSON.parse(fs.readFileSync(path.join(ghDir, "mock/routes.json"), "utf-8"));
    expect(routes).toContainEqual(expect.objectContaining({ method: "GET", path: "/api/users" }));
    expect(fs.existsSync(path.join(ghDir, "bin/target-guard.js"))).toBe(true);
    const runner = fs.readFileSync(path.join(ghDir, "bin/run-test.sh"), "utf-8");
    expect(runner).toMatch(/target-guard\.js/);
    const readme = fs.readFileSync(path.join(ghDir, "README.md"), "utf-8");
    expect(readme).toMatch(/RBAC and CLI auth/);
  });
});
