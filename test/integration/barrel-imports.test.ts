import { describe, it, expect, vi } from "vitest";

// Override k6/metrics mock with proper function constructors (arrow fns can't be used with new)
vi.mock("k6/metrics", () => ({
  Counter: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
  Trend: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
  Rate: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
  Gauge: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
}));

// Mock chromadb — optional peer dependency not installed in all environments
vi.mock("chromadb", () => ({
  ChromaClient: vi.fn().mockImplementation(function () {
    return {};
  }),
  IncludeEnum: {},
}));

import * as srcBarrel from "../../src";

describe("ARC-04 barrel imports", () => {
  it("re-exports metrics (SaturationCalculator)", () => {
    expect(srcBarrel).toHaveProperty("SaturationCalculator");
  });

  it("re-exports observability (resolvePyroscopeConfig)", () => {
    // resolvePyroscopeConfig stays in src/observability/ even after the
    // pyroscope split in Plan 04-05 (see D-37 in 04-CONTEXT.md).
    expect(srcBarrel).toHaveProperty("resolvePyroscopeConfig");
  });

  it("re-exports integrations (NotificationService)", () => {
    expect(srcBarrel).toHaveProperty("NotificationService");
  });

  it("re-exports ai (PlannerAgent)", () => {
    expect(srcBarrel).toHaveProperty("PlannerAgent");
  });
});
