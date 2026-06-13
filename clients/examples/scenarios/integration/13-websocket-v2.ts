/**
 * 13-websocket-v2 — WebSocket using stable k6/websockets module (v1.6.0+)
 *
 * Demonstrates: Standard WebSocket API with constructor, event handlers,
 * close codes/reasons, and ping support.
 *
 * Uses: wss://echo.websocket.org (public echo server)
 *
 * Expected results:
 *   - Connection established via new WebSocket()
 *   - Sent message echoed back
 *   - Clean close with code 1000
 *   - P95 < 3000ms
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=integration/13-websocket-v2 --profile=smoke
 *
 * Key differences from 12-websocket (legacy k6/ws):
 *   - Uses `new WebSocket(url)` constructor (standard browser-like API)
 *   - Event handlers: onopen, onmessage, onerror, onclose
 *   - Supports close(code, reason) for protocol-level close codes
 *   - Non-blocking event-driven model
 */

import { WebSocket } from "k6/websockets";
import { check, sleep } from "k6";
import type { MessageEvent } from "k6/websockets";

export const options = {
  vus: 1,
  duration: "20s",
  thresholds: {
    checks: ["rate>0.95"],
  },
};

const WS_URL = __ENV["WS_URL"] ?? "wss://echo.websocket.org";

export default function (): void {
  const message = `Hello from VU-${__VU} iter-${__ITER}`;
  let echoed = false;

  const ws = new WebSocket(WS_URL);

  ws.onopen = (): void => {
    ws.send(message);
  };

  ws.onmessage = (event?: MessageEvent): void => {
    if (event && typeof event.data === "string" && event.data === message) {
      echoed = true;
      // Close with code 1000 (normal) and a reason string (k6 v1.5.0+)
      ws.close(1000, "echo received");
    }
  };

  ws.onerror = (event?): void => {
    console.error(`WebSocket error: ${event?.error}`);
    ws.close(1011, "unexpected error");
  };

  ws.onclose = (): void => {
    check(null, {
      "ws v2: message echoed correctly": (): boolean => echoed,
    });
  };

  // Give time for the round-trip
  sleep(2);
}
