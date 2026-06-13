import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Spy on Node.js modules (SUT uses require() which shares the same module cache)
vi.spyOn(path, "join").mockImplementation((...parts: string[]) => parts.join("/"));
const existsSyncSpy = vi.spyOn(fs, "existsSync");
const readdirSyncSpy = vi.spyOn(fs, "readdirSync");
const readFileSyncSpy = vi.spyOn(fs, "readFileSync");
vi.spyOn(crypto, "randomUUID").mockReturnValue(
  "mock-uuid-1234" as `${string}-${string}-${string}-${string}-${string}`
);

// Mock http.createServer to return a controllable mock server
const mockServerInstance = {
  listen: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  address: vi.fn(() => ({ port: 9090 })),
};
const createServerSpy = vi
  .spyOn(http, "createServer")
  .mockReturnValue(mockServerInstance as unknown as http.Server);

import {
  loadMockConfigs,
  startMockServer,
  stopMockServer,
  stopAllMockServers,
  getMockUrl,
  resetMockState,
} from "@node/mock-server";
import type { MockConfig } from "../../src/types/mock.d";
import type { ClientContext } from "../../src/types/client.d";

function makeClientContext(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    clientId: "test-client",
    rootDir: "/clients/test-client",
    configDir: "/clients/test-client/config",
    dataDir: "/clients/test-client/data",
    libDir: "/clients/test-client/lib",
    scenariosDir: "/clients/test-client/scenarios",
    reportsDir: "/clients/test-client/reports",
    envFile: "/clients/test-client/.env",
    mocksDir: "/clients/test-client/mocks",
    brandingDir: "/clients/test-client/branding",
    isSubmodule: false,
    isSymlink: false,
    ...overrides,
  };
}

function makeMockConfig(overrides: Partial<MockConfig> = {}): MockConfig {
  return {
    name: "test-service",
    port: 0,
    endpoints: [
      {
        path: "/api/health",
        method: "GET",
        response: { status: 200, body: { status: "ok" } },
      },
    ],
    ...overrides,
  };
}

describe("mock-server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mocks after clearAllMocks
    createServerSpy.mockReturnValue(mockServerInstance as unknown as http.Server);
    mockServerInstance.address.mockReturnValue({ port: 9090 });
    mockServerInstance.close.mockImplementation((callback: () => void) => {
      callback();
    });
    resetMockState();
  });

  afterEach(async () => {
    await stopAllMockServers();
  });

  // ── loadMockConfigs ──────────────────────────────────────────────────

  describe("loadMockConfigs", () => {
    it("returns empty array when mocks directory does not exist", () => {
      existsSyncSpy.mockReturnValue(false);

      const configs = loadMockConfigs(makeClientContext());
      expect(configs).toEqual([]);
    });

    it("loads JSON mock config files from mocks directory", () => {
      const config1 = makeMockConfig({ name: "service-a" });
      const config2 = makeMockConfig({ name: "service-b" });

      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue([
        "service-a.json",
        "service-b.json",
        "readme.txt",
      ] as unknown as fs.Dirent[]);
      readFileSyncSpy
        .mockReturnValueOnce(JSON.stringify(config1))
        .mockReturnValueOnce(JSON.stringify(config2));

      const configs = loadMockConfigs(makeClientContext());
      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("service-a");
      expect(configs[1].name).toBe("service-b");
    });

    it("skips non-JSON files", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["config.yaml", "notes.txt"] as unknown as fs.Dirent[]);

      const configs = loadMockConfigs(makeClientContext());
      expect(configs).toEqual([]);
      expect(readFileSyncSpy).not.toHaveBeenCalled();
    });

    it("warns and skips files with invalid JSON", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["bad.json"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue("invalid{json");

      const configs = loadMockConfigs(makeClientContext());
      expect(configs).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("failed to parse bad.json"));
    });
  });

  // ── startMockServer ──────────────────────────────────────────────────

  describe("startMockServer", () => {
    it("starts a server and returns the assigned port", async () => {
      mockServerInstance.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
        }
      );

      const config = makeMockConfig({ name: "start-test" });
      const port = await startMockServer(config);

      expect(port).toBe(9090);
      expect(createServerSpy).toHaveBeenCalled();
      expect(mockServerInstance.listen).toHaveBeenCalledWith(0, "127.0.0.1", expect.any(Function));
    });

    it("rejects when server emits error", async () => {
      mockServerInstance.listen.mockImplementation(() => {
        // Don't call callback
      });
      mockServerInstance.on.mockImplementation((event: string, callback: (err: Error) => void) => {
        if (event === "error") {
          callback(new Error("EADDRINUSE"));
        }
      });

      const config = makeMockConfig({ name: "error-test" });
      await expect(startMockServer(config)).rejects.toThrow("Failed to start 'error-test'");
    });
  });

  // ── stopMockServer ──────────────────────────────────────────────────

  describe("stopMockServer", () => {
    it("returns immediately for non-existent server", async () => {
      await expect(stopMockServer("nonexistent")).resolves.toBeUndefined();
    });

    it("stops a running mock server", async () => {
      mockServerInstance.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
        }
      );
      mockServerInstance.close.mockImplementation((callback: () => void) => {
        callback();
      });

      const config = makeMockConfig({ name: "stop-test" });
      await startMockServer(config);

      await stopMockServer("stop-test");
      expect(getMockUrl("stop-test")).toBeNull();
    });
  });

  // ── getMockUrl ──────────────────────────────────────────────────────

  describe("getMockUrl", () => {
    it("returns null for non-existent server", () => {
      expect(getMockUrl("nope")).toBeNull();
    });

    it("returns URL for running server", async () => {
      mockServerInstance.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
        }
      );
      mockServerInstance.address.mockReturnValue({ port: 8888 });

      await startMockServer(makeMockConfig({ name: "url-test" }));
      const url = getMockUrl("url-test");

      expect(url).toBe("http://127.0.0.1:8888");
    });

    it("returns null when server.address() returns string", async () => {
      mockServerInstance.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
        }
      );
      mockServerInstance.address.mockReturnValue("/tmp/socket");

      await startMockServer(makeMockConfig({ name: "string-addr" }));
      const url = getMockUrl("string-addr");

      expect(url).toBeNull();
    });

    it("returns null when server.address() returns null", async () => {
      mockServerInstance.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
        }
      );

      await startMockServer(makeMockConfig({ name: "null-addr" }));
      // Change address to null AFTER server is started
      mockServerInstance.address.mockReturnValue(null);
      const url = getMockUrl("null-addr");

      expect(url).toBeNull();
    });
  });

  // ── resetMockState ──────────────────────────────────────────────────

  describe("resetMockState", () => {
    it("resets the global counter", () => {
      expect(() => resetMockState()).not.toThrow();
    });
  });

  // ── stopAllMockServers ──────────────────────────────────────────────

  describe("stopAllMockServers", () => {
    it("stops all running servers", async () => {
      mockServerInstance.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
        }
      );
      mockServerInstance.close.mockImplementation((callback: () => void) => {
        callback();
      });

      await startMockServer(makeMockConfig({ name: "server-a" }));
      await startMockServer(makeMockConfig({ name: "server-b" }));

      await stopAllMockServers();

      expect(getMockUrl("server-a")).toBeNull();
      expect(getMockUrl("server-b")).toBeNull();
    });

    it("handles no running servers gracefully", async () => {
      await expect(stopAllMockServers()).resolves.toBeUndefined();
    });
  });
});
