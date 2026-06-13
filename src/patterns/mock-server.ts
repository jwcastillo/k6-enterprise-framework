/**
 * T-046: Mock server with configurable responses
 *
 * Lightweight HTTP mock server for simulating dependencies during load tests.
 * Spawns as a local process during setup, auto-shuts down in teardown.
 *
 * Features:
 * - Declarative endpoint configuration (JSON)
 * - Dynamic response templates ({{counter}}, {{timestamp}}, {{uuid}}, {{randomInt(min,max)}})
 * - Configurable latency (fixed or normal distribution)
 * - Configurable error rate per endpoint
 * - Client-isolated mock configs (clients/{name}/mocks/)
 *
 * Runs in Node.js context (bin/), NOT in k6 goja runtime.
 */

import { MockConfig, MockEndpoint, MockResponseTemplate, LatencyConfig } from "../types/mock.d";
import { ClientContext } from "../types/client.d";

const http = require("http") as typeof import("http");
const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");
const crypto = require("crypto") as typeof import("crypto");

// ── Template engine ───────────────────────────────────────────────────────────

let globalCounter = 0;

/**
 * Process dynamic variables in a response template.
 */
function processTemplate(input: string): string {
  let result = input;

  // {{counter}} — auto-incrementing integer
  result = result.replace(/\{\{counter\}\}/g, () => String(++globalCounter));

  // {{timestamp}} — ISO 8601
  result = result.replace(/\{\{timestamp\}\}/g, () => new Date().toISOString());

  // {{uuid}} — random UUID v4
  result = result.replace(/\{\{uuid\}\}/g, () => crypto.randomUUID());

  // {{randomInt(min,max)}} — random integer in range
  result = result.replace(
    /\{\{randomInt\((\d+),(\d+)\)\}\}/g,
    (_match: string, minStr: string, maxStr: string) => {
      const min = parseInt(minStr, 10);
      const max = parseInt(maxStr, 10);
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    },
  );

  return result;
}

/**
 * Process a response body — handles both string and object templates.
 */
function processBody(body: string | Record<string, unknown>): string {
  if (typeof body === "string") {
    return processTemplate(body);
  }
  return processTemplate(JSON.stringify(body));
}

// ── Latency simulation ────────────────────────────────────────────────────────

/**
 * Compute the delay in ms from a latency config.
 */
function computeLatency(config?: LatencyConfig): number {
  if (config === undefined || config === null) return 0;

  if (typeof config === "number") return config;

  // Normal distribution using Box-Muller transform
  const { mean, stddev } = config;
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mean + z * stddev));
}

/**
 * Sleep for a given number of milliseconds (async).
 */
function delayMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mock config loading ───────────────────────────────────────────────────────

/**
 * Load mock configurations for a client.
 * Reads all JSON files from clients/{name}/mocks/ directory.
 */
export function loadMockConfigs(clientContext: ClientContext): MockConfig[] {
  const mocksDir = clientContext.mocksDir;

  if (!fs.existsSync(mocksDir)) {
    return [];
  }

  const configs: MockConfig[] = [];
  const files = fs.readdirSync(mocksDir).filter((f: string) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(mocksDir, file), "utf-8");
      configs.push(JSON.parse(content) as MockConfig);
    } catch (err) {
      console.warn(
        `[mock-server] Warning: failed to parse ${file}: ${(err as Error).message}`,
      );
    }
  }

  return configs;
}

// ── Route matching ────────────────────────────────────────────────────────────

/**
 * Match a request URL path against a mock endpoint path pattern.
 * Supports simple path parameters like /api/users/:id
 */
function matchPath(pattern: string, requestPath: string): boolean {
  const patternParts = pattern.split("/");
  const requestParts = requestPath.split("/");

  if (patternParts.length !== requestParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) continue; // Path parameter — matches anything
    if (patternParts[i] !== requestParts[i]) return false;
  }

  return true;
}

/**
 * Find the matching endpoint for a request.
 */
function findEndpoint(
  config: MockConfig,
  method: string,
  urlPath: string,
): MockEndpoint | null {
  return (
    config.endpoints.find(
      (ep) =>
        ep.method === method.toUpperCase() && matchPath(ep.path, urlPath),
    ) ?? null
  );
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

/** Active mock server instances (keyed by dependency name) */
const activeServers = new Map<string, ReturnType<typeof http.createServer>>();

/**
 * Start a mock server for a given configuration.
 *
 * @param config - Mock endpoint configuration
 * @returns Port the server is listening on
 */
export async function startMockServer(config: MockConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(
      async (
        req: InstanceType<typeof http.IncomingMessage>,
        res: InstanceType<typeof http.ServerResponse>,
      ) => {
        const urlPath = (req.url ?? "/").split("?")[0];
        const method = req.method ?? "GET";

        const endpoint = findEndpoint(config, method, urlPath);

        if (!endpoint) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not Found", path: urlPath, method }));
          return;
        }

        // Decide if this request should return an error (based on errorRate)
        const shouldError =
          endpoint.errorRate && Math.random() < endpoint.errorRate;

        const template: MockResponseTemplate = shouldError && endpoint.errorResponse
          ? endpoint.errorResponse
          : endpoint.response;

        // Simulate latency
        const latency = computeLatency(template.latency);
        if (latency > 0) {
          await delayMs(latency);
        }

        // Build response
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Mock-Server": config.name,
          "X-Mock-Latency-Ms": String(latency),
          ...(template.headers ?? {}),
        };

        const body = processBody(template.body);

        res.writeHead(template.status, headers);
        res.end(body);
      },
    );

    const port = config.port ?? 0; // 0 = auto-assign

    server.listen(port, "127.0.0.1", () => {
      const assignedPort = (server.address() as { port: number }).port;
      activeServers.set(config.name, server);
      console.log(
        `[mock-server] Started '${config.name}' on http://127.0.0.1:${assignedPort}`,
      );
      resolve(assignedPort);
    });

    server.on("error", (err: Error) => {
      reject(
        new Error(
          `[mock-server] Failed to start '${config.name}': ${err.message}`,
        ),
      );
    });
  });
}

/**
 * Stop a running mock server by dependency name.
 */
export async function stopMockServer(name: string): Promise<void> {
  const server = activeServers.get(name);
  if (!server) return;

  return new Promise((resolve) => {
    server.close(() => {
      activeServers.delete(name);
      console.log(`[mock-server] Stopped '${name}'`);
      resolve();
    });
  });
}

/**
 * Stop all running mock servers.
 * Call this in teardown to ensure clean shutdown.
 */
export async function stopAllMockServers(): Promise<void> {
  const names = Array.from(activeServers.keys());
  await Promise.all(names.map((name) => stopMockServer(name)));
}

/**
 * Start all mock servers for a client.
 * Returns a map of dependency name → port.
 */
export async function startClientMocks(
  clientContext: ClientContext,
): Promise<Map<string, number>> {
  const configs = loadMockConfigs(clientContext);
  const portMap = new Map<string, number>();

  for (const config of configs) {
    const port = await startMockServer(config);
    portMap.set(config.name, port);
  }

  return portMap;
}

/**
 * Get the URL for a running mock server.
 */
export function getMockUrl(name: string): string | null {
  const server = activeServers.get(name);
  if (!server) return null;
  const addr = server.address();
  if (!addr || typeof addr === "string") return null;
  return `http://127.0.0.1:${addr.port}`;
}

/**
 * Reset the global counter (for testing).
 */
export function resetMockState(): void {
  globalCounter = 0;
}
