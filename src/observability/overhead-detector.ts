/**
 * T-050: Overhead warnings and scaling guide
 *
 * Detects conditions that may distort test results:
 * - Debug/structured logging active during formal tests
 * - Chaos testing active during formal tests
 * - High VU count suggesting distributed execution
 * - Framework overhead exceeding expected thresholds
 *
 * Emits actionable warnings with remediation steps.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OverheadWarning {
  severity: "warning" | "info";
  code: string;
  message: string;
  remediation: string;
}

// ── Profile classification ────────────────────────────────────────────────────

const FORMAL_PROFILES = ["load", "rampup", "capacity", "stress", "spike", "breakpoint", "soak"];
const VU_DISTRIBUTION_THRESHOLD = 5000;
const OVERHEAD_THRESHOLD_MS = 2;

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Detect overhead conditions before test execution.
 *
 * @param profile - Active load profile name
 * @param options - Current execution configuration
 * @returns Array of warnings (empty if no issues)
 */
export function detectOverheadConditions(
  profile: string,
  options: {
    debug?: boolean;
    structuredLogs?: boolean;
    chaosEnabled?: boolean;
    maxVUs?: number;
  },
): OverheadWarning[] {
  const warnings: OverheadWarning[] = [];
  const isFormal = FORMAL_PROFILES.includes(profile);

  // Debug logging during formal test
  if (isFormal && options.debug) {
    warnings.push({
      severity: "warning",
      code: "OVERHEAD_DEBUG",
      message:
        `Debug logging is active during '${profile}' test. ` +
        `Results may include I/O overhead from verbose logging.`,
      remediation:
        "Disable debug: remove --debug flag or set K6_DEBUG=false",
    });
  }

  // Structured logging during formal test
  if (isFormal && options.structuredLogs) {
    warnings.push({
      severity: "warning",
      code: "OVERHEAD_STRUCTURED_LOGS",
      message:
        `Structured logging is active during '${profile}' test. ` +
        `JSON serialization adds measurable I/O overhead.`,
      remediation:
        "Disable structured logs: remove --structured-logs or set K6_STRUCTURED_LOGS=false",
    });
  }

  // Chaos testing during formal test
  if (isFormal && options.chaosEnabled) {
    warnings.push({
      severity: "warning",
      code: "OVERHEAD_CHAOS",
      message:
        `Chaos injection is active during '${profile}' test. ` +
        `Injected faults will appear in results — use chaos report section to differentiate.`,
      remediation:
        "To get clean results, set chaos.enabled=false in config/chaos.json",
    });
  }

  // High VU count suggesting distributed execution
  if (options.maxVUs && options.maxVUs > VU_DISTRIBUTION_THRESHOLD) {
    warnings.push({
      severity: "info",
      code: "SCALE_DISTRIBUTED",
      message:
        `Configured ${options.maxVUs} VUs exceeds single-node recommendation (${VU_DISTRIBUTION_THRESHOLD}). ` +
        `Consider distributed execution for accurate results.`,
      remediation:
        "See docs/BENCHMARKING.md for k6-operator setup and distributed execution guide",
    });
  }

  return warnings;
}

/**
 * Check if framework overhead exceeds the expected threshold.
 * Call after a benchmark run to generate recommendations.
 *
 * @param overheadMs - Measured per-request overhead in ms
 * @returns Warnings with probable causes
 */
export function checkOverheadThreshold(
  overheadMs: number,
): OverheadWarning[] {
  const warnings: OverheadWarning[] = [];

  if (overheadMs > OVERHEAD_THRESHOLD_MS) {
    warnings.push({
      severity: "warning",
      code: "OVERHEAD_HIGH",
      message:
        `Framework overhead is ${overheadMs.toFixed(2)}ms per request ` +
        `(threshold: ${OVERHEAD_THRESHOLD_MS}ms).`,
      remediation: [
        "Probable causes and fixes:",
        "  1. Heavy xk6 extensions — review loaded extensions",
        "  2. Many checks per request — consolidate into fewer composite checks",
        "  3. Verbose logging — disable structured logs for production tests",
        "  4. Complex data transformations — pre-compute in setup()",
      ].join("\n"),
    });
  }

  return warnings;
}

/**
 * Format warnings for console output.
 */
export function formatWarningsForConsole(warnings: OverheadWarning[]): string {
  if (warnings.length === 0) return "";

  const lines = warnings.map((w) => {
    const icon = w.severity === "warning" ? "⚠" : "ℹ";
    return `${icon} [${w.code}] ${w.message}\n  → ${w.remediation}`;
  });

  return `\n${"─".repeat(60)}\n${lines.join("\n\n")}\n${"─".repeat(60)}\n`;
}

/**
 * Format warnings for inclusion in reports.
 */
export function formatWarningsForJson(
  warnings: OverheadWarning[],
): Record<string, unknown> {
  return {
    overheadWarnings: warnings.map((w) => ({
      severity: w.severity,
      code: w.code,
      message: w.message,
      remediation: w.remediation,
    })),
  };
}
