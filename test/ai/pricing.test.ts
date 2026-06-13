/**
 * Phase 5 / AI-02 (D-06..D-09): pricing loader behavior.
 *
 * Tests loadPricing() env-override on default model only, value validation,
 * and lookupRate() fallback to default for unknown models.
 *
 * Env vars are injected via opts.env — process.env is never mutated.
 */

import { describe, it, expect } from "vitest";
import { loadPricing, lookupRate } from "../../src/ai/core/pricing";

describe("pricing — loadPricing (AI-02 D-06..D-09)", () => {
  it("loads default JSON contents (default model + sonnet rate)", () => {
    const table = loadPricing({ env: {} });
    expect(table.default).toBe("claude-sonnet-4-6");
    expect(table.models["claude-sonnet-4-6"].input_usd_per_1k).toBe(0.003);
    expect(table.models["claude-sonnet-4-6"].output_usd_per_1k).toBe(0.015);
    expect(table.models["claude-opus-4-7"].input_usd_per_1k).toBe(0.015);
    expect(table.models["claude-opus-4-7"].output_usd_per_1k).toBe(0.075);
  });

  it("LLM_INPUT_USD_PER_1K override targets DEFAULT model only (D-07)", () => {
    const table = loadPricing({ env: { LLM_INPUT_USD_PER_1K: "0.002" } });
    expect(table.models["claude-sonnet-4-6"].input_usd_per_1k).toBe(0.002);
    expect(table.models["claude-sonnet-4-6"].output_usd_per_1k).toBe(0.015);
    // Opus is NOT touched
    expect(table.models["claude-opus-4-7"].input_usd_per_1k).toBe(0.015);
    expect(table.models["claude-opus-4-7"].output_usd_per_1k).toBe(0.075);
  });

  it("LLM_OUTPUT_USD_PER_1K override targets DEFAULT model only (D-07)", () => {
    const table = loadPricing({ env: { LLM_OUTPUT_USD_PER_1K: "0.030" } });
    expect(table.models["claude-sonnet-4-6"].output_usd_per_1k).toBe(0.03);
    expect(table.models["claude-sonnet-4-6"].input_usd_per_1k).toBe(0.003);
    expect(table.models["claude-opus-4-7"].output_usd_per_1k).toBe(0.075);
  });

  it("empty-string env value is treated as unset (no override)", () => {
    const table = loadPricing({ env: { LLM_INPUT_USD_PER_1K: "" } });
    expect(table.models["claude-sonnet-4-6"].input_usd_per_1k).toBe(0.003);
  });

  it("non-numeric env value throws with the documented message", () => {
    expect(() => loadPricing({ env: { LLM_INPUT_USD_PER_1K: "not-a-number" } })).toThrow(
      /LLM_INPUT_USD_PER_1K must be a positive number/
    );
  });

  it("negative env value throws (rejected by isFinite/positive check)", () => {
    expect(() => loadPricing({ env: { LLM_INPUT_USD_PER_1K: "-0.5" } })).toThrow(
      /LLM_INPUT_USD_PER_1K must be a positive number/
    );
  });

  it("zero env value throws (not positive)", () => {
    expect(() => loadPricing({ env: { LLM_OUTPUT_USD_PER_1K: "0" } })).toThrow(
      /LLM_OUTPUT_USD_PER_1K must be a positive number/
    );
  });

  it("returns a fresh table — mutating the result does NOT affect later calls", () => {
    const t1 = loadPricing({ env: {} });
    t1.models["claude-sonnet-4-6"].input_usd_per_1k = 999;
    const t2 = loadPricing({ env: {} });
    expect(t2.models["claude-sonnet-4-6"].input_usd_per_1k).toBe(0.003);
  });
});

describe("pricing — lookupRate (AI-02 D-08)", () => {
  const table = loadPricing({ env: {} });

  it("returns sonnet rate when sonnet is requested", () => {
    const r = lookupRate(table, "claude-sonnet-4-6");
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.rate.input_usd_per_1k).toBe(0.003);
    expect(r.rate.output_usd_per_1k).toBe(0.015);
  });

  it("returns opus rate when opus is requested", () => {
    const r = lookupRate(table, "claude-opus-4-7");
    expect(r.model).toBe("claude-opus-4-7");
    expect(r.rate.input_usd_per_1k).toBe(0.015);
    expect(r.rate.output_usd_per_1k).toBe(0.075);
  });

  it("falls back to default model when model is unknown (D-08, no throw)", () => {
    const r = lookupRate(table, "unknown-model-xyz");
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.rate.input_usd_per_1k).toBe(0.003);
  });

  it("falls back to default when model is undefined", () => {
    const r = lookupRate(table, undefined);
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.rate.input_usd_per_1k).toBe(0.003);
  });
});
