/**
 * bin/trend-analysis.js must find the summaries bin/run-test.sh writes:
 * reports/<client>/<scenario-slug>/summary-<YYYYMMDD-HHmmss>.json.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = "_test-trend";
const REPORTS = path.join(ROOT, "reports", CLIENT);

describe("bin/trend-analysis.js", () => {
  beforeAll(() => {
    const dir = path.join(REPORTS, "api_smoke");
    fs.mkdirSync(dir, { recursive: true });
    [200, 260].forEach((p95, i) =>
      fs.writeFileSync(
        path.join(dir, `summary-2026010${i + 1}-120000.json`),
        JSON.stringify({
          metrics: {
            http_req_duration: { avg: p95 / 2, "p(95)": p95, "p(99)": p95 * 1.2 },
            http_req_failed: { passes: 0, fails: 10, value: 0 },
            http_reqs: { count: 10, rate: 1 },
          },
        })
      )
    );
  });

  afterAll(() => fs.rmSync(REPORTS, { recursive: true, force: true }));

  it("analyzes run-test.sh summaries for a scenario path", () => {
    const res = spawnSync(
      "node",
      [path.join(ROOT, "bin/trend-analysis.js"), `--client=${CLIENT}`, "--test=api/smoke"],
      { encoding: "utf-8", cwd: ROOT }
    );
    expect(res.stderr).not.toContain("Need at least 2 runs");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("260");
  });
});
