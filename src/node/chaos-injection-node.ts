/**
 * Node-only chaos helpers. loadChaosConfig reads chaos.json from disk via fs/path --
 * NOT k6-runtime safe. Extracted from src/patterns/chaos-injection.ts in Phase 4 ARC-06.
 */

import { ChaosConfig } from "../types/mock.d";
import { ClientContext } from "../types/client.d";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");

/**
 * Load chaos injection configuration for a client.
 * Returns null if no chaos.json exists or chaos is not enabled.
 */
export function loadChaosConfig(clientContext: ClientContext): ChaosConfig | null {
  const chaosPath = path.join(clientContext.configDir, "chaos.json");

  if (!fs.existsSync(chaosPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(chaosPath, "utf-8");
    const config = JSON.parse(content) as ChaosConfig;

    if (!config.enabled) {
      console.log(`[chaos] Chaos config found but disabled for '${config.targetService}'.`);
      return null;
    }

    return config;
  } catch (err) {
    throw new Error(`ChaosInjection: failed to parse chaos.json: ${(err as Error).message}`);
  }
}
