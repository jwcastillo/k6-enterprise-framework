/**
 * k6 Enterprise Framework -- Node-only modules (NOT k6-runtime safe).
 * Use these from bin/, ai/, integrations/ only.
 * Never import from clients/scenarios -- k6 goja runtime does not support Node.js built-ins.
 *
 * Phase 4 ARC-06: Node-only modules migrated here from src/patterns/ and src/observability/.
 */

export {
  loadMockConfigs,
  startMockServer,
  stopMockServer,
  stopAllMockServers,
  startClientMocks,
  getMockUrl,
  resetMockState,
} from "./mock-server";

export {
  startHealthMonitor,
  stopHealthMonitor,
  formatHealthForHtml,
  formatHealthForJson,
} from "./generator-health";

export { checkPyroscopeHealth } from "./pyroscope-node";
export { startContinuous, stopContinuous } from "./pyroscope-node";
export type { ContinuousProfilingOptions } from "./pyroscope-node";

export { loadChaosConfig } from "./chaos-injection-node";
