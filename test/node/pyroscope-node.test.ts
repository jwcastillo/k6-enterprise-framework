/** Unit tests for pyroscope-node continuous profiling lifecycle (OBS2-02) */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startContinuous,
  stopContinuous,
  _setPyroscopeLoaderForTesting,
  _resetPyroscopeStateForTesting,
  type ContinuousProfilingOptions,
} from "@node/pyroscope-node";

// ── Helpers ────────────────────────────────────────────────────────────────

type PyroMock = {
  init: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

function makePyroMock(stopOverride?: ReturnType<typeof vi.fn>): PyroMock {
  return {
    init: vi.fn(),
    start: vi.fn(),
    stop: stopOverride ?? vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Install a mock loader for the @pyroscope/nodejs optional dep. Returns the
 * mock so individual tests can assert on init / start / stop calls.
 */
function installMock(mock: PyroMock = makePyroMock()): PyroMock {
  _setPyroscopeLoaderForTesting(() => mock);
  return mock;
}

/**
 * Install a loader that simulates the optional dep being absent (the
 * production graceful-degradation path).
 */
function installMissingDep(): void {
  _setPyroscopeLoaderForTesting(() => {
    const err = new Error("Cannot find module '@pyroscope/nodejs'") as Error & {
      code?: string;
    };
    err.code = "MODULE_NOT_FOUND";
    throw err;
  });
}

const DEFAULT_OPTS: ContinuousProfilingOptions = {
  appName: "k6-_reference.smoke",
  serverAddress: "http://localhost:4040",
  tags: {
    app: "k6",
    client: "_reference",
    scenario: "api/smoke-users",
    profile: "smoke",
    run_id: "abc123",
  },
};

// ── Common setup ───────────────────────────────────────────────────────────

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  _resetPyroscopeStateForTesting();
});

afterEach(() => {
  warnSpy.mockRestore();
  logSpy.mockRestore();
  _setPyroscopeLoaderForTesting(null);
  _resetPyroscopeStateForTesting();
});

// ── Suite 1: startContinuous happy path ────────────────────────────────────

describe("startContinuous lifecycle (happy path)", () => {
  it("calls @pyroscope/nodejs init() once with composed appName, serverAddress, tags", () => {
    const mod = installMock();

    startContinuous(DEFAULT_OPTS);

    expect(mod.init).toHaveBeenCalledTimes(1);
    expect(mod.init).toHaveBeenCalledWith({
      appName: DEFAULT_OPTS.appName,
      serverAddress: DEFAULT_OPTS.serverAddress,
      tags: DEFAULT_OPTS.tags,
      sampleRate: 100,
    });
  });

  it("calls start() after init()", () => {
    const mod = installMock();

    startContinuous(DEFAULT_OPTS);

    const initOrder = mod.init.mock.invocationCallOrder[0];
    const startOrder = mod.start.mock.invocationCallOrder[0];
    expect(typeof initOrder).toBe("number");
    expect(typeof startOrder).toBe("number");
    expect(initOrder).toBeLessThan(startOrder as number);
  });

  it("ignores second startContinuous call (idempotent)", () => {
    const mod = installMock();

    startContinuous(DEFAULT_OPTS);
    startContinuous(DEFAULT_OPTS);

    expect(mod.init).toHaveBeenCalledTimes(1);
    expect(mod.start).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("startContinuous called twice"),
    );
  });

  it("respects custom sampleRate when provided", () => {
    const mod = installMock();

    startContinuous({ ...DEFAULT_OPTS, sampleRate: 200 });

    expect(mod.init).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 200 }),
    );
  });
});

// ── Suite 2: stopContinuous lifecycle ──────────────────────────────────────

describe("stopContinuous lifecycle", () => {
  it("calls stop() after a successful startContinuous()", async () => {
    const mod = installMock();

    startContinuous(DEFAULT_OPTS);
    await stopContinuous();

    expect(mod.stop).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when startContinuous was never called", async () => {
    const mod = installMock();

    await expect(stopContinuous()).resolves.toBeUndefined();
    expect(mod.stop).not.toHaveBeenCalled();
  });

  it("swallows errors from stop() without rethrowing", async () => {
    const failingStop = vi.fn().mockRejectedValue(new Error("flush failed"));
    const mod = makePyroMock(failingStop);
    installMock(mod);

    startContinuous(DEFAULT_OPTS);
    await expect(stopContinuous()).resolves.toBeUndefined();

    expect(failingStop).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("stopContinuous error"),
    );
  });
});

// ── Suite 3: Graceful degradation when @pyroscope/nodejs is missing ───────

describe("Graceful degradation when @pyroscope/nodejs is missing", () => {
  it("warns and returns without throwing when @pyroscope/nodejs is not installed", () => {
    installMissingDep();

    expect(() => startContinuous(DEFAULT_OPTS)).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(warnMessage).toContain("@pyroscope/nodejs");
    expect(warnMessage).toContain("pnpm add");
  });

  it("stopContinuous is a no-op when start was never successful", async () => {
    installMissingDep();

    startContinuous(DEFAULT_OPTS);
    // initial warn from start; reset to assert no further warns from stop
    warnSpy.mockClear();

    await expect(stopContinuous()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
