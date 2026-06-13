/**
 * Reference Scenario: smoke-users-experimental (API) — GATED: experimental
 *
 * This scenario is intentionally gated with `export const gate = "experimental"`
 * to demonstrate the T-261 GPT-inspired gating axis. The runner will refuse to
 * execute it unless `--experimental` is passed:
 *
 *   ./bin/run-test.sh --client=_reference --scenario=api/smoke-users-experimental --experimental
 *
 * Gating is NOT a 6th bucket — this scenario lives in the canonical `api/`
 * bucket. The gate only controls whether the runner will execute it without an
 * explicit opt-in flag (exit 108 when blocked).
 *
 * @executor    constant-vus
 * @profile     smoke (1 VU, 30s)
 * @cli         ./bin/run-test.sh --client=_reference --scenario=api/smoke-users-experimental --experimental
 */

import { Options } from "k6/options";
import { RequestHelper } from "@helpers/request-helper";
import { runChecks, statusCheck, thresholdCheck } from "@core/check-system";
import { standardSetup, standardTeardown } from "@core/execution-engine";

/** T-261 gate marker — MUST use double quotes (Prettier + runner grep convention). */
export const gate = "experimental";

const BASE_URL = __ENV["API_BASE_URL"] ?? "https://httpbin.org";

export const options: Options = {
  vus: 1,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    checks: ["rate>=0.95"],
  },
};

const client = new RequestHelper(BASE_URL, {
  tags: { client: "_reference", scenario: "smoke-users-experimental" },
});

export function setup(): ReturnType<typeof standardSetup> {
  return standardSetup({
    name: "smoke-users-experimental",
    client: "_reference",
    profile: "smoke",
  });
}

export default function (_data: ReturnType<typeof standardSetup>): void {
  const res = client.get("/get", { source: "smoke-users-experimental", vu: `${__VU}` });
  runChecks(res, [statusCheck(200), thresholdCheck(2000)]);
}

export function teardown(data: ReturnType<typeof standardSetup>): void {
  standardTeardown(data);
}
