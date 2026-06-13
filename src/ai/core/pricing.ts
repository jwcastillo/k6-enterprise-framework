/** Phase 5 / AI-02 (D-06..D-09): JSON-driven pricing with env override on the default model. */

 
const pricingJson: PricingTable = require("./pricing.json");

export interface ModelRate {
  input_usd_per_1k: number;
  output_usd_per_1k: number;
}

export interface PricingTable {
  default: string;
  models: Record<string, ModelRate>;
}

export interface LoadPricingOptions {
  env?: NodeJS.ProcessEnv;
  /** Optional override for tests pointing at a fixture JSON file. */
  jsonPath?: string;
}

/**
 * Load the pricing table.
 *
 * - Bundled JSON at `src/ai/core/pricing.json` is the canonical source (D-06).
 * - Env vars `LLM_INPUT_USD_PER_1K` and `LLM_OUTPUT_USD_PER_1K` override the rates of the
 *   DEFAULT model only (D-07). Other models in the table are unchanged by env.
 * - Empty-string env vars are treated as unset (no override applied).
 * - Non-numeric or non-positive env values throw with a descriptive message.
 *
 * @param opts Optional injection for tests; defaults to the bundled JSON + `process.env`.
 */
export function loadPricing(opts: LoadPricingOptions = {}): PricingTable {
  const source: PricingTable = opts.jsonPath
    ?  
      (require(opts.jsonPath) as PricingTable)
    : pricingJson;

  // Deep clone so callers can't mutate the cached JSON module.
  const table: PricingTable = {
    default: source.default,
    models: {},
  };
  for (const [name, rate] of Object.entries(source.models)) {
    table.models[name] = { ...rate };
  }

  const env = opts.env ?? process.env;
  applyEnvOverride(table, env, "LLM_INPUT_USD_PER_1K", "input_usd_per_1k");
  applyEnvOverride(table, env, "LLM_OUTPUT_USD_PER_1K", "output_usd_per_1k");

  return table;
}

/**
 * Look up the rate for a model. Falls back to the default model (D-08) when:
 *   - `model` is undefined
 *   - `model` is not present in `table.models`
 *
 * Returns the resolved model name alongside the rate so callers know which
 * pricing actually applied (matters for cost telemetry).
 */
export function lookupRate(
  table: PricingTable,
  model?: string
): { model: string; rate: ModelRate } {
  const chosen = model && table.models[model] ? model : table.default;
  return { model: chosen, rate: table.models[chosen] };
}

// ─── internals ───────────────────────────────────────────────────────────────

function applyEnvOverride(
  table: PricingTable,
  env: NodeJS.ProcessEnv,
  varName: "LLM_INPUT_USD_PER_1K" | "LLM_OUTPUT_USD_PER_1K",
  field: "input_usd_per_1k" | "output_usd_per_1k"
): void {
  const raw = env[varName];
  if (raw === undefined || raw === "") {
    return;
  }
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) {
    throw new Error(`${varName} must be a positive number (got "${raw}")`);
  }
  table.models[table.default][field] = n;
}
