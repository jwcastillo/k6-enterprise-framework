/**
 * Unit tests for the T-261 GPT-inspired test gating module.
 *
 * Covers: isGateAllowed truth table, undefined-gate always-allowed,
 * per-flag isolation (each gate honored only by its own flag), GATE_KINDS contents.
 */

import { describe, it, expect } from "vitest";
import { isGateAllowed, GATE_KINDS, GateKind } from "../../src/core/gating";

describe("isGateAllowed", () => {
  // ── undefined gate (unmarked scenario) ────────────────────────────────────

  it("returns true for undefined gate with empty allowed flags", () => {
    expect(isGateAllowed(undefined, {})).toBe(true);
  });

  it("returns true for undefined gate even when all flags are false", () => {
    expect(isGateAllowed(undefined, { quarantined: false, experimental: false, unsafe: false })).toBe(
      true,
    );
  });

  it("returns true for undefined gate even when all flags are true", () => {
    expect(isGateAllowed(undefined, { quarantined: true, experimental: true, unsafe: true })).toBe(
      true,
    );
  });

  // ── quarantined gate ───────────────────────────────────────────────────────

  it("blocks quarantined gate when no flags provided", () => {
    expect(isGateAllowed("quarantined", {})).toBe(false);
  });

  it("allows quarantined gate only when quarantined flag is true", () => {
    expect(isGateAllowed("quarantined", { quarantined: true })).toBe(true);
  });

  it("blocks quarantined gate when only experimental flag is true (per-flag isolation)", () => {
    expect(isGateAllowed("quarantined", { experimental: true })).toBe(false);
  });

  it("blocks quarantined gate when only unsafe flag is true (per-flag isolation)", () => {
    expect(isGateAllowed("quarantined", { unsafe: true })).toBe(false);
  });

  // ── experimental gate ─────────────────────────────────────────────────────

  it("blocks experimental gate when no flags provided", () => {
    expect(isGateAllowed("experimental", {})).toBe(false);
  });

  it("allows experimental gate only when experimental flag is true", () => {
    expect(isGateAllowed("experimental", { experimental: true })).toBe(true);
  });

  it("blocks experimental gate when only quarantined flag is true (per-flag isolation)", () => {
    expect(isGateAllowed("experimental", { quarantined: true })).toBe(false);
  });

  it("blocks experimental gate when only unsafe flag is true (per-flag isolation)", () => {
    expect(isGateAllowed("experimental", { unsafe: true })).toBe(false);
  });

  // ── unsafe gate ───────────────────────────────────────────────────────────

  it("blocks unsafe gate when no flags provided", () => {
    expect(isGateAllowed("unsafe", {})).toBe(false);
  });

  it("allows unsafe gate only when unsafe flag is true", () => {
    expect(isGateAllowed("unsafe", { unsafe: true })).toBe(true);
  });

  it("blocks unsafe gate when only quarantined flag is true (per-flag isolation)", () => {
    expect(isGateAllowed("unsafe", { quarantined: true })).toBe(false);
  });

  it("blocks unsafe gate when only experimental flag is true (per-flag isolation)", () => {
    expect(isGateAllowed("unsafe", { experimental: true })).toBe(false);
  });

  // ── explicit false flags ───────────────────────────────────────────────────

  it("blocks when matching flag is explicitly false", () => {
    expect(isGateAllowed("experimental", { experimental: false })).toBe(false);
    expect(isGateAllowed("quarantined", { quarantined: false })).toBe(false);
    expect(isGateAllowed("unsafe", { unsafe: false })).toBe(false);
  });

  // ── full truth table (gate × flags) ───────────────────────────────────────

  it("truth table: each gate is unlocked only by its own flag", () => {
    const gates: GateKind[] = ["quarantined", "experimental", "unsafe"];
    const flags = [
      { quarantined: true },
      { experimental: true },
      { unsafe: true },
    ] as const;

    // Diagonal should be true; off-diagonal false
    expect(isGateAllowed("quarantined", flags[0])).toBe(true);
    expect(isGateAllowed("quarantined", flags[1])).toBe(false);
    expect(isGateAllowed("quarantined", flags[2])).toBe(false);

    expect(isGateAllowed("experimental", flags[0])).toBe(false);
    expect(isGateAllowed("experimental", flags[1])).toBe(true);
    expect(isGateAllowed("experimental", flags[2])).toBe(false);

    expect(isGateAllowed("unsafe", flags[0])).toBe(false);
    expect(isGateAllowed("unsafe", flags[1])).toBe(false);
    expect(isGateAllowed("unsafe", flags[2])).toBe(true);

    // Sanity: all gates use their own type
    expect(gates).toHaveLength(3);
  });
});

describe("GATE_KINDS", () => {
  it("contains exactly the three recognized gate values", () => {
    expect(GATE_KINDS).toEqual(["quarantined", "experimental", "unsafe"]);
  });

  it("has length 3", () => {
    expect(GATE_KINDS).toHaveLength(3);
  });

  it("contains quarantined", () => {
    expect(GATE_KINDS).toContain("quarantined");
  });

  it("contains experimental", () => {
    expect(GATE_KINDS).toContain("experimental");
  });

  it("contains unsafe", () => {
    expect(GATE_KINDS).toContain("unsafe");
  });
});
