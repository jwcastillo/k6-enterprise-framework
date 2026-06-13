/**
 * Unit tests for CLI argument parser (src/core/cli.ts)
 *
 * Tests cover:
 * - parseCLIArgs(): flag parsing for all supported options
 * - Default values when no args provided
 * - --scenario and --test alias
 * - Short flags: -h, -v
 * - Boolean flags: --dry-run, --watch, --parallel, --debug, --structured-logs, --verbose
 * - Value flags: --client, --profile, --env, --config, --output, --reports-dir, --summary-export
 * - Info flags: --help, --version, --list-profiles, --list-extensions
 * - Pass-through separator: --
 * - Unknown flags are ignored with warning
 * - Bare positional arguments go to extraArgs
 * - __ENV fallbacks for K6_CLIENT, K6_SCENARIO, K6_PROFILE, K6_ENV
 * - validateCLIArgs(): profile validation, scenario requirement
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCLIArgs, validateCLIArgs } from "../../src/core/cli";

describe("parseCLIArgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  // ── Default values ─────────────────────────────────────────────────────

  it("returns default values when no args provided", () => {
    const result = parseCLIArgs([]);
    expect(result.client).toBe("_reference");
    expect(result.scenario).toBe("");
    expect(result.profile).toBe("smoke");
    expect(result.env).toBe("default");
    expect(result.config).toBe("");
    expect(result.output).toBe("");
    expect(result.reportsDir).toBe("./reports");
    expect(result.summaryExport).toBe("");
    expect(result.dryRun).toBe(false);
    expect(result.watch).toBe(false);
    expect(result.parallel).toBe(false);
    expect(result.debug).toBe(false);
    expect(result.structuredLogs).toBe(false);
    expect(result.verbose).toBe(false);
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
    expect(result.listProfiles).toBe(false);
    expect(result.listExtensions).toBe(false);
    expect(result.extraArgs).toEqual([]);
  });

  // ── Execution flags ────────────────────────────────────────────────────

  it("parses --client", () => {
    const result = parseCLIArgs(["--client", "acme"]);
    expect(result.client).toBe("acme");
  });

  it("parses --scenario", () => {
    const result = parseCLIArgs(["--scenario", "checkout"]);
    expect(result.scenario).toBe("checkout");
  });

  it("parses --test as alias for --scenario", () => {
    const result = parseCLIArgs(["--test", "login-flow"]);
    expect(result.scenario).toBe("login-flow");
  });

  it("parses --profile", () => {
    const result = parseCLIArgs(["--profile", "load"]);
    expect(result.profile).toBe("load");
  });

  it("parses --env", () => {
    const result = parseCLIArgs(["--env", "production"]);
    expect(result.env).toBe("production");
  });

  it("parses --config", () => {
    const result = parseCLIArgs(["--config", "/path/to/config.json"]);
    expect(result.config).toBe("/path/to/config.json");
  });

  // ── Output flags ───────────────────────────────────────────────────────

  it("parses --output", () => {
    const result = parseCLIArgs(["--output", "json"]);
    expect(result.output).toBe("json");
  });

  it("parses --reports-dir", () => {
    const result = parseCLIArgs(["--reports-dir", "/tmp/reports"]);
    expect(result.reportsDir).toBe("/tmp/reports");
  });

  it("parses --summary-export", () => {
    const result = parseCLIArgs(["--summary-export", "summary.json"]);
    expect(result.summaryExport).toBe("summary.json");
  });

  // ── Boolean flags ──────────────────────────────────────────────────────

  it("parses --dry-run", () => {
    const result = parseCLIArgs(["--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  it("parses --watch", () => {
    const result = parseCLIArgs(["--watch"]);
    expect(result.watch).toBe(true);
  });

  it("parses --parallel", () => {
    const result = parseCLIArgs(["--parallel"]);
    expect(result.parallel).toBe(true);
  });

  it("parses --debug", () => {
    const result = parseCLIArgs(["--debug"]);
    expect(result.debug).toBe(true);
  });

  it("parses --structured-logs", () => {
    const result = parseCLIArgs(["--structured-logs"]);
    expect(result.structuredLogs).toBe(true);
  });

  it("parses --verbose", () => {
    const result = parseCLIArgs(["--verbose"]);
    expect(result.verbose).toBe(true);
  });

  // ── Info flags ─────────────────────────────────────────────────────────

  it("parses --help", () => {
    const result = parseCLIArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  it("parses -h as alias for --help", () => {
    const result = parseCLIArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  it("parses --version", () => {
    const result = parseCLIArgs(["--version"]);
    expect(result.version).toBe(true);
  });

  it("parses -v as alias for --version", () => {
    const result = parseCLIArgs(["-v"]);
    expect(result.version).toBe(true);
  });

  it("parses --list-profiles", () => {
    const result = parseCLIArgs(["--list-profiles"]);
    expect(result.listProfiles).toBe(true);
  });

  it("parses --list-extensions", () => {
    const result = parseCLIArgs(["--list-extensions"]);
    expect(result.listExtensions).toBe(true);
  });

  // ── Pass-through ──────────────────────────────────────────────────────

  it("handles -- separator for pass-through args", () => {
    const result = parseCLIArgs([
      "--client", "acme",
      "--",
      "--out", "influxdb",
      "-e", "FOO=bar",
    ]);
    expect(result.client).toBe("acme");
    expect(result.extraArgs).toEqual(["--out", "influxdb", "-e", "FOO=bar"]);
  });

  // ── Unknown and positional args ───────────────────────────────────────

  it("warns on unknown --flags and ignores them", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseCLIArgs(["--unknown-flag", "--scenario", "test"]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown option '--unknown-flag'")
    );
    expect(result.scenario).toBe("test");
    warnSpy.mockRestore();
  });

  it("pushes bare positional args to extraArgs", () => {
    const result = parseCLIArgs(["pos1", "pos2"]);
    expect(result.extraArgs).toEqual(["pos1", "pos2"]);
  });

  // ── Combined flags ────────────────────────────────────────────────────

  it("parses multiple flags together", () => {
    const result = parseCLIArgs([
      "--client", "acme",
      "--scenario", "checkout",
      "--profile", "load",
      "--env", "staging",
      "--dry-run",
      "--debug",
      "--verbose",
    ]);
    expect(result.client).toBe("acme");
    expect(result.scenario).toBe("checkout");
    expect(result.profile).toBe("load");
    expect(result.env).toBe("staging");
    expect(result.dryRun).toBe(true);
    expect(result.debug).toBe(true);
    expect(result.verbose).toBe(true);
  });

  // ── __ENV fallbacks ───────────────────────────────────────────────────

  it("falls back to K6_CLIENT env var when client is empty", () => {
    (__ENV as Record<string, string>)["K6_CLIENT"] = "env-client";
    const result = parseCLIArgs(["--client", ""]);
    expect(result.client).toBe("env-client");
  });

  it("falls back to K6_SCENARIO env var when scenario is empty", () => {
    (__ENV as Record<string, string>)["K6_SCENARIO"] = "env-scenario";
    const result = parseCLIArgs([]);
    expect(result.scenario).toBe("env-scenario");
  });

  it("falls back to K6_PROFILE env var when profile is default", () => {
    (__ENV as Record<string, string>)["K6_PROFILE"] = "stress";
    const result = parseCLIArgs([]);
    expect(result.profile).toBe("stress");
  });

  it("explicit --profile overrides K6_PROFILE env var", () => {
    (__ENV as Record<string, string>)["K6_PROFILE"] = "stress";
    const result = parseCLIArgs(["--profile", "load"]);
    expect(result.profile).toBe("load");
  });

  it("falls back to K6_ENV env var when env is default", () => {
    (__ENV as Record<string, string>)["K6_ENV"] = "production";
    const result = parseCLIArgs([]);
    expect(result.env).toBe("production");
  });
});

describe("validateCLIArgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no errors for valid args", () => {
    const args = parseCLIArgs(["--scenario", "checkout", "--profile", "load"]);
    const errors = validateCLIArgs(args);
    expect(errors).toHaveLength(0);
  });

  it("returns error for invalid profile", () => {
    const args = parseCLIArgs(["--scenario", "test", "--profile", "invalid"]);
    const errors = validateCLIArgs(args);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Invalid profile");
  });

  it("accepts all valid profiles", () => {
    const validProfiles = [
      "smoke", "quick", "load", "rampup", "capacity", "stress", "spike", "breakpoint", "soak",
    ];
    for (const p of validProfiles) {
      const args = parseCLIArgs(["--scenario", "test", "--profile", p]);
      const errors = validateCLIArgs(args);
      expect(errors.filter((e) => e.includes("profile"))).toHaveLength(0);
    }
  });

  it("returns error when scenario is missing", () => {
    const args = parseCLIArgs(["--profile", "load"]);
    const errors = validateCLIArgs(args);
    expect(errors.some((e) => e.includes("--scenario"))).toBe(true);
  });

  it("does not require scenario when --help is set", () => {
    const args = parseCLIArgs(["--help"]);
    const errors = validateCLIArgs(args);
    expect(errors.filter((e) => e.includes("--scenario"))).toHaveLength(0);
  });

  it("does not require scenario when --version is set", () => {
    const args = parseCLIArgs(["--version"]);
    const errors = validateCLIArgs(args);
    expect(errors.filter((e) => e.includes("--scenario"))).toHaveLength(0);
  });

  it("does not require scenario when --list-profiles is set", () => {
    const args = parseCLIArgs(["--list-profiles"]);
    const errors = validateCLIArgs(args);
    expect(errors.filter((e) => e.includes("--scenario"))).toHaveLength(0);
  });

  it("does not require scenario when --list-extensions is set", () => {
    const args = parseCLIArgs(["--list-extensions"]);
    const errors = validateCLIArgs(args);
    expect(errors.filter((e) => e.includes("--scenario"))).toHaveLength(0);
  });
});
