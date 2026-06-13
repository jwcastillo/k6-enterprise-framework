/**
 * E2E test for TST-06 (Phase 2): bin/export-client.sh does NOT include tests/
 * directory in exports anymore.
 *
 * Phase 1 (EXP-01) added "tests" to the export list as a quick-fix while
 * clients/<name>/tests/ still existed as a duplicate layer alongside scenarios/.
 * Phase 2 (TST-04, TST-06) unified the layout so scenarios/ is the only
 * source-of-truth. This test was inverted accordingly: it now asserts that
 * a fixture client containing a legacy `tests/` layout sees that directory
 * dropped from the export, AND that the manifest no longer carries a
 * `tests` count field.
 *
 * Fixture renamed per D-39 (REPURPOSE):
 *   test/fixtures/client-with-tests           -> client-with-legacy-tests-layout
 *
 * Verified CLI flag names for bin/export-client.sh:
 *   --client=<name>, --output=<path>, --skip-validate, --force
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ROOT = path.resolve(__dirname, "../..");
const EXPORT_SCRIPT = path.join(ROOT, "bin/export-client.sh");
const FIXTURE_SRC = path.join(ROOT, "test/fixtures/client-with-legacy-tests-layout");

function countFilesRec(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFilesRec(p);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

describe("bin/export-client.sh tests/ exclusion (TST-06, post-unification)", () => {
  let stagedClient: string;
  let outputDir: string;

  beforeAll(() => {
    stagedClient = path.join(ROOT, "clients/_test-tst06");
    if (fs.existsSync(stagedClient)) fs.rmSync(stagedClient, { recursive: true, force: true });
    fs.cpSync(FIXTURE_SRC, stagedClient, { recursive: true });

    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tst06-export-"));

    // Run the exporter once for all assertions.
    const res = spawnSync(
      "bash",
      [
        EXPORT_SCRIPT,
        `--client=_test-tst06`,
        `--output=${outputDir}`,
        "--skip-validate",
        "--force",
      ],
      { encoding: "utf-8", cwd: ROOT }
    );
    if (res.status !== 0) {
      throw new Error(`export-client.sh failed (status=${res.status})\nstderr: ${res.stderr}\nstdout: ${res.stdout}`);
    }
  });

  afterAll(() => {
    if (stagedClient && fs.existsSync(stagedClient)) {
      fs.rmSync(stagedClient, { recursive: true, force: true });
    }
    if (outputDir && fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("source fixture still has a legacy tests/ directory (negative-test pre-condition)", () => {
    const sourceTestsCount = countFilesRec(path.join(stagedClient, "tests"));
    expect(sourceTestsCount).toBeGreaterThanOrEqual(1);
  });

  it("export output does NOT contain a tests/ directory", () => {
    expect(fs.existsSync(path.join(outputDir, "tests"))).toBe(false);
  });

  it("export-manifest.json filesExported does NOT carry a 'tests' field", () => {
    const manifestPath = path.join(outputDir, "export-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.filesExported).toBeDefined();
    expect(manifest.filesExported.tests).toBeUndefined();
  });

  it("export still copies canonical optional dirs (scenarios/, config/)", () => {
    expect(fs.existsSync(path.join(outputDir, "scenarios"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "config"))).toBe(true);
  });
});
