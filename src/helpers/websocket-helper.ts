/**
 * T-018a: WebSocketHelper — WebSocket con ciclo completo y instrumentacion k6
 *
 * @deprecated Use websocket-v2-helper.ts (k6/websockets stable module) instead.
 * This helper uses the legacy k6/ws callback-based API.
 * Kept for backward compatibility with existing scenarios.
 */

import ws from "k6/ws";
import { check } from "k6";

export interface WebSocketConfig {
  url: string;
  /** Subprotocols to negotiate */
  protocols?: string[];
  /** Connection timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** Tags for k6 metrics */
  tags?: Record<string, string>;
}

export interface WebSocketMessage {
  data: string;
  timestamp: number;
}

export interface WebSocketSession {
  messages: WebSocketMessage[];
  errors: string[];
  connected: boolean;
  closedCleanly: boolean;
}

export type WSHandler = (socket: ws.Socket, session: WebSocketSession) => void;

/**
 * Execute a WebSocket session with k6/ws.
 * Enforces wss:// for URLs that contain tokens/credentials (CHK-SEC-059).
 */
export function runWebSocket(config: WebSocketConfig, handler: WSHandler): WebSocketSession {
  // CHK-SEC-059: use wss:// when URL contains sensitive data indicators
  if (
    config.url.includes("token=") ||
    config.url.includes("auth=") ||
    config.url.includes("key=")
  ) {
    if (config.url.startsWith("ws://")) {
      throw new Error(
        `WebSocketHelper: URL appears to contain sensitive data but uses ws:// (unencrypted). ` +
          `Use wss:// to protect credentials in transit.`
      );
    }
  }

  const session: WebSocketSession = {
    messages: [],
    errors: [],
    connected: false,
    closedCleanly: false,
  };

  const params: Record<string, unknown> = {};
  if (config.tags) params["tags"] = config.tags;

  const res = ws.connect(config.url, params, (socket) => {
    socket.on("open", () => {
      session.connected = true;
    });

    socket.on("message", (data: string) => {
      session.messages.push({ data, timestamp: Date.now() });
    });

    socket.on("error", (err) => {
      // k6 WebSocketError.error() is a function — cast via unknown to inspect safely
      const e = err as unknown as Record<string, unknown>;
      const msg =
        typeof e["error"] === "function"
          ? (e["error"] as () => string)()
          : typeof e["message"] === "string"
            ? e["message"]
            : String(err);
      session.errors.push(msg);
    });

    socket.on("close", () => {
      session.closedCleanly = true;
    });

    // Apply timeout
    if (config.timeoutMs) {
      socket.setTimeout(() => {
        socket.close();
      }, config.timeoutMs);
    }

    // Run user handler
    handler(socket, session);
  });

  check(res, {
    "ws: connected successfully": () => session.connected,
    "ws: no errors": () => session.errors.length === 0,
    "ws: closed cleanly": () => session.closedCleanly,
  });

  return session;
}

/**
 * Simple WebSocket echo test — sends a message and verifies it is echoed back.
 * Useful for smoke testing WebSocket endpoints.
 */
export function wsEchoTest(url: string, message: string, timeoutMs = 5000): boolean {
  let echoed = false;

  runWebSocket({ url, timeoutMs }, (socket, session) => {
    socket.on("open", () => {
      socket.send(message);
    });

    socket.on("message", (data: string) => {
      if (data === message) {
        echoed = true;
        socket.close();
      }
    });

    // safety timeout already handled by runWebSocket
    void session;
  });

  return echoed;
}
