/**
 * EN: Canonical `chaos/` bucket example — Functional Continuity Indicator
 *     (FCI) spike. Demonstrates how chaos scenarios assert continuity
 *     metrics during a simulated dependency-failure spike, without
 *     introducing external dependencies. Hermetic.
 * ES: Ejemplo canónico del bucket `chaos/` — spike del Functional Continuity
 *     Indicator (FCI). Demuestra cómo los escenarios de caos verifican
 *     métricas de continuidad durante un spike simulado de fallo de
 *     dependencias, sin introducir dependencias externas. Hermético.
 *
 * Run:
 *   ./bin/run-test.sh --client=_reference --scenario=chaos/fci-spike --profile=smoke
 */
import { check, sleep } from "k6";
import { Options } from "k6/options";
import { Counter, Rate } from "k6/metrics";

export const options: Options = {
  vus: 1,
  iterations: 10,
  thresholds: {
    // Tolerate the simulated spike: continuity must stay above 50% during chaos.
    "fci_continuity": ["rate>0.50"],
    "fci_spike_injections": ["count>=2"],
  },
};

const continuity = new Rate("fci_continuity");
const spikeInjections = new Counter("fci_spike_injections");

/**
 * EN: Decide whether the current iteration is inside the simulated chaos window.
 *     Iterations 4..6 represent the spike; outside the window the system is healthy.
 * ES: Decide si la iteración actual está dentro de la ventana de caos simulada.
 *     Las iteraciones 4..6 representan el spike; fuera de la ventana el sistema es saludable.
 */
function isInsideChaosWindow(iter: number): boolean {
  return iter >= 4 && iter <= 6;
}

export default function (): void {
  const insideChaos = isInsideChaosWindow(__ITER);
  if (insideChaos) {
    spikeInjections.add(1);
  }
  // During the chaos window 50% of "calls" continue successfully (simulated).
  // Outside the window all "calls" succeed.
  const succeeded = insideChaos ? __ITER % 2 === 0 : true;
  continuity.add(succeeded);
  check(
    { iter: __ITER, succeeded, insideChaos },
    {
      "continuity recorded": () => true,
      "spike correctly bounded": (s) => (s.insideChaos ? __ITER >= 4 && __ITER <= 6 : true),
    },
    { group: "fci-spike" }
  );
  sleep(0.05);
}
