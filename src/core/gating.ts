/**
 * T-261: GPT-inspired test gating — orthogonal safety axis for scenario execution.
 *
 * Inspired by GitLab Performance Tool (GPT) gating conventions. Scenarios
 * self-mark with a top-level `export const gate = "<kind>"` constant. The
 * runner reads this marker from the source file and refuses to run the scenario
 * unless the matching CLI flag is supplied.
 *
 * Convention:
 *   export const gate = "quarantined"; // blocks run unless --quarantined
 *   export const gate = "experimental"; // blocks run unless --experimental
 *   export const gate = "unsafe";        // blocks run unless --unsafe
 *
 * Gate marker MUST use double quotes (`export const gate = "experimental"`, not
 * single quotes) so the runner's double-quote-only grep and Prettier's enforced
 * double-quote style stay consistent.
 *
 * Gating is NOT a 6th bucket — it is orthogonal to the 5 canonical scenario
 * buckets (api / flow / domain / chaos / perf). A gated scenario still lives
 * inside one of those buckets; the gate controls whether the runner will execute
 * it without an explicit opt-in flag.
 *
 * Exit code: 108 (runner exits with this code when a gated scenario is blocked).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** The three recognized gate kinds. String union (no enum) per project conventions. */
export type GateKind = "quarantined" | "experimental" | "unsafe";

// ── Constants ─────────────────────────────────────────────────────────────────

/** All recognized gate values, in definition order. */
export const GATE_KINDS: GateKind[] = ["quarantined", "experimental", "unsafe"];

// ── Predicate ─────────────────────────────────────────────────────────────────

/**
 * Returns `true` when the scenario is allowed to run.
 *
 * - An **undefined gate** (unmarked scenario) ALWAYS returns `true`; gating is
 *   opt-in and unmarked scenarios are never blocked.
 * - A **defined gate** returns `true` only when the matching flag is `true`.
 *   Each gate is honored exclusively by its own flag — passing `experimental:true`
 *   does NOT unlock a `quarantined` scenario.
 *
 * @example
 *   isGateAllowed(undefined, {})              // → true  (unmarked)
 *   isGateAllowed("experimental", { experimental: true })  // → true
 *   isGateAllowed("quarantined",  { experimental: true })  // → false
 *   isGateAllowed("unsafe",       {})          // → false
 */
export function isGateAllowed(
  gate: GateKind | undefined,
  allowed: { quarantined?: boolean; experimental?: boolean; unsafe?: boolean },
): boolean {
  if (gate === undefined) return true;
  return allowed[gate] === true;
}
