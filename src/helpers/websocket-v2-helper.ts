/** T-018b: WebSocketV2Helper — WebSocket usando modulo estable k6/websockets (v1.6.0+) */

import { WebSocket, Params } from "k6/websockets";
import type { MessageEvent, ErrorEvent, ReadyState, CompressionAlgorithm } from "k6/websockets";
import { check, sleep } from "k6";

// @types/k6 >=2.1 declara estos como tipos literales, no como enums:
// CompressionAlgorithm = "deflate" y ReadyState = 0 | 1 | 2 | 3 (spec WebSocket).
const DEFLATE: CompressionAlgorithm = "deflate";
const WS_CONNECTING: ReadyState = 0;
const WS_OPEN: ReadyState = 1;

export interface WebSocketV2Config {
  url: string;
  /** Custom headers for the connection */
  headers?: Record<string, string>;
  /** Connection timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** Tags for k6 metrics */
  tags?: Record<string, string>;
  /** Compression algorithm */
  compression?: "deflate";
}

export interface WebSocketCloseInfo {
  code?: number;
  reason?: string;
}

export interface WebSocketV2Message {
  data: string;
  timestamp: number;
}

export interface WebSocketV2Session {
  messages: WebSocketV2Message[];
  errors: string[];
  connected: boolean;
  closedCleanly: boolean;
  closeInfo?: WebSocketCloseInfo;
}

export type WSV2Handler = (ws: WebSocket, session: WebSocketV2Session) => void;

/**
 * Validate URL security — enforces wss:// when URL contains sensitive data (CHK-SEC-059).
 */
function assertSecureUrl(url: string): void {
  if (url.includes("token=") || url.includes("auth=") || url.includes("key=")) {
    if (url.startsWith("ws://")) {
      throw new Error(
        `WebSocketV2Helper: URL appears to contain sensitive data but uses ws:// (unencrypted). ` +
          `Use wss:// to protect credentials in transit.`
      );
    }
  }
}

/**
 * Execute a WebSocket session using the stable k6/websockets module (v1.6.0+).
 *
 * Unlike the legacy k6/ws module, this uses the standard WebSocket constructor API
 * with event handlers (onopen, onmessage, onerror, onclose) and supports
 * close codes/reasons (v1.5.0+).
 *
 * CHK-SEC-059: enforces wss:// for URLs containing tokens/credentials.
 */
export function runWebSocketV2(
  config: WebSocketV2Config,
  handler: WSV2Handler
): WebSocketV2Session {
  assertSecureUrl(config.url);

  const session: WebSocketV2Session = {
    messages: [],
    errors: [],
    connected: false,
    closedCleanly: false,
  };

  const params: Params = {};
  if (config.headers) params.headers = config.headers;
  if (config.tags) params.tags = config.tags;
  if (config.compression) params.compression = DEFLATE;

  const ws = new WebSocket(config.url, null, params);

  ws.onopen = (): void => {
    session.connected = true;
  };

  ws.onmessage = (event?: MessageEvent): void => {
    if (!event) return;
    session.messages.push({
      data: typeof event.data === "string" ? event.data : String(event.data),
      timestamp: event.timestamp || Date.now(),
    });
  };

  ws.onerror = (event?: ErrorEvent): void => {
    session.errors.push(event?.error || "unknown error");
  };

  ws.onclose = (): void => {
    session.closedCleanly = true;
  };

  // Run user handler — gives access to the ws instance for send/close
  handler(ws, session);

  // Apply timeout: close connection after timeoutMs
  if (config.timeoutMs) {
    const timeoutSec = config.timeoutMs / 1000;
    sleep(timeoutSec);
    if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
      ws.close(1000, "timeout");
    }
  }

  check(null, {
    "ws v2: connected successfully": () => session.connected,
    "ws v2: no errors": () => session.errors.length === 0,
    "ws v2: closed cleanly": () => session.closedCleanly,
  });

  return session;
}

/**
 * Close a WebSocket connection with code and reason (k6 v1.5.0+).
 */
export function closeWithReason(ws: WebSocket, code = 1000, reason = "normal closure"): void {
  ws.close(code, reason);
}

/**
 * Simple WebSocket echo test using the stable k6/websockets module.
 * Sends a message and verifies it is echoed back.
 */
export function wsEchoTestV2(url: string, message: string, timeoutMs = 5000): boolean {
  let echoed = false;

  runWebSocketV2({ url, timeoutMs }, (ws): void => {
    ws.onopen = (): void => {
      ws.send(message);
    };

    ws.onmessage = (event?: MessageEvent): void => {
      if (event && typeof event.data === "string" && event.data === message) {
        echoed = true;
        ws.close(1000, "echo received");
      }
    };
  });

  return echoed;
}
