import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock k6/sleep before importing the module
vi.mock("k6", () => ({
  sleep: vi.fn(),
}));

import { sleep } from "k6";
import {
  randomNormal,
  thinkTime,
  thinkTimeNormal,
  pace,
  THINK_TIME,
  ThinkTimeHelper,
} from "../../src/helpers/think-time-helper";

const mockedSleep = vi.mocked(sleep);

beforeEach(() => {
  mockedSleep.mockClear();
});

// ── THINK_TIME presets ─────────────────────────────────────────────────────
describe("THINK_TIME presets", () => {
  it("has valid ranges where min < max", () => {
    for (const [key, [min, max]] of Object.entries(THINK_TIME)) {
      expect(min, `${key} min`).toBeLessThan(max);
      expect(min, `${key} min`).toBeGreaterThan(0);
    }
  });

  it("contains expected preset keys", () => {
    expect(THINK_TIME).toHaveProperty("FAST");
    expect(THINK_TIME).toHaveProperty("NORMAL");
    expect(THINK_TIME).toHaveProperty("SLOW");
    expect(THINK_TIME).toHaveProperty("READING");
  });
});

// ── randomNormal ───────────────────────────────────────────────────────────
describe("randomNormal", () => {
  it("returns values centered around the mean", () => {
    const samples = Array.from({ length: 5000 }, () => randomNormal(10, 2));
    const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
    expect(avg).toBeGreaterThan(9);
    expect(avg).toBeLessThan(11);
  });

  it("stddev affects spread", () => {
    const tight = Array.from({ length: 2000 }, () => randomNormal(10, 0.1));
    const wide = Array.from({ length: 2000 }, () => randomNormal(10, 5));

    const tightStddev = Math.sqrt(
      tight.reduce((sum, v) => sum + (v - 10) ** 2, 0) / tight.length,
    );
    const wideStddev = Math.sqrt(
      wide.reduce((sum, v) => sum + (v - 10) ** 2, 0) / wide.length,
    );

    expect(tightStddev).toBeLessThan(wideStddev);
  });

  it("returns exact mean when stddev is 0", () => {
    const samples = Array.from({ length: 100 }, () => randomNormal(5, 0));
    for (const s of samples) {
      expect(s).toBe(5);
    }
  });
});

// ── thinkTime ──────────────────────────────────────────────────────────────
describe("thinkTime", () => {
  it("calls sleep with a value within [min, max]", () => {
    for (let i = 0; i < 50; i++) {
      thinkTime(1, 3);
    }
    expect(mockedSleep).toHaveBeenCalledTimes(50);
    for (const call of mockedSleep.mock.calls) {
      const duration = call[0] as number;
      expect(duration).toBeGreaterThanOrEqual(1);
      expect(duration).toBeLessThanOrEqual(3);
    }
  });

  it("returns exact value when min equals max", () => {
    thinkTime(2, 2);
    expect(mockedSleep).toHaveBeenCalledWith(2);
  });
});

// ── thinkTimeNormal ────────────────────────────────────────────────────────
describe("thinkTimeNormal", () => {
  it("calls sleep with clamped normally-distributed values", () => {
    const mean = 2;
    const stddev = 0.5;
    for (let i = 0; i < 100; i++) {
      thinkTimeNormal(mean, stddev);
    }
    expect(mockedSleep).toHaveBeenCalledTimes(100);

    for (const call of mockedSleep.mock.calls) {
      const duration = call[0] as number;
      // Clamped to [mean*0.1, mean*3]
      expect(duration).toBeGreaterThanOrEqual(mean * 0.1);
      expect(duration).toBeLessThanOrEqual(mean * 3);
    }
  });

  it("values are centered around the mean", () => {
    for (let i = 0; i < 1000; i++) {
      thinkTimeNormal(5, 1);
    }
    const values = mockedSleep.mock.calls.map((c) => c[0] as number);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(avg).toBeGreaterThan(4);
    expect(avg).toBeLessThan(6);
  });
});

// ── pace ───────────────────────────────────────────────────────────────────
describe("pace", () => {
  let realDateNow: () => number;

  beforeEach(() => {
    realDateNow = Date.now;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  it("sleeps for remaining time when iteration is faster than target", () => {
    const start = 1000;
    Date.now = () => 1800; // 800ms elapsed

    const remaining = pace(2000, start);

    expect(remaining).toBe(1200);
    expect(mockedSleep).toHaveBeenCalledWith(1.2); // 1200ms → 1.2s
  });

  it("returns 0 and does not sleep when iteration exceeds target", () => {
    const start = 1000;
    Date.now = () => 4000; // 3000ms elapsed, target was 2000ms

    const remaining = pace(2000, start);

    expect(remaining).toBe(0);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  it("returns 0 when elapsed exactly equals target", () => {
    const start = 1000;
    Date.now = () => 3000; // exactly 2000ms elapsed

    const remaining = pace(2000, start);

    expect(remaining).toBe(0);
    expect(mockedSleep).not.toHaveBeenCalled();
  });
});

// ── ThinkTimeHelper static facade ──────────────────────────────────────────
describe("ThinkTimeHelper", () => {
  it("exposes all functions as static members", () => {
    expect(ThinkTimeHelper.randomNormal).toBe(randomNormal);
    expect(ThinkTimeHelper.thinkTime).toBe(thinkTime);
    expect(ThinkTimeHelper.thinkTimeNormal).toBe(thinkTimeNormal);
    expect(ThinkTimeHelper.pace).toBe(pace);
    expect(ThinkTimeHelper.THINK_TIME).toBe(THINK_TIME);
  });
});
