/**
 * JSON Summary Generator — machine-readable execution summary
 * Outputs a versioned JSON file with full metrics, checks, and threshold results.
 * Compatible with auto-comparison engine (Phase 4 full implementation).
 *
 * T-192 (Phase 9): Added extendedMetrics field from MetricsEngine output.
 */

import { ExecutionContext, buildExecutionSummary } from "../core/execution-engine";
import type { MetricsReport } from "../metrics/types";

const SCHEMA_VERSION = "2.0.0";
// Published schema for auto-validation (T-161 CHK-UX-005)
const SCHEMA_REF =
  "https://github.com/k6-enterprise/framework/blob/main/shared/schemas/summary.schema.json";

/** k6 test options to embed in the summary for downstream report generation */
export interface K6TestOptions {
  vus?: number;
  duration?: string;
  stages?: Array<{ duration: string; target: number }>;
  scenarios?: Record<string, unknown>;
  thresholds?: Record<string, string[]>;
}

export interface JsonSummaryOutput {
  /** JSON Schema reference for auto-validation */
  $schema: string;
  schemaVersion: string;
  generatedAt: string;
  /** Human-readable format: typescript | json | yaml */
  definitionFormat?: string;
  summary: ReturnType<typeof buildExecutionSummary>;
  /** k6 test options (stages, scenarios, thresholds) for report charts */
  options?: K6TestOptions;
  rawMetrics?: Record<string, unknown>;
  /** Generator health snapshot (CPU, memory) — injected post-run */
  generatorHealth?: {
    cpu: number[];
    memory: number[];
    loadAvg1m: number;
    warnings: string[];
    capturedAt: string;
  };
  /**
   * T-192: Extended metrics from the Metrics Engine (Phase 9).
   * Grouped by domain category: performance, throughput, error, sla, ...
   */
  extendedMetrics?: MetricsReport;
}

/**
 * Generate a JSON summary from k6 handleSummary data.
 * Call inside handleSummary() to produce the structured output file.
 *
 * @example
 * export function handleSummary(data) {
 *   return generateJsonSummary(data, context, "./reports/summary.json", {
 *     k6Options: options, // pass the exported k6 options for VU/stage charts
 *   });
 * }
 */
export function generateJsonSummary(
  data: Record<string, unknown>,
  context: ExecutionContext,
  outputPath: string,
  opts?: {
    includeRawMetrics?: boolean;
    definitionFormat?: "typescript" | "json" | "yaml";
    extendedMetrics?: MetricsReport;
    /** k6 test options (stages, scenarios, thresholds) — enables VU Distribution and Load Profile charts in k6-report */
    k6Options?: K6TestOptions;
  }
): Record<string, string>;
/**
 * @deprecated Use the options-object overload instead.
 */
export function generateJsonSummary(
  data: Record<string, unknown>,
  context: ExecutionContext,
  outputPath: string,
  includeRawMetrics: boolean,
  definitionFormat?: "typescript" | "json" | "yaml",
  extendedMetrics?: MetricsReport
): Record<string, string>;
export function generateJsonSummary(
  data: Record<string, unknown>,
  context: ExecutionContext,
  outputPath: string,
  optsOrIncludeRaw:
    | boolean
    | {
        includeRawMetrics?: boolean;
        definitionFormat?: "typescript" | "json" | "yaml";
        extendedMetrics?: MetricsReport;
        k6Options?: K6TestOptions;
      } = {},
  definitionFormatLegacy?: "typescript" | "json" | "yaml",
  extendedMetricsLegacy?: MetricsReport
): Record<string, string> {
  // Normalize legacy positional args to options object
  const opts =
    typeof optsOrIncludeRaw === "boolean"
      ? {
          includeRawMetrics: optsOrIncludeRaw,
          definitionFormat: definitionFormatLegacy ?? "typescript",
          extendedMetrics: extendedMetricsLegacy,
        }
      : optsOrIncludeRaw;

  const includeRawMetrics = opts.includeRawMetrics ?? false;
  const definitionFormat = opts.definitionFormat ?? "typescript";
  const extendedMetrics = opts.extendedMetrics;
  const k6Options = opts.k6Options;

  const summary = buildExecutionSummary(data, context);

  const output: JsonSummaryOutput = {
    $schema: SCHEMA_REF,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    definitionFormat,
    summary,
    ...(k6Options ? { options: k6Options } : {}),
    ...(includeRawMetrics ? { rawMetrics: data["metrics"] as Record<string, unknown> } : {}),
    ...(extendedMetrics ? { extendedMetrics } : {}),
  };

  return {
    [outputPath]: JSON.stringify(output, null, 2),
  };
}
