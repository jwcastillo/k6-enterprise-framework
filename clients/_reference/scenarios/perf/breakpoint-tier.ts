/**
 * EN: Canonical `perf/` bucket example — capacity / breakpoint tier.
 *     Demonstrates how perf scenarios characterize capacity by ramping
 *     simulated load and recording per-tier latency without external
 *     network calls. Hermetic.
 * ES: Ejemplo canónico del bucket `perf/` — capacidad / tier de breakpoint.
 *     Demuestra cómo los escenarios perf caracterizan capacidad escalando
 *     carga simulada y registrando la latencia por tier sin llamadas HTTP
 *     externas. Hermético.
 *
 * Run:
 *   ./bin/run-test.sh --client=_reference --scenario=perf/breakpoint-tier --profile=smoke
 */
import { check, sleep } from "k6";
import { Options } from "k6/options";
import { Trend, Counter } from "k6/metrics";

export const options: Options = {
  vus: 1,
  iterations: 12,
  thresholds: {
    "tier_latency_ms{tier:low}": ["p(95)<50"],
    "tier_latency_ms{tier:mid}": ["p(95)<150"],
    "tier_breakpoint_observations": ["count>=12"],
  },
};

const tierLatency = new Trend("tier_latency_ms", true);
const observations = new Counter("tier_breakpoint_observations");

type Tier = "low" | "mid" | "high";

/**
 * EN: Map iteration ordinal to a load tier (low / mid / high).
 * ES: Mapea el ordinal de la iteración a un tier de carga (bajo / medio / alto).
 */
function tierForIter(iter: number): Tier {
  if (iter < 4) return "low";
  if (iter < 8) return "mid";
  return "high";
}

/**
 * EN: Synthesize a per-tier latency observation in ms (no actual I/O).
 *     Latency grows roughly linearly across tiers to mimic the shape of
 *     a real breakpoint curve.
 * ES: Sintetiza una observación de latencia por tier en ms (sin I/O real).
 *     La latencia crece aproximadamente lineal entre tiers para imitar la
 *     forma de una curva de breakpoint real.
 */
function synthLatency(tier: Tier, iter: number): number {
  const base = tier === "low" ? 20 : tier === "mid" ? 80 : 200;
  const jitter = (iter % 5) * 2;
  return base + jitter;
}

export default function (): void {
  const tier = tierForIter(__ITER);
  const latency = synthLatency(tier, __ITER);
  tierLatency.add(latency, { tier });
  observations.add(1, { tier });
  check(
    { tier, latency },
    {
      "tier classified": (o) => ["low", "mid", "high"].indexOf(o.tier) >= 0,
      "latency monotone-ish across tiers": (o) =>
        o.tier === "low" ? o.latency < 80 : o.tier === "mid" ? o.latency < 150 : true,
    },
    { group: "breakpoint-tier" }
  );
  sleep(0.02);
}
