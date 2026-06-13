/**
 * {{SCENARIO_NAME}} — API load test for {{CLIENT_NAME}}
 *
 * Service  : {{SERVICE_NAME}}
 * Type     : API (HTTP REST)
 * Profile  : smoke (default) — change with --profile flag
 *
 * Run:
 *   ./bin/run-test.sh --client={{CLIENT_NAME}} --scenario={{SCENARIO_NAME}} --profile=smoke
 *   ./bin/run-test.sh --client={{CLIENT_NAME}} --scenario={{SCENARIO_NAME}} --profile=load
 */

import http from "k6/http";
import { check } from "k6";
import { buildK6Options, standardSetup, standardTeardown, standardHandleSummary } from "../../../src/core/execution-engine";
import { RequestHelper } from "../../../src/helpers/request-helper";
import { statusCheck, schemaCheck, runChecks } from "../../../src/core/check-system";
import { StructuredLogger } from "../../../src/helpers/structured-logger";

export const options = buildK6Options();

const logger = new StructuredLogger({ service: "{{SERVICE_NAME}}" });

export function setup() {
  return standardSetup({ name: "{{SCENARIO_NAME}}", client: "{{CLIENT_NAME}}" });
}

export default function (data: ReturnType<typeof setup>) {
  const api = new RequestHelper(__ENV.BASE_URL ?? "http://localhost:3000");

  // ── Example: GET request with checks ─────────────────────────────────────
  const res = api.get("/api/{{SERVICE_NAME}}", undefined, {
    tags: { endpoint: "list-{{SERVICE_NAME}}" },
  });

  runChecks(res, [
    statusCheck(200),
    schemaCheck(["id", "name"]),
  ]);

  logger.info("request completed", { status: res.status, url: res.url });
}

export function teardown(data: ReturnType<typeof setup>) {
  standardTeardown(data);
}

export function handleSummary(data: Record<string, unknown>) {
  return standardHandleSummary(data, "{{CLIENT_NAME}}", "{{SCENARIO_NAME}}");
}
