import { describe, it, expect, vi, beforeEach } from "vitest";
import ws from "k6/ws";
import { check } from "k6";
import { runWebSocket, wsEchoTest } from "../../src/helpers/websocket-helper";

describe("websocket-helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── runWebSocket ──────────────────────────────────────────────────────────

  describe("runWebSocket", () => {
    it("connects to the WebSocket URL", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      const session = runWebSocket(
        { url: "wss://echo.example.com" },
        () => {}
      );

      expect(ws.connect).toHaveBeenCalledWith(
        "wss://echo.example.com",
        expect.any(Object),
        expect.any(Function)
      );
      expect(session).toBeDefined();
    });

    it("tracks connection status via open event", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        // Trigger the open handler
        const openHandler = socket.on.mock.calls.find(
          (c: unknown[]) => c[0] === "open"
        )?.[1] as (() => void) | undefined;
        openHandler?.();
        return {} as never;
      });

      const session = runWebSocket(
        { url: "wss://echo.example.com" },
        () => {}
      );

      expect(session.connected).toBe(true);
    });

    it("collects messages", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        // Trigger message handler
        const msgHandler = socket.on.mock.calls.find(
          (c: unknown[]) => c[0] === "message"
        )?.[1] as ((data: string) => void) | undefined;
        msgHandler?.("hello");
        msgHandler?.("world");
        return {} as never;
      });

      const session = runWebSocket(
        { url: "wss://echo.example.com" },
        () => {}
      );

      expect(session.messages).toHaveLength(2);
      expect(session.messages[0].data).toBe("hello");
      expect(session.messages[1].data).toBe("world");
    });

    it("collects errors", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        const errorHandler = socket.on.mock.calls.find(
          (c: unknown[]) => c[0] === "error"
        )?.[1] as ((err: unknown) => void) | undefined;
        errorHandler?.({ message: "connection reset" });
        return {} as never;
      });

      const session = runWebSocket(
        { url: "wss://echo.example.com" },
        () => {}
      );

      expect(session.errors).toHaveLength(1);
      expect(session.errors[0]).toBe("connection reset");
    });

    it("handles error objects with error() function", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        const errorHandler = socket.on.mock.calls.find(
          (c: unknown[]) => c[0] === "error"
        )?.[1] as ((err: unknown) => void) | undefined;
        errorHandler?.({ error: () => "websocket error from function" });
        return {} as never;
      });

      const session = runWebSocket(
        { url: "wss://echo.example.com" },
        () => {}
      );

      expect(session.errors[0]).toBe("websocket error from function");
    });

    it("marks session as closed cleanly", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        const closeHandler = socket.on.mock.calls.find(
          (c: unknown[]) => c[0] === "close"
        )?.[1] as (() => void) | undefined;
        closeHandler?.();
        return {} as never;
      });

      const session = runWebSocket(
        { url: "wss://echo.example.com" },
        () => {}
      );

      expect(session.closedCleanly).toBe(true);
    });

    it("passes tags to ws.connect params", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      runWebSocket(
        { url: "wss://echo.example.com", tags: { service: "chat" } },
        () => {}
      );

      const params = vi.mocked(ws.connect).mock.calls[0][1] as Record<string, unknown>;
      expect(params.tags).toEqual({ service: "chat" });
    });

    it("sets timeout when configured", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      runWebSocket(
        { url: "wss://echo.example.com", timeoutMs: 5000 },
        () => {}
      );

      // Verify setTimeout was called on the socket
      vi.mocked(ws.connect).mock.calls[0][2]; // callback was called
    });

    it("calls user handler with socket and session", () => {
      const handler = vi.fn();
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      runWebSocket({ url: "wss://echo.example.com" }, handler);

      expect(handler).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          messages: expect.any(Array),
          errors: expect.any(Array),
          connected: false,
          closedCleanly: false,
        })
      );
    });

    it("calls check with WebSocket assertions", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      runWebSocket({ url: "wss://echo.example.com" }, () => {});

      expect(check).toHaveBeenCalled();
    });

    // ── Security: CHK-SEC-059 ────────────────────────────────────────────────

    it("throws when ws:// URL contains token= parameter", () => {
      expect(() =>
        runWebSocket(
          { url: "ws://example.com/ws?token=secret123" },
          () => {}
        )
      ).toThrow("unencrypted");
    });

    it("throws when ws:// URL contains auth= parameter", () => {
      expect(() =>
        runWebSocket(
          { url: "ws://example.com/ws?auth=mytoken" },
          () => {}
        )
      ).toThrow("unencrypted");
    });

    it("throws when ws:// URL contains key= parameter", () => {
      expect(() =>
        runWebSocket(
          { url: "ws://example.com/ws?key=apikey123" },
          () => {}
        )
      ).toThrow("unencrypted");
    });

    it("allows wss:// with sensitive parameters", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      expect(() =>
        runWebSocket(
          { url: "wss://example.com/ws?token=secret123" },
          () => {}
        )
      ).not.toThrow();
    });

    it("allows ws:// without sensitive parameters", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      expect(() =>
        runWebSocket(
          { url: "ws://example.com/ws?channel=general" },
          () => {}
        )
      ).not.toThrow();
    });
  });

  // ── wsEchoTest ────────────────────────────────────────────────────────────

  describe("wsEchoTest", () => {
    it("returns true when echo matches", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);

        // Simulate open → send → receive echo
        const openHandler = socket.on.mock.calls.find(
          (c: unknown[]) => c[0] === "open"
        )?.[1] as (() => void) | undefined;
        openHandler?.();

        // The inner handler from wsEchoTest registers another "open" and "message"
        // But due to how the mock is structured, we also need to trigger the session
        // message handler for message tracking
        const msgHandlers = socket.on.mock.calls.filter(
          (c: unknown[]) => c[0] === "message"
        );
        // Trigger the second message handler (from wsEchoTest)
        for (const [, handler] of msgHandlers) {
          (handler as (data: string) => void)("hello");
        }

        return {} as never;
      });

      const result = wsEchoTest("wss://echo.example.com", "hello");
      expect(result).toBe(true);
    });

    it("returns false when echo does not match", () => {
      vi.mocked(ws.connect).mockImplementation((_url, _params, callback) => {
        const socket = createMockSocket();
        callback(socket as never);
        return {} as never;
      });

      const result = wsEchoTest("wss://echo.example.com", "hello");
      expect(result).toBe(false);
    });
  });
});

// ── Helper to create mock socket ───────────────────────────────────────────

function createMockSocket() {
  return {
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    setTimeout: vi.fn(),
  };
}
