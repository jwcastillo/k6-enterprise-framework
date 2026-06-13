/**
 * T-066: MCP Resources
 *
 * read_config   — reads client configuration JSON
 * list_scenarios — lists available test scenarios for a client
 * get_metrics   — returns metrics from a past execution
 */

import { join } from "path";
import {
  CLIENTS_DIR,
  REPORTS_DIR,
  validateClientExists,
  readJsonFile,
  globTs,
  mcpError,
  formatError,
} from "../utils/framework.js";
import { existsSync, readdirSync, statSync } from "fs";

// ── read_config ───────────────────────────────────────────────────────────────

export interface ReadConfigParams {
  client: string;
  env?: string;
}

export function readConfig(params: ReadConfigParams): unknown {
  try {
    const { client, env = "default" } = params;
    const clientDir = validateClientExists(client);
    const configFile = join(clientDir, "config", `${env}.json`);

    if (!existsSync(configFile)) {
      throw mcpError(
        "NOT_FOUND",
        `Config '${env}' not found for client '${client}'.`,
        { availableEnvs: readdirSync(join(clientDir, "config"))
            .filter(f => f.endsWith(".json"))
            .map(f => f.replace(".json", "")) },
      );
    }

    return readJsonFile(configFile);
  } catch (err) {
    throw formatError(err);
  }
}

// ── list_scenarios ────────────────────────────────────────────────────────────

export interface ListScenariosParams {
  client: string;
}

export interface ScenarioInfo {
  path: string;
  runCommand: string;
}

export function listScenarios(params: ListScenariosParams): ScenarioInfo[] {
  try {
    const { client } = params;
    const clientDir  = validateClientExists(client);
    const scenDir    = join(clientDir, "scenarios");

    if (!existsSync(scenDir)) {
      return [];
    }

    const files = globTs(scenDir);
    return files.map(f => ({
      path: `scenarios/${f}`,
      runCommand: `./bin/run-test.sh --client=${client} --scenario=${f.replace(/\.ts$/, "")}`,
    }));
  } catch (err) {
    throw formatError(err);
  }
}

// ── get_metrics ───────────────────────────────────────────────────────────────

export interface GetMetricsParams {
  test_id: string;  // format: "{client}/{test}/{timestamp}"
}

export function getMetrics(params: GetMetricsParams): unknown {
  try {
    const { test_id } = params;

    // Sanitize: no .. allowed
    if (test_id.includes("..") || test_id.includes("//")) {
      throw mcpError("INVALID_PARAMS", "test_id contains invalid path components.");
    }

    const summaryPath = join(REPORTS_DIR, test_id, "summary.json");

    if (!existsSync(summaryPath)) {
      // Try to list available executions for the client prefix
      const parts = test_id.split("/");
      const clientReportsDir = join(REPORTS_DIR, parts[0]);
      const available = existsSync(clientReportsDir)
        ? readdirSync(clientReportsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .slice(0, 10)
        : [];

      throw mcpError(
        "NOT_FOUND",
        `Metrics not found for test_id '${test_id}'.`,
        { hint: "test_id format: {client}/{service}/{timestamp}", availableServices: available },
      );
    }

    return readJsonFile(summaryPath);
  } catch (err) {
    throw formatError(err);
  }
}
