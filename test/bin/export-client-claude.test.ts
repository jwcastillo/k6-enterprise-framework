/**
 * bin/export-client.sh --with-claude must ship the guardrails the exported agents and
 * hooks rely on (generation gate, skill scan + baselines, hooks + project settings) and
 * must not pre-approve a bare k6 run or arbitrary node scripts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const EXPORT_SCRIPT = path.join(ROOT, "bin/export-client.sh");

describe("bin/export-client.sh --with-claude (_reference)", () => {
  let out: string;
  const exists = (rel: string) => fs.existsSync(path.join(out, rel));

  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), "export-claude-"));
    const res = spawnSync(
      "bash",
      [EXPORT_SCRIPT, "--client=_reference", `--output=${out}`, "--skip-validate", "--force", "--with-claude"],
      { encoding: "utf-8", cwd: ROOT, timeout: 120_000 }
    );
    if (res.status !== 0) throw new Error(`export-client.sh failed (${res.status})\n${res.stderr}\n${res.stdout}`);
  }, 120_000);

  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it("exports the generation gate and the skill scan next to the runner", () => {
    for (const f of ["validate-generated.js", "_secret-patterns.js", "_help.js", "scan-skills.sh", "agent-bash-guard.js"]) {
      expect(exists(`bin/${f}`), f).toBe(true);
    }
    const baselines = fs.readdirSync(path.join(ROOT, "security/baselines")).filter((f) => f.endsWith(".yaml"));
    expect(baselines.length).toBeGreaterThan(0);
    for (const b of baselines) expect(exists(`security/baselines/${b}`), b).toBe(true);
    expect(exists("security/skillspector-triage.md")).toBe(true);
  });

  it("exports the hooks and a settings.json that registers them and the plugin", () => {
    expect(exists(".claude/hooks/guardrails.js")).toBe(true);
    const settings = JSON.parse(fs.readFileSync(path.join(out, ".claude/settings.json"), "utf8"));
    const commands = JSON.stringify(settings.hooks);
    expect(commands).toContain("$CLAUDE_PROJECT_DIR/.claude/hooks/guardrails.js");
    expect(Object.keys(settings.hooks)).toEqual(expect.arrayContaining(["PreToolUse", "PostToolUse"]));
    expect(settings.enabledPlugins).toBeDefined();
    expect(settings.extraKnownMarketplaces).toBeDefined();
  });

  it("does not pre-approve a bare k6 run or blanket node", () => {
    expect(exists(".claude/settings.local.json")).toBe(false);
    const allow: string[] = JSON.parse(fs.readFileSync(path.join(out, ".claude/settings.json"), "utf8")).permissions.allow;
    expect(allow).toContain("Bash(./bin/run-test.sh:*)");
    expect(allow.some((a) => /k6 run/.test(a))).toBe(false);
    expect(allow).not.toContain("Bash(node:*)");
  });

  it("the exported hook runs the exported gate on scenario edits (standalone layout)", () => {
    fs.mkdirSync(path.join(out, "scenarios/api"), { recursive: true });
    fs.writeFileSync(
      path.join(out, "scenarios/api/no-thresholds.ts"),
      'import http from "k6/http";\nexport const options = { vus: 1 };\nexport default function () { http.get(`${__ENV.BASE_URL}/`); }\n'
    );
    fs.writeFileSync(
      path.join(out, "scenarios/api/shared-options.ts"),
      'import http from "k6/http";\nexport { options } from "../../lib/options";\nexport default function () { http.get(`${__ENV.BASE_URL}/`); }\n'
    );
    const hook = (file: string) =>
      spawnSync(process.execPath, [path.join(out, ".claude/hooks/guardrails.js"), "post-scenario"], {
        input: JSON.stringify({ tool_input: { file_path: path.join(out, file) } }),
        encoding: "utf8",
        cwd: out,
        timeout: 30_000,
      });

    const blocked = hook("scenarios/api/no-thresholds.ts");
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/thresholds/);
    expect(hook("scenarios/api/shared-options.ts").status).toBe(0);
  });

  it("the exported bash hook hint does not mention --client", () => {
    const res = spawnSync(process.execPath, [path.join(out, ".claude/hooks/guardrails.js"), "bash"], {
      input: JSON.stringify({ tool_input: { command: ["k6", "run", "x.js"].join(" ") } }),
      encoding: "utf8",
    });
    expect(res.status).toBe(2);
    expect(res.stderr).not.toContain("--client");
  });

  it("CLAUDE.md and README mention the gate and the hooks", () => {
    for (const f of [".claude/CLAUDE.md", "README.md"]) {
      const text = fs.readFileSync(path.join(out, f), "utf8");
      expect(text, f).toContain("validate-generated.js");
      expect(text, f).toContain("guardrails.js");
    }
  });
});
