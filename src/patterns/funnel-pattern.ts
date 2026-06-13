/**
 * Funnel Pattern — sequential step execution with drop-off tracking.
 *
 * Wraps each step in a k6 group() for automatic group_duration metrics.
 * Custom Counter metrics track entries/completions per step for dashboard visualization.
 *
 * Usage:
 *   import { runFunnel } from "../../../../src/patterns/funnel-pattern";
 *
 *   runFunnel<MyCtx>({
 *     name: "ecommerce",
 *     initialContext: () => ({ orderId: null }),
 *     steps: [
 *       { name: "health_check", fn: (ctx) => svc.health().status === 200, thinkTime: 1 },
 *       { name: "create_order", fn: (ctx) => { ... return ok; }, thinkTime: 2 },
 *     ],
 *   });
 */

import { group, sleep } from "k6";
import { Counter } from "k6/metrics";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FunnelStep<TContext extends Record<string, unknown>> {
  /** Stable identifier used in group() label and metric names. Use snake_case. */
  name: string;
  /**
   * Callback that runs inside k6 group(). Receives the shared context object.
   * Return false (or throw) to signal failure → triggers drop-off.
   * Mutations to ctx carry forward to subsequent steps.
   */
  fn: (ctx: TContext) => boolean | void;
  /** Think time in seconds after this step completes (default: 0). */
  thinkTime?: number;
}

export interface FunnelConfig<TContext extends Record<string, unknown>> {
  /** Funnel name used as metric key prefix. Example: "ecommerce". Use snake_case. */
  name: string;
  /** Ordered list of funnel steps. */
  steps: FunnelStep<TContext>[];
  /** Factory called once per VU iteration to produce a fresh context. */
  initialContext: () => TContext;
  /** If true, continue executing steps even after a failure (default: false). */
  continueOnFailure?: boolean;
}

export interface FunnelResult {
  /** True if every step completed successfully. */
  completed: boolean;
  stepsEntered: number;
  stepsCompleted: number;
  /** Name of the step where first drop-off occurred, null if all passed. */
  dropOffStep: string | null;
}

// ── Counter registry ──────────────────────────────────────────────────────────
// k6 requires all custom metrics (Counter, Trend, Gauge, Rate) to be
// instantiated in the **init context** (module level), NOT inside default().
// Callers must invoke initFunnelMetrics() at module level before default().

const _counterCache: Record<string, Counter> = {};

function getCounter(metricName: string): Counter {
  if (!_counterCache[metricName]) {
    throw new Error(
      `Counter "${metricName}" not pre-registered. Call initFunnelMetrics() in init context.`
    );
  }
  return _counterCache[metricName];
}

/**
 * Pre-register all Counter metrics for a funnel configuration.
 * **Must be called at module level (init context), NOT inside default().**
 *
 * @example
 *   // At module level:
 *   const funnelConfig = { name: "ecommerce", steps: [...] };
 *   initFunnelMetrics(funnelConfig);
 *
 *   export default function() { runFunnel(funnelConfig); }
 */
export function initFunnelMetrics<TContext extends Record<string, unknown>>(
  config: FunnelConfig<TContext>
): void {
  for (const step of config.steps) {
    const enteredKey = `funnel_${config.name}__${step.name}_entered`;
    const completedKey = `funnel_${config.name}__${step.name}_completed`;
    if (!_counterCache[enteredKey]) {
      _counterCache[enteredKey] = new Counter(enteredKey);
    }
    if (!_counterCache[completedKey]) {
      _counterCache[completedKey] = new Counter(completedKey);
    }
  }
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Execute a multi-step funnel. Each step runs inside k6 group() producing
 * group_duration metrics. Entry/completion counters are emitted for the
 * dashboard funnel visualization.
 */
export function runFunnel<TContext extends Record<string, unknown>>(
  config: FunnelConfig<TContext>
): FunnelResult {
  const ctx = config.initialContext();
  let stepsEntered = 0;
  let stepsCompleted = 0;
  let dropOffStep: string | null = null;
  let active = true;

  for (const step of config.steps) {
    if (!active) break;

    const enteredKey = `funnel_${config.name}__${step.name}_entered`;
    const completedKey = `funnel_${config.name}__${step.name}_completed`;

    getCounter(enteredKey).add(1);
    stepsEntered++;

    let stepPassed = false;

    group(step.name, () => {
      try {
        const result = step.fn(ctx);
        // undefined/void counts as success; explicit false = failure
        stepPassed = result !== false;
      } catch (_err) {
        stepPassed = false;
      }
    });

    if (stepPassed) {
      getCounter(completedKey).add(1);
      stepsCompleted++;
    } else {
      if (dropOffStep === null) dropOffStep = step.name;
      if (!config.continueOnFailure) {
        active = false;
      }
    }

    if (step.thinkTime && step.thinkTime > 0) {
      sleep(step.thinkTime);
    }
  }

  return {
    completed: stepsCompleted === config.steps.length,
    stepsEntered,
    stepsCompleted,
    dropOffStep,
  };
}
