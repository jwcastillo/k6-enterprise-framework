/**
 * bin/run-regression.sh invokes a runner that does not exist; it must fail fast
 * with a clear "not implemented" message instead of a confusing k6 error.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("bin/run-regression.sh", () => {
  it("fails fast with exit 2 and a not-implemented message", () => {
    const res = spawnSync("bash", [path.join(ROOT, "bin/run-regression.sh"), "--suite=nightly", "--client=any"], {
      encoding: "utf-8",
      cwd: ROOT,
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("not implemented");
  });

  it("still prints --help", () => {
    const res = spawnSync("bash", [path.join(ROOT, "bin/run-regression.sh"), "--help"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
  });
});
