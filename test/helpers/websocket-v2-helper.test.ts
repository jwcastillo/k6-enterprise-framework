import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSocket } from "k6/websockets";
import {
  runWebSocketV2,
  wsEchoTestV2,
  closeWithReason,
} from "../../src/helpers/websocket-v2-helper";

describe("WebSocketV2Helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runWebSocketV2", () => {
    it("should create a WebSocket instance", () => {
      const session = runWebSocketV2({ url: "wss://echo.test", timeoutMs: 100 }, () => {});

      expect(session).toBeDefined();
      expect(session.messages).toEqual([]);
      expect(session.errors).toEqual([]);
    });

    it("should invoke handler with ws instance and session", () => {
      const handler = vi.fn();

      runWebSocketV2({ url: "wss://test", timeoutMs: 100 }, handler);

      expect(handler).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          messages: [],
          errors: [],
          connected: false,
          closedCleanly: false,
        }),
      );
    });

    it("should set onopen handler on ws instance", () => {
      let wsInstance: InstanceType<typeof WebSocket> | null = null;

      runWebSocketV2({ url: "wss://test", timeoutMs: 100 }, (ws) => {
        wsInstance = ws;
      });

      expect(wsInstance).not.toBeNull();
      expect(typeof wsInstance!.onopen).toBe("function");
    });

    it("should set onmessage handler on ws instance", () => {
      let wsInstance: InstanceType<typeof WebSocket> | null = null;

      runWebSocketV2({ url: "wss://test", timeoutMs: 100 }, (ws) => {
        wsInstance = ws;
      });

      expect(typeof wsInstance!.onmessage).toBe("function");
    });

    it("should enforce wss:// for URLs with token= (CHK-SEC-059)", () => {
      expect(() =>
        runWebSocketV2({ url: "ws://api.test?token=abc" }, () => {}),
      ).toThrow("wss://");
    });

    it("should enforce wss:// for URLs with auth= (CHK-SEC-059)", () => {
      expect(() =>
        runWebSocketV2({ url: "ws://api.test?auth=secret" }, () => {}),
      ).toThrow("wss://");
    });

    it("should enforce wss:// for URLs with key= (CHK-SEC-059)", () => {
      expect(() =>
        runWebSocketV2({ url: "ws://api.test?key=123" }, () => {}),
      ).toThrow("wss://");
    });

    it("should allow ws:// for URLs without sensitive data", () => {
      expect(() =>
        runWebSocketV2({ url: "ws://echo.test", timeoutMs: 100 }, () => {}),
      ).not.toThrow();
    });

    it("should allow wss:// URLs with sensitive data", () => {
      expect(() =>
        runWebSocketV2({ url: "wss://api.test?token=abc", timeoutMs: 100 }, () => {}),
      ).not.toThrow();
    });

    it("should return a session object with correct shape", () => {
      const session = runWebSocketV2({ url: "wss://test", timeoutMs: 100 }, () => {});

      expect(session).toHaveProperty("messages");
      expect(session).toHaveProperty("errors");
      expect(session).toHaveProperty("connected");
      expect(session).toHaveProperty("closedCleanly");
      expect(Array.isArray(session.messages)).toBe(true);
      expect(Array.isArray(session.errors)).toBe(true);
    });

    it("should allow handler to send messages", () => {
      let wsInstance: InstanceType<typeof WebSocket> | null = null;

      runWebSocketV2({ url: "wss://test", timeoutMs: 100 }, (ws) => {
        wsInstance = ws;
        ws.send("hello");
      });

      expect(wsInstance!.send).toHaveBeenCalledWith("hello");
    });
  });

  describe("closeWithReason", () => {
    it("should call ws.close with code and reason", () => {
      const mockWs = { close: vi.fn() } as unknown as InstanceType<typeof WebSocket>;

      closeWithReason(mockWs, 1001, "going away");

      expect(mockWs.close).toHaveBeenCalledWith(1001, "going away");
    });

    it("should use defaults of 1000 and 'normal closure'", () => {
      const mockWs = { close: vi.fn() } as unknown as InstanceType<typeof WebSocket>;

      closeWithReason(mockWs);

      expect(mockWs.close).toHaveBeenCalledWith(1000, "normal closure");
    });
  });

  describe("wsEchoTestV2", () => {
    it("should create a WebSocket and return boolean result", () => {
      // The mock WebSocket won't actually fire events, so echoed will be false
      const result = wsEchoTestV2("wss://echo.test", "hello", 100);

      expect(result).toBe(false); // no real event loop in mock
    });
  });
});
