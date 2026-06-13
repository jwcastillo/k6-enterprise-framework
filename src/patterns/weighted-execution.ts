/** T-019: Ejecucion ponderada — distribucion de escenarios por peso */

export interface WeightedScenario<T = () => void> {
  name: string;
  weight: number; // relative weight, e.g. 60 means 60% when total=100
  fn: T;
}

/**
 * Select a scenario based on weighted random distribution.
 * Weights are relative (do not need to sum to 100).
 *
 * @example
 * const scenario = weightedSelect([
 *   { name: "browse", weight: 60, fn: browseFn },
 *   { name: "search", weight: 30, fn: searchFn },
 *   { name: "checkout", weight: 10, fn: checkoutFn },
 * ]);
 * scenario.fn();
 */
export function weightedSelect<T>(scenarios: WeightedScenario<T>[]): WeightedScenario<T> {
  if (scenarios.length === 0) {
    throw new Error("weightedSelect: scenarios array must not be empty");
  }

  const total = scenarios.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) {
    throw new Error("weightedSelect: total weight must be > 0");
  }

  let random = Math.random() * total;
  for (const scenario of scenarios) {
    random -= scenario.weight;
    if (random <= 0) {
      return scenario;
    }
  }

  // Fallback (handles floating point edge cases)
  return scenarios[scenarios.length - 1];
}

/**
 * Execute one scenario per VU iteration selected by weighted distribution.
 * Drop-in for use in k6 default function.
 */
export function weightedSwitch(scenarios: WeightedScenario<() => void>[]): void {
  const selected = weightedSelect(scenarios);
  selected.fn();
}

/**
 * Validate that weights are reasonable (all > 0, array non-empty).
 * Useful in setup() to catch misconfiguration before load starts.
 */
export function validateWeights(scenarios: WeightedScenario[]): void {
  if (scenarios.length === 0) {
    throw new Error("weightedExecution: no scenarios defined");
  }
  for (const s of scenarios) {
    if (s.weight <= 0) {
      throw new Error(`weightedExecution: scenario '${s.name}' has invalid weight ${s.weight} (must be > 0)`);
    }
  }
}
