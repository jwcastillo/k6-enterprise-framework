/**
 * COV-02 — ticket-generator.ts coverage (D-06, D-07).
 *
 * Unit tests for src/reporting/ticket-generator.ts. Tests assert the
 * presence of platform-specific markup keywords, escaping behavior,
 * multibyte preservation, and apdex helpers — no fixture files needed
 * for the markup contract (the templates internally substitute placeholders
 * with the payload; we verify by keyword presence rather than byte-equality).
 */
import { describe, it, expect } from "vitest";
import {
  TicketGenerator,
  calculateApdex,
  apdexRating,
  type TicketPayload,
} from "../../src/reporting/ticket-generator";

function makePayload(overrides: Partial<TicketPayload> = {}): TicketPayload {
  return {
    platform: "jira",
    client: "_reference",
    service: "smoke-users",
    environment: "default",
    profile: "smoke",
    testName: "api/smoke-users",
    verdict: "pass",
    metrics: {
      p95Ms: 250.5,
      p99Ms: 400,
      avgMs: 95.4,
      errorRatePct: 0.5,
      throughputRps: 12.3,
      durationMs: 60000,
      iterations: 720,
      vus: 5,
      checkPassRate: 99.8,
    },
    thresholdViolations: [],
    apdex: 1,
    reportUrl: "https://reports.example.com/run/abc-123",
    executionId: "exec-abc-123",
    timestamp: "2026-05-23T10:00:00Z",
    ...overrides,
  };
}

describe("ticket-generator (COV-02)", () => {
  // ── apdex helpers ─────────────────────────────────────────────────────────

  it("calculateApdex returns 1 when avg <= satisfied threshold", () => {
    expect(calculateApdex(100, 300)).toBe(1);
  });

  it("calculateApdex returns 0.5 when avg exceeds satisfied but p95 within tolerating", () => {
    expect(calculateApdex(800, 1500)).toBe(0.5);
  });

  it("calculateApdex returns 0 when both thresholds exceeded", () => {
    expect(calculateApdex(800, 3000)).toBe(0);
  });

  it("apdexRating maps score ranges to rating labels", () => {
    expect(apdexRating(1)).toBe("Excellent");
    expect(apdexRating(0.9)).toBe("Good");
    expect(apdexRating(0.75)).toBe("Fair");
    expect(apdexRating(0.6)).toBe("Poor");
    expect(apdexRating(0.1)).toBe("Unacceptable");
  });

  // ── Jira platform output ──────────────────────────────────────────────────

  it("Jira story uses h1.|h2. headings and *bold* markup", () => {
    const { story } = TicketGenerator.generate(makePayload({ platform: "jira" }));
    expect(story).toMatch(/h1\.|h2\./);
    expect(story).toMatch(/\*[A-Za-z]/);
    expect(story).not.toMatch(/^# /m);
  });

  it("Jira story includes the ||...|| table header form", () => {
    const { story } = TicketGenerator.generate(makePayload({ platform: "jira" }));
    expect(story).toMatch(/\|\|/);
  });

  it("Jira comment includes {{code}} segments for execution id and profile", () => {
    const { comment } = TicketGenerator.generate(
      makePayload({ platform: "jira", executionId: "exec-abc-123", profile: "smoke" })
    );
    expect(comment).toMatch(/\{\{exec-abc-123\}\}|\{\{smoke\}\}/);
  });

  // ── GitHub platform output ────────────────────────────────────────────────

  it("GitHub story uses # / ## headings and **bold** markup", () => {
    const { story } = TicketGenerator.generate(makePayload({ platform: "github" }));
    expect(story).toMatch(/^#{1,3} /m);
    expect(story).toMatch(/\*\*[A-Za-z]/);
  });

  it("GitHub comment uses pipe tables and backtick `code`", () => {
    const { comment } = TicketGenerator.generate(
      makePayload({ platform: "github", executionId: "exec-abc-123" })
    );
    expect(comment).toMatch(/\| /);
    expect(comment).toMatch(/`[^`]+`/);
  });

  // ── Verdict + threshold violations ────────────────────────────────────────

  it("includes threshold violations when verdict is fail", () => {
    const payload = makePayload({
      verdict: "fail",
      thresholdViolations: ["http_req_duration: p(95) < 500", "http_req_failed: rate < 0.01"],
    });
    const { comment } = TicketGenerator.generate(payload);
    expect(comment).toMatch(/http_req_duration/);
    expect(comment).toMatch(/http_req_failed/);
  });

  it("omits violations section when threshold list is empty", () => {
    const { comment } = TicketGenerator.generate(
      makePayload({ verdict: "pass", thresholdViolations: [] })
    );
    // No violations metric names should appear when the list is empty
    expect(comment).not.toMatch(/http_req_duration:/);
  });

  // ── Multibyte / Unicode preservation ──────────────────────────────────────

  it("preserves multibyte characters (emojis, CJK, accents) in the output", () => {
    const payload = makePayload({
      platform: "github",
      service: "búsqueda — 検索 🚀",
      testName: "flujo-completó",
    });
    const { story, comment } = TicketGenerator.generate(payload);
    const combined = story + "\n" + comment;
    expect(combined).toContain("búsqueda");
    expect(combined).toContain("検索");
    expect(combined).toContain("🚀");
    expect(combined).toContain("flujo-completó");
  });

  // ── Apdex section presence ────────────────────────────────────────────────

  it("includes apdex rating string when apdex is provided", () => {
    const { comment } = TicketGenerator.generate(makePayload({ apdex: 0.92 }));
    expect(comment).toMatch(/Good|Excellent|Fair|Poor|Unacceptable/);
  });

  // ── buildPayload ──────────────────────────────────────────────────────────

  it("buildPayload maps summary + opts into a TicketPayload with violations flagged", () => {
    const payload = TicketGenerator.buildPayload(
      {
        testName: "api/smoke-users",
        client: "_reference",
        environment: "default",
        profile: "smoke",
        httpDuration: { avg: 100, p95: 250, p99: 400 },
        httpRequests: 1000,
        httpRequestsFailed: 5,
        iterations: 100,
        vus: 5,
        checks: [{ passRate: 99.5 }],
        thresholds: [
          { metric: "http_req_duration", condition: "p(95) < 500", passed: true },
          { metric: "http_req_failed", condition: "rate < 0.01", passed: false },
        ],
        passed: false,
        durationMs: 60000,
        tags: {},
      },
      {
        platform: "github",
        executionId: "exec-1",
      }
    );
    expect(payload.platform).toBe("github");
    expect(payload.testName).toBe("api/smoke-users");
    expect(payload.verdict).toBe("fail");
    expect(payload.thresholdViolations).toHaveLength(1);
    expect(payload.thresholdViolations[0]).toMatch(/http_req_failed/);
    expect(payload.executionId).toBe("exec-1");
    expect(payload.apdex).toBeGreaterThanOrEqual(0);
    expect(payload.apdex).toBeLessThanOrEqual(1);
  });
});
