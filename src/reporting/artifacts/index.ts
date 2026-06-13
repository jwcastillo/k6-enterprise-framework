/**
 * Phase 6 / DX-06 — Artifact-generation pipeline barrel.
 *
 * Entry point `generateArtifacts(input)` returns an `ArtifactsBundle`
 * (paths + content strings + warnings). The CLI wrapper at
 * `bin/generate-artifacts.js` is responsible for actually writing the
 * returned content to disk (D-18, D-21).
 *
 * Sub-modules are pure: they accept inputs and return strings/objects,
 * never touching the filesystem. This keeps them snapshot-testable in
 * Vitest without any fs mocks (D-19, COV-06).
 */

export type {
  ArtifactsInput,
  ArtifactsBundle,
  ArtifactOptions,
  RunMeta,
  K6Summary,
  K6MetricEntry,
  BuiltSummary,
} from "./types";
export { SLA_DEFAULTS } from "./types";

export { buildSummary } from "./summary-builder";
export { generateCsv } from "./csv-generator";
export { generateHtml } from "./html-generator";
export type { ArtifactPaths, GenerateHtmlInput } from "./html-generator";
export { renderCharts } from "./charts";
export { buildMessage } from "./message-builder";
export { buildAnalysis } from "./analysis-builder";
export type { BuildAnalysisInput } from "./analysis-builder";
export { enrichSummary } from "./json-enricher";
export type { GeneratorHealth, EnrichSummaryInput } from "./json-enricher";

import type { ArtifactsInput, ArtifactsBundle } from "./types";
import { buildSummary } from "./summary-builder";
import { generateCsv } from "./csv-generator";
import { generateHtml } from "./html-generator";
import { renderCharts } from "./charts";
import { buildMessage } from "./message-builder";
import { buildAnalysis } from "./analysis-builder";

/**
 * Compose every artifact body the pipeline can produce from a single k6
 * summary + run metadata. Pure: returns paths + content strings, never
 * writes to disk. The CLI wrapper at `bin/generate-artifacts.js` consumes
 * the bundle and persists it.
 *
 * @example
 * import { generateArtifacts } from "@reporting/artifacts";
 * const bundle = generateArtifacts({
 *   k6Summary,
 *   meta: { runId, timestamp, scenario, profile, env, client, exitCode },
 *   outputDir: "./reports",
 * });
 * // wrapper writes bundle.metricsCsv to bundle.metricsCsvPath, etc.
 */
export function generateArtifacts(input: ArtifactsInput): ArtifactsBundle {
  const { k6Summary, meta, outputDir, options } = input;
  const opts = {
    includeCsv: options?.includeCsv ?? true,
    includeHtml: options?.includeHtml ?? Boolean(input.htmlInputPath),
    includeCharts: options?.includeCharts ?? true,
    includeAnalysis: options?.includeAnalysis ?? true,
    includeMessage: options?.includeMessage ?? true,
  };

  const built = buildSummary(k6Summary);
  const warnings: string[] = [];

  // Derive timestamp slug for path composition (matches legacy convention).
  const slug = meta.timestamp || new Date().toISOString().replace(/[:.]/g, "-");

  const metricsCsvPath = `${outputDir}/metrics-${slug}.csv`;
  const analysisPath = `${outputDir}/analysis-${slug}.md`;
  const messagePath = `${outputDir}/message-${slug}.md`;

  const bundle: ArtifactsBundle = { warnings };

  if (opts.includeCsv) {
    try {
      bundle.metricsCsv = generateCsv(k6Summary);
      bundle.metricsCsvPath = metricsCsvPath;
    } catch (e) {
      warnings.push(`csv-generator failed: ${(e as Error).message}`);
    }
  }

  if (opts.includeAnalysis) {
    try {
      bundle.analysisMarkdown = buildAnalysis({ built, meta });
      bundle.analysisPath = analysisPath;
    } catch (e) {
      warnings.push(`analysis-builder failed: ${(e as Error).message}`);
    }
  }

  if (opts.includeMessage) {
    try {
      bundle.messageMarkdown = buildMessage({ built, meta });
      bundle.messagePath = messagePath;
    } catch (e) {
      warnings.push(`message-builder failed: ${(e as Error).message}`);
    }
  }

  if (opts.includeHtml && input.htmlInputPath) {
    try {
      const banner = generateHtml({
        summary: k6Summary,
        built,
        meta,
        artifactPaths: {
          metricsCsvBasename: `metrics-${slug}.csv`,
          analysisBasename: `analysis-${slug}.md`,
          messageBasename: `message-${slug}.md`,
          summaryBasename: `summary-${slug}.json`,
        },
      });
      const charts = opts.includeCharts ? renderCharts({ built }) : "";
      bundle.injectedHtml = banner + charts;
      bundle.htmlOutputPath = input.htmlInputPath;
    } catch (e) {
      warnings.push(`html-generator failed: ${(e as Error).message}`);
    }
  }

  return bundle;
}
