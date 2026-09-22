/**
 * Reference Scenario: gate-selftest (API)
 *
 * @executor    constant-vus
 * @profile     any (the scenario declares its own options — the run must be deterministic)
 * @thresholds  http_req_failed rate<0.05, http_req_duration p(95)<2000ms, checks rate>=0.95
 * @cli         bash bin/testing/gate-selftest.sh
 * @expected    Green against a healthy mock server; red as soon as errors are injected
 *
 * Only used by bin/testing/gate-selftest.sh, which proves the quality gates really fail:
 * it runs this scenario against bin/mock-server.js with faults injected and asserts the
 * exit codes. Deliberately boring — one endpoint, fixed VUs, fixed duration — so that a
 * red run means the gate fired, not that the scenario is flaky.
 *
 * The thresholds are chosen so that injected errors cross them while injected latency
 * does not: latency regressions are the auto-comparison's job, not a threshold's.
 */

import { sleep } from "k6";
import { Options } from "k6/options";
import { RequestHelper } from "@helpers/request-helper";
import { runChecks, statusCheck, schemaCheck } from "@core/check-system";

const BASE_URL = __ENV["API_BASE_URL"] ?? "http://127.0.0.1:38100";

export const options: Options = {
  vus: 5,
  duration: "20s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate>=0.95"],
  },
};

const client = new RequestHelper(BASE_URL, {
  tags: { client: "_reference", scenario: "gate-selftest" },
});

export default function (): void {
  const res = client.get("/api/users");
  runChecks(res, [statusCheck(200), schemaCheck(["users", "total"])]);
  sleep(0.1);
}
