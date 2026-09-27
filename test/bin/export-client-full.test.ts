/**
 * bin/export-client.sh --full on this platform (Linux in CI): the binary-builder
 * section used BSD-only `sed -i ''`, which aborts under GNU sed, and .tool-versions
 * said `nodejs lts`, which asdf cannot install. Nothing here needs Go: the export
 * only copies the builder sources.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const EXPORT_SCRIPT = path.join(ROOT, "bin/export-client.sh");

describe("bin/export-client.sh --full (_reference)", () => {
  let out: string;
  let res: ReturnType<typeof spawnSync>;

  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), "export-full-"));
    res = spawnSync("bash", [EXPORT_SCRIPT, "--client=_reference", `--output=${out}`, "--skip-validate", "--force", "--full"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 240_000,
    });
  }, 300_000);

  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it("completes and fills the client name into the binary README section", () => {
    expect(res.status, String(res.stderr) + String(res.stdout).slice(-2000)).toBe(0);
    const readme = fs.readFileSync(path.join(out, "README.md"), "utf8");
    expect(readme).not.toContain("k6-<client>");
    expect(readme).toContain("k6-_reference");
    expect(fs.existsSync(path.join(out, "README.md.bak"))).toBe(false);
  });

  it("pins .tool-versions to the monorepo's versions", () => {
    const pins = (file: string) =>
      Object.fromEntries(
        fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => l.trim().split(/\s+/))
      );
    const exported = pins(path.join(out, ".tool-versions"));
    const root = pins(path.join(ROOT, ".tool-versions"));
    expect(exported.nodejs).toBe(root.nodejs);
    expect(exported.nodejs).toMatch(/^\d+\.\d+\.\d+$/);
    if (root.golang) expect(exported.golang).toBe(root.golang); // --full includes the binary builder
  });
});
