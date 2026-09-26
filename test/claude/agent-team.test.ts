/**
 * Claude Code agent team — frontmatter contract for .claude/agents and .claude/skills,
 * and the Bash guard the agents use as a PreToolUse hook.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import yaml from "js-yaml";

const { decide } = require("../../bin/agent-bash-guard.js");

const ROOT = join(__dirname, "..", "..");
const AGENTS_DIR = join(ROOT, ".claude", "agents");
const SKILLS_DIR = join(ROOT, ".claude", "skills");
const MAX_DESCRIPTION = 1536; // Claude Code truncates description + when_to_use here

function frontmatter(file: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"));
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  return yaml.load(match[1]) as Record<string, unknown>;
}

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, "SKILL.md")))
  .map((d) => d.name);
const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

describe("skills frontmatter", () => {
  it.each(skillDirs)("%s has a name matching its directory and a bounded description", (dir) => {
    const fm = frontmatter(join(SKILLS_DIR, dir, "SKILL.md"));
    expect(fm.name).toBe(dir);
    expect(typeof fm.description).toBe("string");
    expect((fm.description as string).length).toBeGreaterThan(40);
    expect((fm.description as string).length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });
});

describe("agents frontmatter", () => {
  it("defines the team", () => {
    expect(agentFiles.length).toBeGreaterThanOrEqual(9);
  });

  it.each(agentFiles)("%s is a valid subagent whose skills exist", (file) => {
    const fm = frontmatter(join(AGENTS_DIR, file));
    expect(fm.name).toBe(basename(file, ".md"));
    expect(String(fm.name)).not.toContain(":");
    expect(typeof fm.description).toBe("string");
    expect(typeof fm.tools).toBe("string");
    expect(fm.model).toBeTruthy();
    expect(Array.isArray(fm.skills)).toBe(true);
    for (const skill of fm.skills as string[]) {
      expect(skillDirs, `${file} references missing skill ${skill}`).toContain(skill);
    }
    const hooks = JSON.stringify(fm.hooks ?? {});
    if (hooks.includes("agent-bash-guard")) {
      expect(existsSync(join(ROOT, "bin", "agent-bash-guard.js"))).toBe(true);
    }
  });

  it("the reviewer cannot edit files", () => {
    const fm = frontmatter(join(AGENTS_DIR, "perf-guardrail-reviewer.md"));
    expect(fm.tools).not.toMatch(/\b(Edit|Write)\b/);
  });

  it("the perf-team orchestrator names every agent", () => {
    const team = readFileSync(join(SKILLS_DIR, "perf-team", "SKILL.md"), "utf8");
    for (const file of agentFiles) expect(team).toContain(basename(file, ".md"));
  });
});

describe("agent-bash-guard", () => {
  it.each([
    "node bin/validate-generated.js --kind=scenario clients/_reference/scenarios/api/smoke-users.ts",
    "./bin/detect-secrets.sh src clients",
    "skillspector scan .claude/agents --recursive --no-llm",
    "pnpm lint",
    "git diff --stat",
  ])("reviewer allows %s", (cmd) => {
    expect(decide("reviewer", cmd).decision).toBe("allow");
  });

  it.each([
    "rm -rf reports",
    "pnpm lint && git push",
    "git diff > out.patch",
    "echo $(cat .env)",
    "skillspector scan .claude --no-llm --output x.json",
    "node bin/run-test.sh",
  ])("reviewer denies %s", (cmd) => {
    expect(decide("reviewer", cmd).decision).toBe("deny");
  });

  it.each(["k6 run dist/x.js", "cd dist && k6 cloud x.js", "K6_ALLOW_PROD_LOAD=true ./bin/run-test.sh --profile=smoke"])(
    "operator denies %s",
    (cmd) => {
      expect(decide("operator", cmd).decision).toBe("deny");
    }
  );

  it.each([
    "./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=stress",
    "./bin/run-test.sh --scenario=api/x --profile=smoke --unsafe",
    "./bin/run-test.sh --scenario=api/x --profile=smoke --env=production",
    "./bin/run-distributed.sh --client=c --scenario=api/x --parallelism=4",
    "helm install k6 infrastructure/k8s/helm/k6-enterprise",
    "kubectl delete testrun k6-load-test -n k6-tests",
  ])("operator asks the human for %s", (cmd) => {
    expect(decide("operator", cmd).decision).toBe("ask");
  });

  it.each([
    "./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke",
    "./bin/run-distributed.sh --help",
    "kubectl get testrun -n k6-tests",
  ])("operator allows %s", (cmd) => {
    expect(decide("operator", cmd).decision).toBe("allow");
  });

  it("discoverer asks before every discovery run", () => {
    expect(decide("discoverer", "node bin/discover-flow.js --url=https://staging.example.com").decision).toBe("ask");
    expect(decide("discoverer", "node bin/discover-flow.js --help").decision).toBe("allow");
  });

  it("unknown profiles fail closed", () => {
    expect(decide("nobody", "ls").decision).toBe("deny");
  });
});
