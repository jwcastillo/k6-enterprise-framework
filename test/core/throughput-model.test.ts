import { describe, it, expect } from "vitest";
import {
  targetRpsForUsers,
  recommendMaxVUs,
  buildThroughputPlan,
} from "../../src/core/throughput-model";
import type { EndpointClass } from "../../src/core/throughput-model";

describe("throughput-model", () => {
  // ── targetRpsForUsers ─────────────────────────────────────────────────────

  describe("targetRpsForUsers", () => {
    it("returns 0 for 0 users on all endpoint classes", () => {
      const classes: EndpointClass[] = ["api", "web", "git-pull", "git-push"];
      for (const cls of classes) {
        expect(targetRpsForUsers(0, cls)).toBe(0);
      }
    });

    it("returns 0 for negative users", () => {
      expect(targetRpsForUsers(-100, "api")).toBe(0);
    });

    it("returns 0 for NaN users", () => {
      expect(targetRpsForUsers(NaN, "api")).toBe(0);
    });

    it("api: 1000 users -> 20 RPS", () => {
      expect(targetRpsForUsers(1000, "api")).toBe(20);
    });

    it("web: 1000 users -> 2 RPS", () => {
      expect(targetRpsForUsers(1000, "web")).toBe(2);
    });

    it("git-pull: 1000 users -> 2 RPS", () => {
      expect(targetRpsForUsers(1000, "git-pull")).toBe(2);
    });

    it("api: linear scale up — 2000 users -> 40 RPS", () => {
      expect(targetRpsForUsers(2000, "api")).toBe(40);
    });

    it("api: linear scale down — 500 users -> 10 RPS", () => {
      expect(targetRpsForUsers(500, "api")).toBe(10);
    });

    it("web: fractional rounding — 1500 users -> 3 RPS", () => {
      // 1500 / 1000 * 2 = 3.0 (exact)
      expect(targetRpsForUsers(1500, "web")).toBe(3);
    });

    it("api: fractional rounding — 750 users -> 15 RPS", () => {
      // 750 / 1000 * 20 = 15 (exact)
      expect(targetRpsForUsers(750, "api")).toBe(15);
    });

    it("api: rounds half-up on fractional result", () => {
      // 125 / 1000 * 20 = 2.5 -> rounds to 3
      expect(targetRpsForUsers(125, "api")).toBe(3);
    });

    // git-push floor: raw formula gives < 1 for users > 0
    it("git-push: 1000 users -> raw 0.4, floor applies -> 1 RPS", () => {
      expect(targetRpsForUsers(1000, "git-push")).toBe(1);
    });

    it("git-push: 2000 users -> raw 0.8, floor applies -> 1 RPS", () => {
      expect(targetRpsForUsers(2000, "git-push")).toBe(1);
    });

    it("git-push: 2500 users -> raw 1.0, no floor needed -> 1 RPS", () => {
      // 2500 / 1000 * 0.4 = 1.0
      expect(targetRpsForUsers(2500, "git-push")).toBe(1);
    });

    it("git-push: 5000 users -> raw 2.0, no floor -> 2 RPS", () => {
      // 5000 / 1000 * 0.4 = 2.0
      expect(targetRpsForUsers(5000, "git-push")).toBe(2);
    });

    it("git-push: 0 users -> 0 (no floor on zero)", () => {
      expect(targetRpsForUsers(0, "git-push")).toBe(0);
    });
  });

  // ── recommendMaxVUs ───────────────────────────────────────────────────────

  describe("recommendMaxVUs", () => {
    it("returns 5x RPS for small values", () => {
      expect(recommendMaxVUs(10)).toBe(50);
    });

    it("caps at 2000 when 5x RPS exceeds limit", () => {
      // 5 * 500 = 2500 -> capped at 2000
      expect(recommendMaxVUs(500)).toBe(2000);
    });

    it("returns 2000 exactly at the cap boundary", () => {
      // 5 * 400 = 2000 -> exactly 2000
      expect(recommendMaxVUs(400)).toBe(2000);
    });

    it("returns 0 for 0 RPS", () => {
      expect(recommendMaxVUs(0)).toBe(0);
    });

    it("clamps negative RPS to 0", () => {
      expect(recommendMaxVUs(-50)).toBe(0);
    });

    it("returns 100 for 20 RPS (standard api/1000-users case)", () => {
      // 5 * 20 = 100
      expect(recommendMaxVUs(20)).toBe(100);
    });
  });

  // ── buildThroughputPlan ───────────────────────────────────────────────────

  describe("buildThroughputPlan", () => {
    it("returns an object with users and perClass with all four endpoint classes", () => {
      const plan = buildThroughputPlan(1000);
      expect(plan.users).toBe(1000);
      expect(plan.perClass).toBeDefined();
      expect(Object.keys(plan.perClass)).toEqual(
        expect.arrayContaining(["api", "web", "git-pull", "git-push"])
      );
    });

    it("perClass values are consistent with single-function results for 1000 users", () => {
      const plan = buildThroughputPlan(1000);
      expect(plan.perClass.api.targetRps).toBe(20);
      expect(plan.perClass.api.recommendedMaxVUs).toBe(100);
      expect(plan.perClass.web.targetRps).toBe(2);
      expect(plan.perClass.web.recommendedMaxVUs).toBe(10);
      expect(plan.perClass["git-pull"].targetRps).toBe(2);
      expect(plan.perClass["git-pull"].recommendedMaxVUs).toBe(10);
      // git-push: floor 1 -> 5*1 = 5 VUs
      expect(plan.perClass["git-push"].targetRps).toBe(1);
      expect(plan.perClass["git-push"].recommendedMaxVUs).toBe(5);
    });

    it("returns all zeros for 0 users", () => {
      const plan = buildThroughputPlan(0);
      expect(plan.users).toBe(0);
      for (const cls of Object.keys(plan.perClass) as EndpointClass[]) {
        expect(plan.perClass[cls].targetRps).toBe(0);
        expect(plan.perClass[cls].recommendedMaxVUs).toBe(0);
      }
    });

    it("VU cap applies inside buildThroughputPlan (api, 100000 users)", () => {
      // 100000 / 1000 * 20 = 2000 RPS -> 5 * 2000 = 10000 -> capped at 2000
      const plan = buildThroughputPlan(100000);
      expect(plan.perClass.api.targetRps).toBe(2000);
      expect(plan.perClass.api.recommendedMaxVUs).toBe(2000);
    });
  });
});
