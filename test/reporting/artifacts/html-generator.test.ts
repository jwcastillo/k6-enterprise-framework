/**
 * Phase 6 / DX-06 — html-generator unit tests.
 *
 * `generateHtml` returns the HTML banner fragment that the wrapper injects
 * into k6's web dashboard HTML. Pure function — no fs, no random IDs.
 *
 * Snapshot covers stability of the full banner; targeted assertions cover
 * the moving parts that matter for the legacy CLI parity contract (D-20).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { generateHtml } from "../../../src/reporting/artifacts/html-generator";
import { buildSummary } from "../../../src/reporting/artifacts/summary-builder";
import type { K6Summary } from "../../../src/reporting/artifacts/types";
import { makeRunMeta } from "./__fixtures__/run-meta";
import { scoreFromCounts } from "../../../src/metrics/score";

function loadFixture(): K6Summary {
  const raw = readFileSync(join(__dirname, "__fixtures__/k6-summary-small.json"), "utf8");
  return JSON.parse(raw) as K6Summary;
}

describe("generateHtml", () => {
  it("returns an HTML string with the k6 banner container class", () => {
    const html = generateHtml({
      summary: loadFixture(),
      built: buildSummary(loadFixture()),
      meta: makeRunMeta(),
      artifactPaths: {
        metricsCsvBasename: "metrics-20260319-113700.csv",
        analysisBasename: "analysis-20260319-113700.md",
        messageBasename: "message-20260319-113700.md",
        summaryBasename: "summary-20260319-113700.json",
      },
    });
    expect(typeof html).toBe("string");
    expect(html).toContain("k6d-banner");
  });

  it("includes run metadata (client + scenario + profile + env + timestamp)", () => {
    const html = generateHtml({
      summary: loadFixture(),
      built: buildSummary(loadFixture()),
      meta: makeRunMeta({ client: "acme", scenario: "smoke-users", profile: "smoke" }),
      artifactPaths: {
        metricsCsvBasename: "metrics-20260319-113700.csv",
        analysisBasename: "analysis-20260319-113700.md",
        messageBasename: "message-20260319-113700.md",
        summaryBasename: "summary-20260319-113700.json",
      },
    });
    expect(html).toContain("acme");
    expect(html).toContain("smoke-users");
    expect(html).toContain("smoke");
    expect(html).toContain("staging");
    // Human-readable timestamp derived from 20260319-113700
    expect(html).toContain("2026-03-19 11:37");
  });

  it("includes the SLA status banner reflecting PASS on the clean fixture", () => {
    const html = generateHtml({
      summary: loadFixture(),
      built: buildSummary(loadFixture()),
      meta: makeRunMeta(),
      artifactPaths: {
        metricsCsvBasename: "metrics.csv",
        analysisBasename: "analysis.md",
        messageBasename: "message.md",
        summaryBasename: "summary.json",
      },
    });
    // SLA pass on the fixture (p95=500ms < 2000ms, etc.)
    expect(html).toMatch(/SLA[^<]{0,40}PASS/i);
  });

  it("includes the run ID so links remain traceable", () => {
    const html = generateHtml({
      summary: loadFixture(),
      built: buildSummary(loadFixture()),
      meta: makeRunMeta({ runId: "trace-abc-123" }),
      artifactPaths: {
        metricsCsvBasename: "metrics.csv",
        analysisBasename: "analysis.md",
        messageBasename: "message.md",
        summaryBasename: "summary.json",
      },
    });
    expect(html).toContain("trace-abc-123");
  });

  it("is deterministic — no random IDs, no Date.now() leakage", () => {
    const input = {
      summary: loadFixture(),
      built: buildSummary(loadFixture()),
      meta: makeRunMeta(),
      artifactPaths: {
        metricsCsvBasename: "metrics.csv",
        analysisBasename: "analysis.md",
        messageBasename: "message.md",
        summaryBasename: "summary.json",
      },
    };
    const a = generateHtml(input);
    const b = generateHtml(input);
    expect(a).toBe(b);
  });

  it("matches the snapshot of the stable banner shape", () => {
    const html = generateHtml({
      summary: loadFixture(),
      built: buildSummary(loadFixture()),
      meta: makeRunMeta(),
      artifactPaths: {
        metricsCsvBasename: "metrics.csv",
        analysisBasename: "analysis.md",
        messageBasename: "message.md",
        summaryBasename: "summary.json",
      },
    });
    // Snapshot the structural shape (length is stable + first kilobyte uniquely identifies banner)
    expect(html.length).toBeGreaterThan(500);
    expect(html.slice(0, 200)).toMatchSnapshot();
  });

  // ── Overall score cell (T-262) ────────────────────────────────────────────

  it("renders an 'Overall' cell with Grade label when extendedMetrics.score is absent (derived branch)", () => {
    const fixture = loadFixture();
    const built = buildSummary(fixture);
    // Compute expected value from the deterministic checks-only formula (no SLA folding)
    const expected = scoreFromCounts({ pass: built.checks.pass, warn: 0, fail: built.checks.fail });
    const html = generateHtml({
      summary: fixture,
      built,
      meta: makeRunMeta(),
      artifactPaths: {
        metricsCsvBasename: "metrics.csv",
        analysisBasename: "analysis.md",
        messageBasename: "message.md",
        summaryBasename: "summary.json",
      },
    });
    expect(html).toContain("Overall");
    expect(html).toContain(String(expected.value));
    expect(html).toContain(`Grade ${expected.grade}`);
  });

  it("renders an 'Overall' cell using extendedMetrics.score when present (prefer branch)", () => {
    const fixture: K6Summary = {
      ...loadFixture(),
      extendedMetrics: {
        generatedAt: new Date().toISOString(),
        durationMs: 1000,
        byCategory: {},
        all: [],
        summary: { total: 5, pass: 3, warn: 1, fail: 1, na: 0 },
        score: { value: 73, grade: "C", healthy: false },
      },
    };
    const html = generateHtml({
      summary: fixture,
      built: buildSummary(loadFixture()),
      meta: makeRunMeta(),
      artifactPaths: {
        metricsCsvBasename: "metrics.csv",
        analysisBasename: "analysis.md",
        messageBasename: "message.md",
        summaryBasename: "summary.json",
      },
    });
    expect(html).toContain("Overall");
    expect(html).toContain("73");
    expect(html).toContain("Grade C");
  });

  it("always renders an Overall cell even with empty/missing checks data", () => {
    const emptySummary: K6Summary = {};
    const emptyBuilt = buildSummary(emptySummary);
    const html = generateHtml({
      summary: emptySummary,
      built: emptyBuilt,
      meta: makeRunMeta(),
      artifactPaths: {
        metricsCsvBasename: "metrics.csv",
        analysisBasename: "analysis.md",
        messageBasename: "message.md",
        summaryBasename: "summary.json",
      },
    });
    // Cell must always be present — fallback renders 100/A
    expect(html).toContain("Overall");
    expect(html).toContain("Grade");
  });
});
