import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "k6/http";
import { RequestHelper } from "../../src/helpers/request-helper";
import { endIteration } from "../../src/observability/tracing-instrumentation";

// Mock header-helper to avoid its internal complexity
vi.mock("../../src/helpers/header-helper", () => ({
  HeaderHelper: {
    standard: vi.fn(() => ({
      "Content-Type": "application/json",
      Accept: "application/json",
    })),
  },
}));

function mockResponse(
  overrides: Partial<{
    status: number;
    body: string | null;
    headers: Record<string, string>;
    timings: { duration: number; waiting: number; receiving: number; sending: number };
  }> = {}
) {
  return {
    status: overrides.status ?? 200,
    body: "body" in overrides ? overrides.body : '{"message":"ok"}',
    headers: overrides.headers ?? { "Content-Type": "application/json" },
    timings: overrides.timings ?? { duration: 100, waiting: 80, receiving: 15, sending: 5 },
  };
}

describe("RequestHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", () => {
      const client = new RequestHelper("https://api.example.com/");
      const res = mockResponse();
      vi.mocked(http.get).mockReturnValue(res as never);
      client.get("/users");
      expect(http.get).toHaveBeenCalledWith("https://api.example.com/users", expect.any(Object));
    });

    it("keeps baseUrl without trailing slash unchanged", () => {
      const client = new RequestHelper("https://api.example.com");
      const res = mockResponse();
      vi.mocked(http.get).mockReturnValue(res as never);
      client.get("/users");
      expect(http.get).toHaveBeenCalledWith("https://api.example.com/users", expect.any(Object));
    });
  });

  // ── GET ──────────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("calls http.get with full URL", () => {
      const client = new RequestHelper("https://api.example.com");
      const res = mockResponse();
      vi.mocked(http.get).mockReturnValue(res as never);
      client.get("/items");
      expect(http.get).toHaveBeenCalledWith(
        "https://api.example.com/items",
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    it("appends query string from params", () => {
      const client = new RequestHelper("https://api.example.com");
      const res = mockResponse();
      vi.mocked(http.get).mockReturnValue(res as never);
      client.get("/search", { q: "test", page: 1, active: true });
      const calledUrl = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(calledUrl).toContain("?");
      expect(calledUrl).toContain("q=test");
      expect(calledUrl).toContain("page=1");
      expect(calledUrl).toContain("active=true");
    });

    it("skips null and undefined query params", () => {
      const client = new RequestHelper("https://api.example.com");
      const res = mockResponse();
      vi.mocked(http.get).mockReturnValue(res as never);
      client.get("/search", { q: "test", empty: null, missing: undefined });
      const calledUrl = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(calledUrl).toContain("q=test");
      expect(calledUrl).not.toContain("empty");
      expect(calledUrl).not.toContain("missing");
    });

    it("does not append query string when no queryParams", () => {
      const client = new RequestHelper("https://api.example.com");
      const res = mockResponse();
      vi.mocked(http.get).mockReturnValue(res as never);
      client.get("/items");
      const calledUrl = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(calledUrl).toBe("https://api.example.com/items");
    });

    it("returns SafeResponse with correct status", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(mockResponse({ status: 201 }) as never);
      const result = client.get("/items");
      expect(result.status).toBe(201);
    });

    it("returns SafeResponse with body as string", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(mockResponse({ body: '{"id":1}' }) as never);
      const result = client.get("/items/1");
      expect(result.body).toBe('{"id":1}');
    });

    it("returns empty string when body is null", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(mockResponse({ body: null }) as never);
      const result = client.get("/items/1");
      expect(result.body).toBe("");
    });
  });

  // ── SafeResponse.json ────────────────────────────────────────────────────────

  describe("SafeResponse.json", () => {
    it("parses JSON body", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(
        mockResponse({ body: '{"name":"test","count":42}' }) as never
      );
      const result = client.get("/items");
      const parsed = result.json<{ name: string; count: number }>();
      expect(parsed).toEqual({ name: "test", count: 42 });
    });

    it("supports dot-path selector", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(
        mockResponse({ body: '{"data":{"items":[1,2,3]}}' }) as never
      );
      const result = client.get("/items");
      const items = result.json<number[]>("data.items");
      expect(items).toEqual([1, 2, 3]);
    });

    it("returns null for invalid JSON", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(mockResponse({ body: "not json" }) as never);
      const result = client.get("/items");
      expect(result.json()).toBeNull();
    });

    it("returns null for missing nested path", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(mockResponse({ body: '{"data":{}}' }) as never);
      const result = client.get("/items");
      expect(result.json("data.nonexistent.deep")).toBeNull();
    });

    it("returns null when body is null", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(mockResponse({ body: null }) as never);
      const result = client.get("/items");
      expect(result.json()).toBeNull();
    });
  });

  // ── POST ─────────────────────────────────────────────────────────────────────

  describe("post", () => {
    it("calls http.post with JSON-stringified body", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(mockResponse() as never);
      const body = { name: "test", value: 123 };
      client.post("/items", body);
      expect(http.post).toHaveBeenCalledWith(
        "https://api.example.com/items",
        JSON.stringify(body),
        expect.any(Object)
      );
    });

    it("returns SafeResponse", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(mockResponse({ status: 201 }) as never);
      const result = client.post("/items", { name: "test" });
      expect(result.status).toBe(201);
    });
  });

  // ── PUT ──────────────────────────────────────────────────────────────────────

  describe("put", () => {
    it("calls http.put with JSON-stringified body", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.put).mockReturnValue(mockResponse() as never);
      client.put("/items/1", { name: "updated" });
      expect(http.put).toHaveBeenCalledWith(
        "https://api.example.com/items/1",
        JSON.stringify({ name: "updated" }),
        expect.any(Object)
      );
    });
  });

  // ── PATCH ────────────────────────────────────────────────────────────────────

  describe("patch", () => {
    it("calls http.patch with JSON-stringified body", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.patch).mockReturnValue(mockResponse() as never);
      client.patch("/items/1", { active: false });
      expect(http.patch).toHaveBeenCalledWith(
        "https://api.example.com/items/1",
        JSON.stringify({ active: false }),
        expect.any(Object)
      );
    });
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("calls http.del with null body", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.del).mockReturnValue(mockResponse() as never);
      client.delete("/items/1");
      expect(http.del).toHaveBeenCalledWith(
        "https://api.example.com/items/1",
        null,
        expect.any(Object)
      );
    });
  });

  // ── Options merging ──────────────────────────────────────────────────────────

  describe("options merging", () => {
    it("passes timeout when set in defaultOptions", () => {
      const client = new RequestHelper("https://api.example.com", { timeout: 5000 });
      vi.mocked(http.get).mockReturnValue(mockResponse() as never);
      client.get("/items");
      const params = vi.mocked(http.get).mock.calls[0][1] as Record<string, unknown>;
      expect(params.timeout).toBe(5000);
    });

    it("passes timeout from per-call opts overriding default", () => {
      const client = new RequestHelper("https://api.example.com", { timeout: 5000 });
      vi.mocked(http.get).mockReturnValue(mockResponse() as never);
      client.get("/items", undefined, { timeout: 10000 });
      const params = vi.mocked(http.get).mock.calls[0][1] as Record<string, unknown>;
      expect(params.timeout).toBe(10000);
    });

    it("merges tags from default and per-call options", () => {
      const client = new RequestHelper("https://api.example.com", {
        tags: { service: "api" },
      });
      vi.mocked(http.get).mockReturnValue(mockResponse() as never);
      client.get("/items", undefined, { tags: { endpoint: "list" } });
      const params = vi.mocked(http.get).mock.calls[0][1] as Record<string, unknown>;
      expect(params.tags).toEqual({ service: "api", endpoint: "list" });
    });

    it("passes extra headers merged with standard headers", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(mockResponse() as never);
      client.get("/items", undefined, {
        extraHeaders: { "X-Custom": "value" },
      });
      const params = vi.mocked(http.get).mock.calls[0][1] as { headers: Record<string, string> };
      expect(params.headers["X-Custom"]).toBe("value");
    });
  });

  // ── Timings ──────────────────────────────────────────────────────────────────

  describe("timings", () => {
    it("SafeResponse includes timing information", () => {
      const client = new RequestHelper("https://api.example.com");
      vi.mocked(http.get).mockReturnValue(
        mockResponse({
          timings: { duration: 250, waiting: 200, receiving: 40, sending: 10 },
        }) as never
      );
      const result = client.get("/items");
      expect(result.timings).toEqual({
        duration: 250,
        waiting: 200,
        receiving: 40,
        sending: 10,
      });
    });
  });
});

// ── OBS2-03: RequestHelper auto-trace injection ──────────────────────────────

/**
 * Helper: extract the params object passed to the last http.get call and
 * inspect its headers.traceparent value. Returns undefined when traceparent
 * is absent.
 */
function lastTraceparent(): string | undefined {
  const calls = vi.mocked(http.get).mock.calls;
  const params = calls[calls.length - 1]?.[1] as { headers?: Record<string, string> } | undefined;
  return params?.headers?.traceparent;
}

function lastPostTraceparent(): string | undefined {
  const calls = vi.mocked(http.post).mock.calls;
  const params = calls[calls.length - 1]?.[2] as { headers?: Record<string, string> } | undefined;
  return params?.headers?.traceparent;
}

function clearIterationCacheForTest(): void {
  for (let i = 0; i < 10; i++) endIteration(i);
}

describe("RequestHelper auto-trace injection (OBS2-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_ENABLED: "true" };
    (globalThis as Record<string, unknown>).__ITER = 0;
    clearIterationCacheForTest();
  });

  it("injects traceparent header when K6_TEMPO_ENABLED=true", () => {
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/x");
    const tp = lastTraceparent();
    expect(tp).toBeDefined();
    expect(/^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/.test(tp as string)).toBe(true);
  });

  it("uses the same traceId across multiple calls in the same iteration", () => {
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/a");
    client.get("/b");
    client.get("/c");
    const calls = vi.mocked(http.get).mock.calls;
    const traceparents = calls.map(
      (c) => (c[1] as { headers: Record<string, string> }).headers.traceparent
    );
    expect(traceparents).toHaveLength(3);
    const traceIds = traceparents.map((tp) => tp.split("-")[1]);
    const spanIds = traceparents.map((tp) => tp.split("-")[2]);
    expect(traceIds[0]).toBe(traceIds[1]);
    expect(traceIds[1]).toBe(traceIds[2]);
    expect(spanIds[0]).not.toBe(spanIds[1]);
    expect(spanIds[1]).not.toBe(spanIds[2]);
  });

  it("uses a different traceId across iterations", () => {
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    (globalThis as Record<string, unknown>).__ITER = 0;
    client.get("/a");
    endIteration(0);
    (globalThis as Record<string, unknown>).__ITER = 1;
    client.get("/b");
    const calls = vi.mocked(http.get).mock.calls;
    const traceIdA = (calls[0][1] as { headers: Record<string, string> }).headers.traceparent.split(
      "-"
    )[1];
    const traceIdB = (calls[1][1] as { headers: Record<string, string> }).headers.traceparent.split(
      "-"
    )[1];
    expect(traceIdA).not.toBe(traceIdB);
  });

  it("does NOT inject traceparent when K6_TEMPO_ENABLED is unset", () => {
    (globalThis as Record<string, unknown>).__ENV = {};
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/x");
    expect(lastTraceparent()).toBeUndefined();
  });

  it("does NOT inject traceparent when K6_TEMPO_ENABLED is 'false'", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_ENABLED: "false" };
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/x");
    expect(lastTraceparent()).toBeUndefined();
  });
});

describe("RequestHelper per-call tracing opt-out (OBS2-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = { K6_TEMPO_ENABLED: "true" };
    (globalThis as Record<string, unknown>).__ITER = 0;
    clearIterationCacheForTest();
  });

  it("opts out of tracing for a single call when { tracing: false } is passed", () => {
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/a");
    client.get("/b", undefined, { tracing: false });
    client.get("/c");
    const calls = vi.mocked(http.get).mock.calls;
    const tpA = (calls[0][1] as { headers: Record<string, string> }).headers.traceparent;
    const tpB = (calls[1][1] as { headers: Record<string, string> }).headers.traceparent;
    const tpC = (calls[2][1] as { headers: Record<string, string> }).headers.traceparent;
    expect(tpA).toBeDefined();
    expect(tpB).toBeUndefined();
    expect(tpC).toBeDefined();
    // /a and /c share traceId
    expect(tpA.split("-")[1]).toBe(tpC.split("-")[1]);
  });

  it("includes traceparent when { tracing: true } is explicitly passed (redundant default)", () => {
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/x", undefined, { tracing: true });
    expect(lastTraceparent()).toBeDefined();
  });

  it("constructor-level defaultOptions.tracing = false opts out all calls from this client", () => {
    const client = new RequestHelper("https://api.example.com", { tracing: false });
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    vi.mocked(http.post).mockReturnValue(mockResponse() as never);
    client.get("/x");
    client.post("/y", {});
    expect(lastTraceparent()).toBeUndefined();
    expect(lastPostTraceparent()).toBeUndefined();
  });

  it("per-call tracing: true overrides constructor-level tracing: false", () => {
    const client = new RequestHelper("https://api.example.com", { tracing: false });
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/x", undefined, { tracing: true });
    expect(lastTraceparent()).toBeDefined();
  });
});

describe("RequestHelper tracing under sampling ratio (OBS2-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ITER = 0;
    clearIterationCacheForTest();
  });

  it("emits traceparent with flags=01 (sampled) when K6_TEMPO_SAMPLING_RATIO=1.0", () => {
    (globalThis as Record<string, unknown>).__ENV = {
      K6_TEMPO_ENABLED: "true",
      K6_TEMPO_SAMPLING_RATIO: "1.0",
    };
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/x");
    const tp = lastTraceparent();
    expect(tp).toBeDefined();
    expect((tp as string).endsWith("-01")).toBe(true);
  });

  it("emits traceparent with flags=00 (not sampled) when K6_TEMPO_SAMPLING_RATIO=0.0", () => {
    (globalThis as Record<string, unknown>).__ENV = {
      K6_TEMPO_ENABLED: "true",
      K6_TEMPO_SAMPLING_RATIO: "0.0",
    };
    const client = new RequestHelper("https://api.example.com");
    vi.mocked(http.get).mockReturnValue(mockResponse() as never);
    client.get("/x");
    const tp = lastTraceparent();
    expect(tp).toBeDefined();
    expect((tp as string).endsWith("-00")).toBe(true);
  });
});
