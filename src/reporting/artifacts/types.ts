/**
 * Phase 6 / DX-06 — Typed contracts for the artifact-generation pipeline.
 *
 * The legacy `bin/generate-artifacts.js` was a 2,644-LOC monolith mixing
 * argument parsing, file I/O, k6-summary aggregation, HTML rendering, CSV
 * writing, JSON enrichment and message templating. Phase 6 splits that
 * monolith into pure TypeScript sub-modules under `src/reporting/artifacts/`,
 * with a thin CLI wrapper (≤200 LOC) that only handles argv + fs.
 *
 * See `.planning/phases/06-developer-experience-documentation/06-CONTEXT.md`
 * decisions D-17..D-21 for the design rationale.
 */

import type { MetricsReport } from "../../metrics/types";

/**
 * Raw k6 summary JSON shape — what `handleSummary` produces and what the
 * generator reads from disk. We model only the slice the generator touches.
 *
 * NOTE: `[key: string]: unknown` keeps the shape extensible (k6 may emit
 * custom metrics, browser web vitals, group durations, etc. — all are
 * indexed under `metrics`).
 */
export interface K6Summary {
  metrics?: Record<string, K6MetricEntry>;
  root_group?: { groups?: Record<string, unknown> };
  generatorHealth?: unknown;
  schemaVersion?: string;
  reportMeta?: unknown;
  /** Optional: pre-computed metrics report from MetricsEngine; used by html-generator for Overall score. */
  extendedMetrics?: MetricsReport;
  [key: string]: unknown;
}

/**
 * Single metric entry as emitted by k6 inside the `metrics` object.
 * All numeric fields are optional because not every metric type carries them.
 */
export interface K6MetricEntry {
  type?: string;
  count?: number;
  rate?: number;
  avg?: number;
  min?: number;
  med?: number;
  max?: number;
  "p(90)"?: number;
  "p(95)"?: number;
  "p(99)"?: number;
  value?: number;
  passes?: number;
  fails?: number;
  thresholds?: Record<string, boolean>;
  [key: string]: unknown;
}

/**
 * Per-run identity captured from the CLI invocation and stamped into every
 * artifact (HTML banner, CSV header, analysis MD, message MD).
 */
export interface RunMeta {
  runId: string;
  /** Compact ISO-like timestamp such as `20260319-113700`. */
  timestamp: string;
  scenario: string;
  profile: string;
  env: string;
  client: string;
  /** Optional free-form label, e.g. "after pool-size tuning". */
  runLabel?: string;
  /** k6 exit code: 0 pass, 99 threshold failure, others error. */
  exitCode: number;
  /** Optional Jira / GitHub story tag. */
  storyId?: string;
  storyUrl?: string;
}

/**
 * Optional toggles controlling which artifacts the pipeline produces.
 * Defaults: all artifacts the wrapper can build given the inputs it received.
 */
export interface ArtifactOptions {
  includeHtml?: boolean;
  includeCsv?: boolean;
  includeCharts?: boolean;
  includeAnalysis?: boolean;
  includeMessage?: boolean;
  includeJsonEnrichment?: boolean;
}

/**
 * Input bundle accepted by `generateArtifacts`. The CLI wrapper assembles
 * this from argv + filesystem reads; downstream callers can build it
 * directly in-process.
 *
 * `htmlInputPath` is optional because the HTML banner is injected into k6's
 * own web-dashboard HTML — when k6 was not asked to emit one, the HTML
 * sub-module is skipped gracefully.
 *
 * @example
 * const bundle = generateArtifacts({
 *   k6Summary: JSON.parse(fs.readFileSync("summary.json", "utf8")),
 *   meta: { runId: "abc", timestamp: "20260319-113700", scenario: "smoke",
 *           profile: "smoke", env: "staging", client: "acme", exitCode: 0 },
 *   outputDir: "./reports",
 * });
 */
export interface ArtifactsInput {
  k6Summary: K6Summary;
  meta: RunMeta;
  outputDir: string;
  htmlInputPath?: string;
  comparisonMarkdownPath?: string;
  options?: ArtifactOptions;
}

/**
 * Resolved-but-not-yet-written artifact bundle. Every field is either a
 * string of content (the wrapper writes it to disk) or a path that points
 * at a file the wrapper enriched in place. `Maybe`-shaped because some
 * artifacts may be skipped depending on `ArtifactOptions`.
 */
export interface ArtifactsBundle {
  /** Path of the metrics CSV the wrapper should write. */
  metricsCsvPath?: string;
  /** CSV body the wrapper should write to `metricsCsvPath`. */
  metricsCsv?: string;
  /** Path of the analysis markdown the wrapper should write. */
  analysisPath?: string;
  /** Analysis markdown body. */
  analysisMarkdown?: string;
  /** Path of the message markdown the wrapper should write. */
  messagePath?: string;
  /** Message markdown body. */
  messageMarkdown?: string;
  /**
   * When HTML injection was performed in-memory, the rewritten HTML body
   * the wrapper should overwrite the input file with. Absent when the
   * wrapper had no HTML input to enrich.
   */
  injectedHtml?: string;
  /** Path the wrapper should write the rewritten HTML to. */
  htmlOutputPath?: string;
  /** Enriched k6 summary JSON the wrapper should overwrite the input file with. */
  enrichedSummary?: K6Summary;
  /** Path the wrapper should overwrite with `enrichedSummary`. */
  enrichedSummaryPath?: string;
  /**
   * Free-form structured warnings emitted by sub-modules. The wrapper
   * forwards these to stderr but they never abort the pipeline.
   */
  warnings: string[];
}

/**
 * Aggregated, computed view of a k6 summary shared by every downstream
 * generator (HTML banner, CSV writer, analysis MD, message MD). Producing
 * this once in `summary-builder` keeps the sub-modules pure and snapshot
 * testable.
 */
export interface BuiltSummary {
  /** Convenience pointer into `K6Summary.metrics`. */
  metrics: Record<string, K6MetricEntry>;
  /** Pass/fail/total/rate aggregated from `metrics.checks`. */
  checks: {
    pass: number;
    fail: number;
    total: number;
    rate: number;
  };
  /** Top-line http_req_duration percentiles in milliseconds. */
  latency: {
    avgMs: number | null;
    minMs: number | null;
    p50Ms: number | null;
    p90Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
  };
  /** http_req_failed → 0..100 (percent). */
  errorRatePct: number | null;
  /** Maximum concurrent VUs reported by k6. */
  maxVus: number | null;
  /** Total request count + throughput (req/s). */
  http: {
    totalRequests: number | null;
    ratePerSec: number | null;
  };
  /** Iteration count. */
  iterations: number | null;
  /** APDEX score + qualitative label/color computed from p50/p90/p99. */
  apdex: {
    score: number | null;
    label: string;
    color: string;
  };
  /** SLA evaluation against the framework defaults (see SLA_DEFAULTS). */
  sla: {
    p95Ok: boolean | null;
    p99Ok: boolean | null;
    errorRateOk: boolean | null;
    checksOk: boolean;
    pass: boolean;
    violations: string[];
  };
}

/**
 * Default SLA thresholds — preserved verbatim from the legacy monolith so
 * that observable CLI output stays identical (D-20: backward compat).
 */
export const SLA_DEFAULTS = {
  p95Ms: 2000,
  p99Ms: 5000,
  errorRatePct: 1.0,
  checksPct: 95,
  /** APDEX `T` (satisfied threshold). */
  apdexT: 500,
  /** APDEX `F` (tolerating threshold). */
  apdexF: 2000,
} as const;
