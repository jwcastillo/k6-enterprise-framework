import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  newTraceContext,
  resolvePropagationFormat,
  buildTraceHeaders,
  withTracing,
  isTracingEnabled,
  beginIteration,
  endIteration,
  currentTraceRoot,
  resolveSamplingRatio,
  shouldSampleIteration,
  buildIterationTraceHeaders,
} from "../../src/observability/tracing-instrumentation";

// ── newTraceContext ──────────────────────────────────────────────────────────

describe("newTraceContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a trace context with 32-char (128-bit) traceId", () => {
    const ctx = newTraceContext();
    expect(ctx.traceId).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(ctx.traceId)).toBe(true);
  });

  it("generates a trace context with 16-char (64-bit) spanId", () => {
    const ctx = newTraceContext();
    expect(ctx.spanId).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(ctx.spanId)).toBe(true);
  });

  it("defaults sampled to true", () => {
    const ctx = newTraceContext();
    expect(ctx.sampled).toBe(true);
  });

  it("allows sampled=false", () => {
    const ctx = newTraceContext(false);
    expect(ctx.sampled).toBe(false);
  });

  it("generates unique traceIds on consecutive calls", () => {
    const ctx1 = newTraceContext();
    const ctx2 = newTraceContext();
    expect(ctx1.traceId).not.toBe(ctx2.traceId);
  });

  it("generates unique spanIds on consecutive calls", () => {
    const ctx1 = newTraceContext();
    const ctx2 = newTraceContext();
    expect(ctx1.spanId).not.toBe(ctx2.spanId);
  });

  it("does not set parentSpanId by default", () => {
    const ctx = newTraceContext();
    expect(ctx.parentSpanId).toBeUndefined();
  });
});

// ── resolvePropagationFormat ─────────────────────────────────────────────────

describe("resolvePropagationFormat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset __ENV
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  it("defaults to w3c when K6_TEMPO_PROPAGATION is not set", () => {
    const fmt = resolvePropagationFormat();
    expect(fmt).toBe("w3c");
  });

  it("returns w3c when explicitly set", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_PROPAGATION: "w3c" };
    const fmt = resolvePropagationFormat();
    expect(fmt).toBe("w3c");
  });

  it("returns b3 when set", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_PROPAGATION: "b3" };
    const fmt = resolvePropagationFormat();
    expect(fmt).toBe("b3");
  });

  it("returns jaeger when set", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_PROPAGATION: "jaeger" };
    const fmt = resolvePropagationFormat();
    expect(fmt).toBe("jaeger");
  });

  it("is case-insensitive", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_PROPAGATION: "W3C" };
    const fmt = resolvePropagationFormat();
    expect(fmt).toBe("w3c");
  });

  it("throws for unsupported propagation format", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_PROPAGATION: "custom-invalid" };
    expect(() => resolvePropagationFormat()).toThrow("Unsupported propagation");
    expect(() => resolvePropagationFormat()).toThrow("custom-invalid");
  });
});

// ── buildTraceHeaders ────────────────────────────────────────────────────────

describe("buildTraceHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  it("builds W3C traceparent header", () => {
    const headers = buildTraceHeaders("w3c");
    expect(headers.traceparent).toBeDefined();
    // Format: 00-{traceId}-{spanId}-{flags}
    const parts = headers.traceparent.split("-");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("00"); // version
    expect(parts[1]).toHaveLength(32); // traceId
    expect(parts[2]).toHaveLength(16); // spanId
    expect(parts[3]).toBe("01"); // sampled
    expect(headers.tracestate).toBe("k6=framework");
  });

  it("builds W3C header with sampled=false", () => {
    const headers = buildTraceHeaders("w3c", false);
    const parts = headers.traceparent.split("-");
    expect(parts[3]).toBe("00"); // not sampled
  });

  it("builds B3 single header", () => {
    const headers = buildTraceHeaders("b3");
    expect(headers.b3).toBeDefined();
    // Format: {traceId}-{spanId}-{sampled}
    const parts = headers.b3.split("-");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(32); // traceId
    expect(parts[1]).toHaveLength(16); // spanId
    expect(parts[2]).toBe("1"); // sampled
  });

  it("builds B3 header with sampled=false", () => {
    const headers = buildTraceHeaders("b3", false);
    const parts = headers.b3.split("-");
    expect(parts[2]).toBe("0");
  });

  it("builds Jaeger uber-trace-id header", () => {
    const headers = buildTraceHeaders("jaeger");
    expect(headers["uber-trace-id"]).toBeDefined();
    // Format: {traceId}:{spanId}:{parentSpanId}:{flags}
    const parts = headers["uber-trace-id"].split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toHaveLength(32); // traceId
    expect(parts[1]).toHaveLength(16); // spanId
    expect(parts[2]).toBe("0"); // parentSpanId (none)
    expect(parts[3]).toBe("1"); // sampled
  });

  it("builds Jaeger header with sampled=false", () => {
    const headers = buildTraceHeaders("jaeger", false);
    const parts = headers["uber-trace-id"].split(":");
    expect(parts[3]).toBe("0");
  });

  it("generates unique trace IDs on each call", () => {
    const h1 = buildTraceHeaders("w3c");
    const h2 = buildTraceHeaders("w3c");
    expect(h1.traceparent).not.toBe(h2.traceparent);
  });

  it("uses env-resolved format when format param is not provided", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_PROPAGATION: "b3" };
    const headers = buildTraceHeaders();
    expect(headers.b3).toBeDefined();
  });
});

// ── withTracing ──────────────────────────────────────────────────────────────

describe("withTracing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  it("merges trace headers into empty params", () => {
    const params = withTracing({}, "w3c");
    const headers = params.headers as Record<string, string>;
    expect(headers.traceparent).toBeDefined();
    expect(headers.tracestate).toBe("k6=framework");
  });

  it("preserves existing headers", () => {
    const params = withTracing({ headers: { Authorization: "Bearer token123" } }, "w3c");
    const headers = params.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token123");
    expect(headers.traceparent).toBeDefined();
  });

  it("preserves existing non-header params", () => {
    const params = withTracing({ tags: { scenario: "checkout" }, timeout: "30s" }, "w3c");
    expect(params.tags).toEqual({ scenario: "checkout" });
    expect(params.timeout).toBe("30s");
  });

  it("handles empty base params", () => {
    const params = withTracing(undefined, "w3c");
    expect(params.headers).toBeDefined();
    const headers = params.headers as Record<string, string>;
    expect(headers.traceparent).toBeDefined();
  });

  it("uses B3 format when specified", () => {
    const params = withTracing({}, "b3");
    const headers = params.headers as Record<string, string>;
    expect(headers.b3).toBeDefined();
  });

  it("uses Jaeger format when specified", () => {
    const params = withTracing({}, "jaeger");
    const headers = params.headers as Record<string, string>;
    expect(headers["uber-trace-id"]).toBeDefined();
  });

  it("defaults to env-resolved format", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_PROPAGATION: "jaeger" };
    const params = withTracing({});
    const headers = params.headers as Record<string, string>;
    expect(headers["uber-trace-id"]).toBeDefined();
  });
});

// ── isTracingEnabled ─────────────────────────────────────────────────────────

describe("isTracingEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  it("returns false when K6_TEMPO_ENABLED is not set", () => {
    expect(isTracingEnabled()).toBe(false);
  });

  it("returns true when K6_TEMPO_ENABLED=true", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_ENABLED: "true" };
    expect(isTracingEnabled()).toBe(true);
  });

  it("returns false when K6_TEMPO_ENABLED=false", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_ENABLED: "false" };
    expect(isTracingEnabled()).toBe(false);
  });

  it("returns false for any value other than 'true'", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_ENABLED: "1" };
    expect(isTracingEnabled()).toBe(false);
  });
});

// ── OBS2-03: beginIteration ──────────────────────────────────────────────────

/**
 * Helper: clear the module-level _iterationCache by calling endIteration() for
 * every iter value our tests touch. The cache is module-scoped, so without
 * vi.resetModules() between tests its state persists — explicit cleanup keeps
 * the test suite hermetic.
 */
function clearIterationCache(): void {
  for (let i = 0; i < 1010; i++) endIteration(i);
}

describe("beginIteration (OBS2-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
    (globalThis as Record<string, unknown>).__ITER = 0;
    clearIterationCache();
  });

  it("creates a trace root for __ITER=0 with sampled=true by default", () => {
    const ctx = beginIteration();
    expect(ctx.traceId).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(ctx.traceId)).toBe(true);
    expect(ctx.spanId).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(ctx.spanId)).toBe(true);
    expect(ctx.sampled).toBe(true);
  });

  it("returns the same trace root when called twice for the same iteration (idempotent)", () => {
    const ctxA = beginIteration(0);
    const ctxB = beginIteration(0);
    expect(ctxA).toBe(ctxB); // same reference
  });

  it("creates a different trace root for a different iteration", () => {
    const ctx1 = beginIteration(1);
    const ctx2 = beginIteration(2);
    expect(ctx1.traceId).not.toBe(ctx2.traceId);
  });

  it("honors an explicit sampled=false override", () => {
    const ctx = beginIteration(0, false);
    expect(ctx.sampled).toBe(false);
  });

  it("uses K6_TEMPO_SAMPLING_RATIO=0.0 to set sampled=false for all iterations", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_SAMPLING_RATIO: "0.0" };
    for (let i = 0; i <= 10; i++) {
      const ctx = beginIteration(i);
      expect(ctx.sampled).toBe(false);
    }
  });

  it("uses K6_TEMPO_SAMPLING_RATIO=1.0 (default) to set sampled=true for all iterations", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_SAMPLING_RATIO: "1.0" };
    for (let i = 0; i <= 10; i++) {
      const ctx = beginIteration(i);
      expect(ctx.sampled).toBe(true);
    }
  });
});

// ── OBS2-03: endIteration + currentTraceRoot ─────────────────────────────────

describe("endIteration + currentTraceRoot (OBS2-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
    (globalThis as Record<string, unknown>).__ITER = 0;
    clearIterationCache();
  });

  it("currentTraceRoot returns null when beginIteration was not called for this iter", () => {
    expect(currentTraceRoot(99)).toBeNull();
  });

  it("currentTraceRoot returns the cached root after beginIteration", () => {
    const ctx = beginIteration(5);
    expect(currentTraceRoot(5)).toBe(ctx);
  });

  it("endIteration clears the cache for the given iter", () => {
    beginIteration(5);
    endIteration(5);
    expect(currentTraceRoot(5)).toBeNull();
  });

  it("endIteration does not affect other iterations' cached roots", () => {
    beginIteration(5);
    const ctx6 = beginIteration(6);
    endIteration(5);
    expect(currentTraceRoot(5)).toBeNull();
    expect(currentTraceRoot(6)).toBe(ctx6);
  });
});

// ── OBS2-03: resolveSamplingRatio ────────────────────────────────────────────

describe("resolveSamplingRatio (OBS2-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  it("defaults to 1.0 when K6_TEMPO_SAMPLING_RATIO is unset", () => {
    expect(resolveSamplingRatio()).toBe(1.0);
  });

  it("parses K6_TEMPO_SAMPLING_RATIO=0.5 to 0.5", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_SAMPLING_RATIO: "0.5" };
    expect(resolveSamplingRatio()).toBe(0.5);
  });

  it("clamps K6_TEMPO_SAMPLING_RATIO=2.5 to 1.0", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_SAMPLING_RATIO: "2.5" };
    expect(resolveSamplingRatio()).toBe(1.0);
  });

  it("clamps K6_TEMPO_SAMPLING_RATIO=-0.3 to 0.0", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_SAMPLING_RATIO: "-0.3" };
    expect(resolveSamplingRatio()).toBe(0.0);
  });

  it("falls back to 1.0 on malformed K6_TEMPO_SAMPLING_RATIO='not-a-number'", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_SAMPLING_RATIO: "not-a-number" };
    expect(resolveSamplingRatio()).toBe(1.0);
  });
});

// ── OBS2-03: shouldSampleIteration ───────────────────────────────────────────

describe("shouldSampleIteration (OBS2-03)", () => {
  it("returns true for all iterations when ratio=1.0", () => {
    for (let i = 0; i <= 100; i++) {
      expect(shouldSampleIteration(1.0, i)).toBe(true);
    }
  });

  it("returns false for all iterations when ratio=0.0", () => {
    for (let i = 0; i <= 100; i++) {
      expect(shouldSampleIteration(0.0, i)).toBe(false);
    }
  });

  it("is deterministic per iteration (same iter always returns same decision)", () => {
    const first = shouldSampleIteration(0.5, 42);
    for (let n = 0; n < 5; n++) {
      expect(shouldSampleIteration(0.5, 42)).toBe(first);
    }
  });

  it("approximates 10% sampling rate over a large iteration range when ratio=0.1", () => {
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      if (shouldSampleIteration(0.1, i)) count++;
    }
    // 10% ± 30% absolute (generous bounds for the deterministic Knuth hash)
    expect(count).toBeGreaterThanOrEqual(70);
    expect(count).toBeLessThanOrEqual(130);
  });
});

// ── OBS2-03: buildIterationTraceHeaders ──────────────────────────────────────

describe("buildIterationTraceHeaders (OBS2-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_ENABLED: "true" };
    (globalThis as Record<string, unknown>).__ITER = 0;
    clearIterationCache();
  });

  it("returns headers with the iteration's traceId from currentTraceRoot", () => {
    (globalThis as Record<string, unknown>).__ITER = 7;
    const root = beginIteration(7);
    const headers = buildIterationTraceHeaders();
    const parts = headers.traceparent.split("-");
    expect(parts[1]).toBe(root.traceId);
  });

  it("returns a fresh spanId on each call within the same iteration", () => {
    beginIteration(0);
    const h1 = buildIterationTraceHeaders();
    const h2 = buildIterationTraceHeaders();
    const p1 = h1.traceparent.split("-");
    const p2 = h2.traceparent.split("-");
    // Same traceId substring (chars after "00-")
    expect(p1[1]).toBe(p2[1]);
    // Different spanId substring
    expect(p1[2]).not.toBe(p2[2]);
  });

  it("lazy-inits the iteration root if beginIteration was not yet called", () => {
    (globalThis as Record<string, unknown>).__ITER = 0;
    expect(currentTraceRoot(0)).toBeNull();
    buildIterationTraceHeaders();
    expect(currentTraceRoot(0)).not.toBeNull();
  });

  it("propagates the iteration's sampled flag into traceparent flags byte", () => {
    beginIteration(0, false);
    const headers = buildIterationTraceHeaders();
    const parts = headers.traceparent.split("-");
    expect(parts[3]).toBe("00"); // not sampled
  });
});
