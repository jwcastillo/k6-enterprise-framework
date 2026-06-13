/**
 * EN: Canonical `domain/` bucket example — orders lifecycle smoke.
 *     Demonstrates the domain bucket convention (sub-grouping by service)
 *     and a simulated lifecycle transition without external network calls.
 *     Hermetic: uses only k6 builtins and inline computation. Safe to run
 *     in offline / network-restricted environments.
 * ES: Ejemplo canónico del bucket `domain/` — smoke del ciclo de vida de
 *     órdenes. Demuestra la convención del bucket (sub-grouping por servicio)
 *     y una transición simulada de ciclo de vida sin llamadas HTTP externas.
 *     Hermético: solo usa builtins de k6 y cómputo en línea. Seguro para
 *     entornos offline / con restricciones de red.
 *
 * Run:
 *   ./bin/run-test.sh --client=_reference --scenario=domain/orders-lifecycle --profile=smoke
 */
import { check, sleep } from "k6";
import { Options } from "k6/options";
import { Counter, Trend } from "k6/metrics";

export const options: Options = {
  vus: 1,
  iterations: 5,
  thresholds: {
    "checks{group:orders-lifecycle}": ["rate>0.99"],
    "orders_state_transitions": ["count>=5"],
  },
};

const transitions = new Counter("orders_state_transitions");
const stateLatency = new Trend("orders_state_latency_ms", true);

const STATES = ["created", "validated", "paid", "fulfilled", "closed"] as const;
type OrderState = (typeof STATES)[number];

interface SimulatedOrder {
  id: string;
  state: OrderState;
}

function advance(order: SimulatedOrder): SimulatedOrder {
  const i = STATES.indexOf(order.state);
  const next: OrderState = STATES[Math.min(i + 1, STATES.length - 1)];
  return { id: order.id, state: next };
}

/**
 * EN: Smoke the canonical state-machine transitions for a single order id.
 *     No HTTP calls — the lifecycle is computed inline to keep the example hermetic.
 * ES: Smoke a las transiciones canónicas del state-machine para una orden.
 *     Sin llamadas HTTP — el lifecycle se computa en línea para mantener
 *     el ejemplo hermético.
 */
export default function (): void {
  const orderId = `ord-${__VU}-${__ITER}-${Date.now()}`;
  let order: SimulatedOrder = { id: orderId, state: "created" };

  for (let i = 0; i < STATES.length - 1; i++) {
    const start = Date.now();
    order = advance(order);
    const elapsed = Date.now() - start;
    stateLatency.add(elapsed);
    transitions.add(1);
    check(order, { "transition advanced": (o) => o.state === STATES[i + 1] }, {
      group: "orders-lifecycle",
    });
    sleep(0.01);
  }

  check(order, { "reached terminal state": (o) => o.state === "closed" }, {
    group: "orders-lifecycle",
  });
}
