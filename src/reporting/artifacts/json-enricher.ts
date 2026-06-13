/**
 * Phase 6 / DX-06 — json-enricher.
 *
 * Returns a NEW K6Summary object enriched with `generatorHealth`,
 * `schemaVersion`, and `reportMeta` fields — without mutating the input.
 * The wrapper handles the actual disk overwrite.
 *
 * Pure function: callers pass in the generator-health snapshot they
 * already captured (CPU%, memory MB, loadavg). No I/O, no `os.*` calls
 * inside the module itself — that responsibility lives in the wrapper so
 * sub-modules remain Vitest-friendly.
 */

import type { K6Summary, RunMeta } from "./types";

export interface GeneratorHealth {
  cpu: number[];
  memory: number[];
  loadAvg1m: number;
  warnings: string[];
  capturedAt: string;
}

export interface EnrichSummaryInput {
  summary: K6Summary;
  meta: RunMeta;
  generatorHealth: GeneratorHealth;
  maxVus?: number | null;
}

const SCHEMA_VERSION = "2.0.0";

/**
 * Produce an enriched copy of the k6 summary. Original input is not
 * mutated — important when callers want to compare before/after states.
 *
 * @example
 * const enriched = enrichSummary({ summary, meta, generatorHealth, maxVus: 50 });
 * fs.writeFileSync(summaryPath, JSON.stringify(enriched, null, 2));
 */
export function enrichSummary(input: EnrichSummaryInput): K6Summary {
  const { summary, meta, generatorHealth, maxVus } = input;
  return {
    ...summary,
    generatorHealth,
    schemaVersion: summary.schemaVersion ?? SCHEMA_VERSION,
    reportMeta: {
      scenario: meta.scenario,
      profile: meta.profile,
      env: meta.env,
      client: meta.client,
      timestamp: meta.timestamp,
      exitCode: meta.exitCode,
      vus: maxVus ?? null,
      runId: meta.runId,
      runLabel: meta.runLabel ?? "",
    },
  };
}
