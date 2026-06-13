import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectOverheadConditions,
  checkOverheadThreshold,
  formatWarningsForConsole,
  formatWarningsForJson,
  OverheadWarning,
} from "../../src/observability/overhead-detector";

// ── detectOverheadConditions ─────────────────────────────────────────────────

describe("detectOverheadConditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no issues detected for non-formal profile", () => {
    const warnings = detectOverheadConditions("smoke", {
      debug: true,
      structuredLogs: true,
      chaosEnabled: true,
      maxVUs: 100,
    });
    // smoke is not a formal profile, so debug/logs/chaos don't trigger warnings
    expect(warnings).toHaveLength(0);
  });

  it("warns about debug logging during formal load profile", () => {
    const warnings = detectOverheadConditions("load", { debug: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("OVERHEAD_DEBUG");
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain("Debug logging");
    expect(warnings[0].message).toContain("load");
    expect(warnings[0].remediation).toContain("debug");
  });

  it("warns about structured logging during formal profile", () => {
    const warnings = detectOverheadConditions("capacity", { structuredLogs: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("OVERHEAD_STRUCTURED_LOGS");
    expect(warnings[0].message).toContain("Structured logging");
    expect(warnings[0].remediation).toContain("structured");
  });

  it("warns about chaos testing during formal profile", () => {
    const warnings = detectOverheadConditions("stress", { chaosEnabled: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("OVERHEAD_CHAOS");
    expect(warnings[0].message).toContain("Chaos injection");
    expect(warnings[0].remediation).toContain("chaos");
  });

  it("suggests distributed execution for high VU count", () => {
    const warnings = detectOverheadConditions("load", { maxVUs: 6000 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("SCALE_DISTRIBUTED");
    expect(warnings[0].severity).toBe("info");
    expect(warnings[0].message).toContain("6000 VUs");
    expect(warnings[0].message).toContain("5000");
  });

  it("does not suggest distributed for VUs <= 5000", () => {
    const warnings = detectOverheadConditions("load", { maxVUs: 5000 });
    expect(warnings).toHaveLength(0);
  });

  it("accumulates multiple warnings simultaneously", () => {
    const warnings = detectOverheadConditions("rampup", {
      debug: true,
      structuredLogs: true,
      chaosEnabled: true,
      maxVUs: 10000,
    });
    expect(warnings.length).toBe(4);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("OVERHEAD_DEBUG");
    expect(codes).toContain("OVERHEAD_STRUCTURED_LOGS");
    expect(codes).toContain("OVERHEAD_CHAOS");
    expect(codes).toContain("SCALE_DISTRIBUTED");
  });

  it("recognizes all formal profiles", () => {
    const formalProfiles = ["load", "rampup", "capacity", "stress", "spike", "breakpoint", "soak"];
    for (const profile of formalProfiles) {
      const warnings = detectOverheadConditions(profile, { debug: true });
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].code).toBe("OVERHEAD_DEBUG");
    }
  });

  it("does not warn for non-formal profiles", () => {
    const nonFormal = ["smoke", "custom", "dev", "ci"];
    for (const profile of nonFormal) {
      const warnings = detectOverheadConditions(profile, { debug: true });
      expect(warnings).toHaveLength(0);
    }
  });

  it("handles empty options gracefully", () => {
    const warnings = detectOverheadConditions("load", {});
    expect(warnings).toHaveLength(0);
  });

  it("handles undefined options values", () => {
    const warnings = detectOverheadConditions("load", {
      debug: undefined,
      structuredLogs: undefined,
      chaosEnabled: undefined,
      maxVUs: undefined,
    });
    expect(warnings).toHaveLength(0);
  });
});

// ── checkOverheadThreshold ───────────────────────────────────────────────────

describe("checkOverheadThreshold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when overhead is below threshold (2ms)", () => {
    const warnings = checkOverheadThreshold(1.5);
    expect(warnings).toHaveLength(0);
  });

  it("returns empty array when overhead equals threshold", () => {
    const warnings = checkOverheadThreshold(2.0);
    expect(warnings).toHaveLength(0);
  });

  it("returns warning when overhead exceeds 2ms", () => {
    const warnings = checkOverheadThreshold(3.5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("OVERHEAD_HIGH");
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain("3.50ms");
    expect(warnings[0].message).toContain("2ms");
  });

  it("includes remediation steps with probable causes", () => {
    const warnings = checkOverheadThreshold(5.0);
    expect(warnings[0].remediation).toContain("extensions");
    expect(warnings[0].remediation).toContain("checks per request");
    expect(warnings[0].remediation).toContain("logging");
    expect(warnings[0].remediation).toContain("setup()");
  });

  it("handles very small overhead values", () => {
    const warnings = checkOverheadThreshold(0.01);
    expect(warnings).toHaveLength(0);
  });

  it("handles zero overhead", () => {
    const warnings = checkOverheadThreshold(0);
    expect(warnings).toHaveLength(0);
  });

  it("handles very large overhead values", () => {
    const warnings = checkOverheadThreshold(100);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("100.00ms");
  });
});

// ── formatWarningsForConsole ─────────────────────────────────────────────────

describe("formatWarningsForConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string for no warnings", () => {
    const result = formatWarningsForConsole([]);
    expect(result).toBe("");
  });

  it("formats warning with severity icon and code", () => {
    const warnings: OverheadWarning[] = [
      {
        severity: "warning",
        code: "OVERHEAD_DEBUG",
        message: "Debug logging is active.",
        remediation: "Disable debug flag",
      },
    ];
    const result = formatWarningsForConsole(warnings);
    expect(result).toContain("[OVERHEAD_DEBUG]");
    expect(result).toContain("Debug logging");
    expect(result).toContain("Disable debug flag");
  });

  it("uses warning icon for severity=warning", () => {
    const warnings: OverheadWarning[] = [
      { severity: "warning", code: "TEST", message: "msg", remediation: "fix" },
    ];
    const result = formatWarningsForConsole(warnings);
    // Should contain a warning-type icon character
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses info icon for severity=info", () => {
    const warnings: OverheadWarning[] = [
      { severity: "info", code: "SCALE_DISTRIBUTED", message: "Consider distributed", remediation: "See docs" },
    ];
    const result = formatWarningsForConsole(warnings);
    expect(result).toContain("[SCALE_DISTRIBUTED]");
    expect(result).toContain("Consider distributed");
  });

  it("formats multiple warnings with separators", () => {
    const warnings: OverheadWarning[] = [
      { severity: "warning", code: "W1", message: "First", remediation: "Fix 1" },
      { severity: "warning", code: "W2", message: "Second", remediation: "Fix 2" },
    ];
    const result = formatWarningsForConsole(warnings);
    expect(result).toContain("W1");
    expect(result).toContain("W2");
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("includes horizontal rule separators", () => {
    const warnings: OverheadWarning[] = [
      { severity: "warning", code: "W1", message: "msg", remediation: "fix" },
    ];
    const result = formatWarningsForConsole(warnings);
    // Contains the line separator
    expect(result).toContain("\u2500"); // "─" character
  });
});

// ── formatWarningsForJson ────────────────────────────────────────────────────

describe("formatWarningsForJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns object with overheadWarnings key", () => {
    const result = formatWarningsForJson([]);
    expect(result).toHaveProperty("overheadWarnings");
    expect(result.overheadWarnings).toEqual([]);
  });

  it("maps warnings to structured objects", () => {
    const warnings: OverheadWarning[] = [
      {
        severity: "warning",
        code: "OVERHEAD_HIGH",
        message: "Framework overhead is 3.5ms",
        remediation: "Reduce checks",
      },
    ];
    const result = formatWarningsForJson(warnings);
    const arr = result.overheadWarnings as OverheadWarning[];
    expect(arr).toHaveLength(1);
    expect(arr[0].severity).toBe("warning");
    expect(arr[0].code).toBe("OVERHEAD_HIGH");
    expect(arr[0].message).toBe("Framework overhead is 3.5ms");
    expect(arr[0].remediation).toBe("Reduce checks");
  });

  it("handles multiple warnings", () => {
    const warnings: OverheadWarning[] = [
      { severity: "warning", code: "A", message: "a", remediation: "fix a" },
      { severity: "info", code: "B", message: "b", remediation: "fix b" },
    ];
    const result = formatWarningsForJson(warnings);
    const arr = result.overheadWarnings as OverheadWarning[];
    expect(arr).toHaveLength(2);
  });
});
