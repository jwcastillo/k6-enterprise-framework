/**
 * 12-websocket — WebSocket connect/send/receive/close
 *
 * Demonstrates: WebSocket protocol testing, message exchange,
 * connection lifecycle management
 *
 * Uses: wss://echo.websocket.org (public echo server)
 *
 * Expected results:
 *   - Connection established
 *   - Sent message echoed back
 *   - Clean close
 *   - P95 < 3000ms
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=integration/12-websocket --profile=smoke
 *
 * Troubleshooting:
 *   - If connection fails: echo.websocket.org may be down — use --env=local
 *   - WebSocket support requires k6 v0.32+
 */

import ws from "k6/ws";
import { check } from "k6";

export const options = {
  vus: 1,
  duration: "20s",
  thresholds: {
    ws_connecting: ["p(95)<1000"],
    ws_session_duration: ["p(95)<3000"],
  },
};

const WS_URL = __ENV["WS_URL"] ?? "wss://echo.websocket.org";

export default function (): void {
  const message = `Hello from VU-${__VU} iteration-${__ITER}`;
  let echoed = false;

  const res = ws.connect(WS_URL, {}, (socket) => {
    socket.on("open", () => {
      socket.send(message);
    });

    socket.on("message", (data) => {
      echoed = data === message;
      socket.close();
    });

    socket.on("error", (err) => {
      console.error(`WebSocket error: ${err}`);
      socket.close();
    });

    // Safety timeout
    socket.setTimeout(() => { socket.close(); }, 5000);
  });

  check(res, {
    "ws: connection established": r => r && r.status === 101,
  });
  check(null, {
    "ws: message echoed correctly": () => echoed,
  });
}
