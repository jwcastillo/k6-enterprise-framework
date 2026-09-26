/**
 * get_test_history must read what bin/run-test.sh writes:
 * reports/<client>/<scenario-slug>/summary-<YYYYMMDD-HHmmss>.json, in the
 * --summary-export shape (flat "p(95)", rate metrics as "value").
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getTestHistory } from "../src/tools/ai-tools.js";
import { FRAMEWORK_ROOT, cliTimeoutMs } from "../src/utils/framework.js";

const CLIENT = "_test-mcp-history";
const clientDir = join(FRAMEWORK_ROOT, "reports", CLIENT);

describe("get_test_history", () => {
  beforeAll(() => {
    const dir = join(clientDir, "api_smoke");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "summary-20260101-120000.json"),
      JSON.stringify({
        reportMeta: { timestamp: "20260101-120000", exitCode: 0 },
        metrics: {
          http_req_duration: { avg: 100, "p(95)": 250.5 },
          http_req_failed: { passes: 1, fails: 99, value: 0.01 },
          http_reqs: { count: 100, rate: 10 },
          vus_max: { value: 5, min: 5, max: 5 },
        },
      })
    );
    writeFileSync(
      join(dir, "summary-20260102-120000.json"),
      JSON.stringify({ reportMeta: { exitCode: 99 }, metrics: {} })
    );
    writeFileSync(join(dir, "summary-20260102-120000.txt"), "not json");
  });

  afterAll(() => rmSync(clientDir, { recursive: true, force: true }));

  it("reads summary-<ISO>.json files and the k6 p(95) key", () => {
    const res = getTestHistory({ client: CLIENT, test: "api/smoke" });
    expect(res.total).toBe(2);
    const [latest, first] = res.entries;
    expect(latest.status).toBe("fail");
    expect(first).toMatchObject({
      runId: `${CLIENT}/api_smoke/20260101-120000`,
      status: "pass",
      metrics: { p95Ms: 250.5, errorRatePct: 1, rps: 10, vus: 5 },
    });
  });
});

describe("cliTimeoutMs", () => {
  it("defaults to no timeout so long load tests are not killed", () => {
    expect(cliTimeoutMs({})).toBeUndefined();
    expect(cliTimeoutMs({ K6_MCP_CMD_TIMEOUT_MS: "0" })).toBeUndefined();
  });

  it("honours K6_MCP_CMD_TIMEOUT_MS", () => {
    expect(cliTimeoutMs({ K6_MCP_CMD_TIMEOUT_MS: "5000" })).toBe(5000);
  });
});
