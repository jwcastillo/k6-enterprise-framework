/**
 * Unit tests for BudgetManager.
 * src/ai/core/budget-manager.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BudgetManager } from "../../src/ai/core/budget-manager";
import type { TokenUsage } from "../../src/types/ai.d";

describe("BudgetManager", () => {
  beforeEach(() => {
    // Reset static pipeline counters between tests
    BudgetManager.resetPipelineCounters();
  });

  // ---------------------------------------------------------------------------
  // Construction and defaults
  // ---------------------------------------------------------------------------
  describe("constructor", () => {
    it("should create with default planner config when agentId is unknown", () => {
      const bm = new BudgetManager();
      const status = bm.getStatus();
      expect(status.agentId).toBe("unknown");
      // Should use planner defaults
      expect(status.sessionTokensBudget).toBe(50000);
    });

    it("should use builder defaults for builder agent", () => {
      const bm = new BudgetManager({ agentId: "builder" });
      const status = bm.getStatus();
      expect(status.agentId).toBe("builder");
      expect(status.sessionTokensBudget).toBe(100000);
      expect(status.sessionCostBudget).toBe(1.5);
    });

    it("should use analyst defaults for analyst agent", () => {
      const bm = new BudgetManager({ agentId: "analyst" });
      const status = bm.getStatus();
      expect(status.sessionTokensBudget).toBe(50000);
      expect(status.sessionCostBudget).toBe(0.5);
    });

    it("should use reporter defaults for reporter agent", () => {
      const bm = new BudgetManager({ agentId: "reporter" });
      const status = bm.getStatus();
      expect(status.sessionTokensBudget).toBe(40000);
      expect(status.sessionCostBudget).toBe(0.4);
    });

    it("should allow overriding agent config", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxTotalTokensSession: 10000 },
      });
      const status = bm.getStatus();
      expect(status.sessionTokensBudget).toBe(10000);
    });

    it("should allow overriding pipeline config", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { maxCostUsdPipeline: 1.0 },
      });
      // Pipeline config is used internally; just verify no errors
      expect(bm.getStatus().withinBudget).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // checkBudget
  // ---------------------------------------------------------------------------
  describe("checkBudget", () => {
    it("should pass when no usage recorded", () => {
      const bm = new BudgetManager({ agentId: "planner" });
      expect(() => bm.checkBudget()).not.toThrow();
    });

    it("should throw when session cost exceeds budget", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxCostUsdSession: 0.01 },
      });
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.02,
      };
      bm.recordUsage("planner", usage);

      expect(() => bm.checkBudget()).toThrow("EC-AI-002");
      expect(() => bm.checkBudget()).toThrow("Presupuesto USD");
    });

    it("should throw when session tokens exceed budget", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxTotalTokensSession: 100 },
      });
      const usage: TokenUsage = {
        inputTokens: 80,
        outputTokens: 30,
        totalTokens: 110,
        estimatedCostUsd: 0.001,
      };
      bm.recordUsage("planner", usage);

      expect(() => bm.checkBudget()).toThrow("EC-AI-002");
      expect(() => bm.checkBudget()).toThrow("tokens");
    });

    it("should throw when pipeline cost exceeds budget", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { maxCostUsdPipeline: 0.01 },
      });
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.02,
      };
      bm.recordUsage("planner", usage);

      expect(() => bm.checkBudget()).toThrow("EC-AI-002");
      expect(() => bm.checkBudget()).toThrow("pipeline");
    });

    it("should throw when local circuit breaker is open", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { circuitBreakerThreshold: 2 },
      });
      bm.recordFailure("planner");
      bm.recordFailure("planner");

      expect(() => bm.checkBudget()).toThrow("EC-AI-002");
      expect(() => bm.checkBudget()).toThrow("Circuit breaker");
    });

    it("should throw when global circuit breaker is open", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { circuitBreakerThreshold: 2 },
      });
      // Global threshold = circuitBreakerThreshold * 2 = 4
      bm.recordFailure("planner");
      bm.recordFailure("planner");
      bm.recordFailure("planner");
      bm.recordFailure("planner");

      // Create a new BudgetManager to test global check
      const bm2 = new BudgetManager({ agentId: "analyst" });
      expect(() => bm2.checkBudget()).toThrow("Circuit breaker abierto");
    });

    it("should accept custom agentId parameter for check", () => {
      const bm = new BudgetManager({ agentId: "planner" });
      expect(() => bm.checkBudget("custom-agent")).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // recordUsage
  // ---------------------------------------------------------------------------
  describe("recordUsage", () => {
    it("should accumulate session tokens and cost", () => {
      const bm = new BudgetManager({ agentId: "builder" });
      const usage1: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        estimatedCostUsd: 0.01,
      };
      const usage2: TokenUsage = {
        inputTokens: 2000,
        outputTokens: 800,
        totalTokens: 2800,
        estimatedCostUsd: 0.02,
      };

      bm.recordUsage("builder", usage1);
      bm.recordUsage("builder", usage2);

      expect(bm.getSessionTokensUsed()).toBe(4300);
      expect(bm.getSessionCostUsd()).toBeCloseTo(0.03, 5);
    });

    it("should track usage history", () => {
      const bm = new BudgetManager({ agentId: "analyst" });
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.001,
      };
      bm.recordUsage("analyst", usage);

      const history = bm.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].agentId).toBe("analyst");
      expect(history[0].tokensUsed).toEqual(usage);
      expect(history[0].invocationId).toContain("analyst-");
    });

    it("should update pipeline-level counters", () => {
      const bm = new BudgetManager({ agentId: "planner" });
      const usage: TokenUsage = {
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        estimatedCostUsd: 0.005,
      };
      bm.recordUsage("planner", usage);

      const pipelineStatus = BudgetManager.getPipelineStatus();
      expect(pipelineStatus.pipelineTokensUsed).toBe(700);
      expect(pipelineStatus.pipelineCostUsd).toBeCloseTo(0.005, 5);
    });

    it("should reset circuit breaker on successful usage", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { circuitBreakerThreshold: 5 },
      });
      bm.recordFailure("planner");
      bm.recordFailure("planner");

      let status = bm.getStatus();
      expect(status.consecutiveFailures).toBe(2);

      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.001,
      };
      bm.recordUsage("planner", usage);

      status = bm.getStatus();
      expect(status.consecutiveFailures).toBe(0);
      expect(status.circuitOpen).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // recordFailure and circuit breaker
  // ---------------------------------------------------------------------------
  describe("recordFailure", () => {
    it("should increment consecutive failures", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { circuitBreakerThreshold: 5 },
      });
      bm.recordFailure("planner");
      expect(bm.getStatus().consecutiveFailures).toBe(1);
      expect(bm.getStatus().circuitOpen).toBe(false);
    });

    it("should open local circuit breaker after threshold failures", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { circuitBreakerThreshold: 3 },
      });
      bm.recordFailure("planner");
      bm.recordFailure("planner");
      bm.recordFailure("planner");

      expect(bm.getStatus().circuitOpen).toBe(true);
    });

    it("should open global circuit breaker after threshold*2 failures", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { circuitBreakerThreshold: 2 },
      });
      // Global threshold = 2 * 2 = 4
      for (let i = 0; i < 4; i++) {
        bm.recordFailure("planner");
      }

      const pipelineStatus = BudgetManager.getPipelineStatus();
      expect(pipelineStatus.circuitOpen).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // resetCircuitBreaker
  // ---------------------------------------------------------------------------
  describe("resetCircuitBreaker", () => {
    it("should reset both local and global circuit breakers", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { circuitBreakerThreshold: 2 },
      });
      for (let i = 0; i < 4; i++) {
        bm.recordFailure("planner");
      }

      expect(bm.getStatus().circuitOpen).toBe(true);
      expect(BudgetManager.getPipelineStatus().circuitOpen).toBe(true);

      bm.resetCircuitBreaker();

      expect(bm.getStatus().circuitOpen).toBe(false);
      expect(bm.getStatus().consecutiveFailures).toBe(0);
      expect(BudgetManager.getPipelineStatus().circuitOpen).toBe(false);
      expect(BudgetManager.getPipelineStatus().consecutiveFailures).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getStatus
  // ---------------------------------------------------------------------------
  describe("getStatus", () => {
    it("should return correct utilization percentage", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxTotalTokensSession: 1000 },
      });
      const usage: TokenUsage = {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        estimatedCostUsd: 0.001,
      };
      bm.recordUsage("planner", usage);

      const status = bm.getStatus();
      expect(status.utilizationPct).toBe(30);
    });

    it("should report withinBudget correctly", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxTotalTokensSession: 1000, maxCostUsdSession: 1.0 },
      });
      expect(bm.getStatus().withinBudget).toBe(true);

      const usage: TokenUsage = {
        inputTokens: 800,
        outputTokens: 300,
        totalTokens: 1100,
        estimatedCostUsd: 0.001,
      };
      bm.recordUsage("planner", usage);
      expect(bm.getStatus().withinBudget).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getRemainingTokenBudget
  // ---------------------------------------------------------------------------
  describe("getRemainingTokenBudget", () => {
    it("should return full budget when no usage", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxTotalTokensSession: 50000 },
      });
      expect(bm.getRemainingTokenBudget()).toBe(50000);
    });

    it("should return reduced budget after usage", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxTotalTokensSession: 50000 },
      });
      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        estimatedCostUsd: 0.01,
      };
      bm.recordUsage("planner", usage);
      expect(bm.getRemainingTokenBudget()).toBe(35000);
    });

    it("should return 0 when budget is exhausted", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        agentConfig: { maxTotalTokensSession: 100 },
      });
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.001,
      };
      bm.recordUsage("planner", usage);
      expect(bm.getRemainingTokenBudget()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Static pipeline methods
  // ---------------------------------------------------------------------------
  describe("static pipeline methods", () => {
    it("should track pipeline tokens across multiple BudgetManager instances", () => {
      const bm1 = new BudgetManager({ agentId: "planner" });
      const bm2 = new BudgetManager({ agentId: "builder" });

      const usage1: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.001,
      };
      const usage2: TokenUsage = {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        estimatedCostUsd: 0.002,
      };

      bm1.recordUsage("planner", usage1);
      bm2.recordUsage("builder", usage2);

      const pipelineStatus = BudgetManager.getPipelineStatus();
      expect(pipelineStatus.pipelineTokensUsed).toBe(450);
      expect(pipelineStatus.pipelineCostUsd).toBeCloseTo(0.003, 5);
    });

    it("should reset all pipeline counters", () => {
      const bm = new BudgetManager({ agentId: "planner" });
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.001,
      };
      bm.recordUsage("planner", usage);

      BudgetManager.resetPipelineCounters();

      const pipelineStatus = BudgetManager.getPipelineStatus();
      expect(pipelineStatus.pipelineTokensUsed).toBe(0);
      expect(pipelineStatus.pipelineCostUsd).toBe(0);
      expect(pipelineStatus.circuitOpen).toBe(false);
      expect(pipelineStatus.consecutiveFailures).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  describe("rate limiting", () => {
    it("should throw when rate limit requests per minute exceeded", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { maxRequestsPerMinute: 2 },
      });

      const usage: TokenUsage = {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.0001,
      };

      bm.recordUsage("planner", usage);
      bm.recordUsage("planner", usage);

      expect(() => bm.checkBudget()).toThrow("Rate limit");
    });

    it("should throw when tokens per minute exceeded", () => {
      const bm = new BudgetManager({
        agentId: "planner",
        pipelineConfig: { maxTokensPerMinute: 100 },
      });

      const usage: TokenUsage = {
        inputTokens: 80,
        outputTokens: 30,
        totalTokens: 110,
        estimatedCostUsd: 0.001,
      };

      bm.recordUsage("planner", usage);

      expect(() => bm.checkBudget()).toThrow("Rate limit de tokens");
    });
  });
});
