/**
 * bin/update-framework.sh — the updater export-client.sh ships to standalone repos.
 * Runs the real script against a temp fake monorepo and a temp fake standalone repo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../bin/update-framework.sh");

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

let tmp: string;
let mono: string;
let standalone: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "update-fw-"));
  mono = path.join(tmp, "monorepo");
  standalone = path.join(tmp, "standalone");

  write(path.join(mono, "package.json"), JSON.stringify({ version: "9.9.9" }));
  write(path.join(mono, "src/index.ts"), 'export * from "./core/index";\nexport * from "./ai/index";\n');
  write(path.join(mono, "src/core/index.ts"), "export const core = 2;\n");
  write(path.join(mono, "src/ai/index.ts"), "export const upstreamAi = true;\n");
  write(path.join(mono, "shared/profiles/smoke.json"), '{"vus":2}\n');
  write(path.join(mono, "shared/schemas/client-config.schema.json"), '{"type":"object"}\n');
  write(path.join(mono, "bin/validate-config.js"), "// new\n");

  write(path.join(standalone, "framework/VERSION"), "1.0.0\n");
  write(path.join(standalone, "framework/src/index.ts"), 'export * from "./core/index";\n');
  write(path.join(standalone, "framework/src/core/index.ts"), "export const core = 1;\n");
  write(path.join(standalone, "framework/shared/profiles/smoke.json"), '{"vus":1}\n');
  write(path.join(standalone, "framework/shared/schemas/client-config.schema.json"), "{}\n");
  fs.mkdirSync(path.join(standalone, "framework/bin"), { recursive: true });
  write(path.join(standalone, "scenarios/api/mine.ts"), "// client file\n");
  fs.mkdirSync(path.join(standalone, "bin"));
  fs.copyFileSync(SCRIPT, path.join(standalone, "bin/update-framework.sh"));
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function update() {
  return spawnSync("bash", [path.join(standalone, "bin/update-framework.sh"), `--from=${mono}`, "--yes"], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

const read = (rel: string) => fs.readFileSync(path.join(standalone, rel), "utf8");

describe("update-framework.sh", () => {
  it("runs to completion when there are differences (diff exit 1 under pipefail)", () => {
    const res = update();
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Framework updated/);
    expect(read("framework/src/core/index.ts")).toContain("core = 2");
    expect(read("framework/shared/profiles/smoke.json")).toContain('"vus":2');
    expect(read("framework/VERSION").trim()).toBe("9.9.9");
    expect(read("scenarios/api/mine.ts")).toBe("// client file\n");
  });

  it("strips the AI re-export from the barrel and does not vendor src/ai", () => {
    expect(update().status).toBe(0);
    const barrel = read("framework/src/index.ts");
    expect(barrel).not.toMatch(/ai\/index/);
    expect(barrel).toContain('export * from "./core/index";');
    expect(fs.existsSync(path.join(standalone, "framework/src/ai"))).toBe(false);
  });

  it("refreshes the framework/bin scripts and bin/ guards the repo has, and nothing else", () => {
    write(path.join(mono, "bin/generate-artifacts.js"), "// artifacts v2\n");
    write(path.join(mono, "bin/discover-flow.js"), "// discover v2\n");
    write(path.join(mono, "bin/_shell-guard.js"), "// guard v2\n");
    write(path.join(mono, "bin/_run-guard.sh"), "# run guard v2\n");
    write(path.join(mono, "bin/target-guard.js"), "// target v2\n");
    write(path.join(standalone, "framework/bin/generate-artifacts.js"), "// artifacts v1\n");
    write(path.join(standalone, "bin/_shell-guard.js"), "// guard v1\n");
    write(path.join(standalone, "bin/target-guard.js"), "// target adapted\n");

    const res = update();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/_shell-guard\.js/);
    expect(read("framework/bin/generate-artifacts.js")).toBe("// artifacts v2\n");
    expect(read("bin/_shell-guard.js")).toBe("// guard v2\n");
    // not present in the repo: not added
    expect(fs.existsSync(path.join(standalone, "framework/bin/discover-flow.js"))).toBe(false);
    expect(fs.existsSync(path.join(standalone, "bin/_run-guard.sh"))).toBe(false);
    // adapted by clients: left alone
    expect(read("bin/target-guard.js")).toBe("// target adapted\n");
  });

  it("updates when only a bin/ guard changed", () => {
    // bring src/shared in line so the guard is the only difference
    write(path.join(standalone, "framework/src/core/index.ts"), "export const core = 2;\n");
    write(path.join(standalone, "framework/shared/profiles/smoke.json"), '{"vus":2}\n');
    write(path.join(standalone, "framework/shared/schemas/client-config.schema.json"), '{"type":"object"}\n');
    write(path.join(standalone, "framework/src/index.ts"), 'export * from "./core/index";\nexport * from "./ai/index";\n');
    fs.cpSync(path.join(mono, "src/ai"), path.join(standalone, "framework/src/ai"), { recursive: true });
    write(path.join(mono, "bin/_shell-guard.js"), "// guard v2\n");
    write(path.join(standalone, "bin/_shell-guard.js"), "// guard v1\n");

    const res = update();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toMatch(/already up to date/);
    expect(read("bin/_shell-guard.js")).toBe("// guard v2\n");
  });

  it("keeps a framework/src/ai the standalone repo vendored with local patches", () => {
    write(path.join(standalone, "framework/src/ai/index.ts"), "export const locallyPatched = true;\n");
    expect(update().status).toBe(0);
    expect(read("framework/src/ai/index.ts")).toBe("export const locallyPatched = true;\n");
    expect(read("framework/src/index.ts")).not.toMatch(/ai\/index/);
  });
});
