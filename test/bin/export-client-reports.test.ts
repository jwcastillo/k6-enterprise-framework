/**
 * bin/export-client.sh --with-reports must ship everything the report
 * generators need to run in a standalone repo: bin/_help.js (required by
 * --help) and a TS loader (tsx) for generate-artifacts.js's source fallback.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ROOT = path.resolve(__dirname, "../..");
const EXPORT_SCRIPT = path.join(ROOT, "bin/export-client.sh");
const FIXTURE_SRC = path.join(ROOT, "test/fixtures/client-with-legacy-tests-layout");

describe("bin/export-client.sh --with-reports", () => {
  let stagedClient: string;
  let outputDir: string;

  beforeAll(() => {
    stagedClient = path.join(ROOT, "clients/_test-export-reports");
    fs.rmSync(stagedClient, { recursive: true, force: true });
    fs.cpSync(FIXTURE_SRC, stagedClient, { recursive: true });
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "export-reports-"));
    const res = spawnSync(
      "bash",
      [EXPORT_SCRIPT, "--client=_test-export-reports", `--output=${outputDir}`, "--skip-validate", "--force", "--with-reports"],
      { encoding: "utf-8", cwd: ROOT }
    );
    if (res.status !== 0) {
      throw new Error(`export-client.sh failed (status=${res.status})\nstderr: ${res.stderr}\nstdout: ${res.stdout}`);
    }
  });

  afterAll(() => {
    fs.rmSync(stagedClient, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it("copies bin/_help.js next to the generators", () => {
    expect(fs.existsSync(path.join(outputDir, "framework/bin/generate-artifacts.js"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "framework/bin/_help.js"))).toBe(true);
  });

  it("generate-artifacts.js --help works from the export", () => {
    const res = spawnSync("node", [path.join(outputDir, "framework/bin/generate-artifacts.js"), "--help"], {
      encoding: "utf-8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("generate-artifacts");
  });

  it("declares tsx as a devDependency (TS fallback loader)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(outputDir, "package.json"), "utf-8"));
    expect(pkg.devDependencies.tsx).toBeDefined();
  });
});
