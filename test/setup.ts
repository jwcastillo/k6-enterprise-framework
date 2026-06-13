import { vi } from "vitest";

// k6 global variables
(globalThis as Record<string, unknown>).__ENV = {} as Record<string, string>;
(globalThis as Record<string, unknown>).__VU = 1;
(globalThis as Record<string, unknown>).__ITER = 0;

// btoa polyfill for Node.js
if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (str: string) => Buffer.from(str, "binary").toString("base64");
}

// Mock k6 core
vi.mock("k6", () => ({
  check: vi.fn(() => true),
  sleep: vi.fn(),
  group: vi.fn((_name: string, fn: () => void) => fn()),
  fail: vi.fn(),
}));

// Mock k6/http
vi.mock("k6/http", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    patch: vi.fn(),
    request: vi.fn(),
    batch: vi.fn(),
    file: vi.fn(),
  },
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
  request: vi.fn(),
  batch: vi.fn(),
  file: vi.fn(),
}));

// Mock k6/ws
vi.mock("k6/ws", () => ({
  default: { connect: vi.fn() },
  connect: vi.fn(),
}));

// Mock k6/metrics
vi.mock("k6/metrics", () => ({
  Counter: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
  Trend: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
  Rate: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
  Gauge: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
}));

// Mock k6/data
vi.mock("k6/data", () => ({
  SharedArray: vi.fn().mockImplementation((_name: string, fn: () => unknown[]) => fn()),
}));

// Mock k6/websockets (stable module — k6 v1.6.0+)
vi.mock("k6/websockets", () => {
  class MockWebSocket {
    url: string;
    readyState = 1;
    bufferedAmount = 0;
    binaryType = "blob";
    send = vi.fn();
    close = vi.fn();
    ping = vi.fn();
    addEventListener = vi.fn();
    onopen: (() => void) | null = null;
    onmessage: ((event?: unknown) => void) | null = null;
    onerror: ((event?: unknown) => void) | null = null;
    onclose: (() => void) | null = null;
    onping: (() => void) | null = null;
    onpong: (() => void) | null = null;
    constructor(url: string, _protocols?: unknown, _params?: unknown) {
      this.url = url;
    }
  }
  return {
    WebSocket: MockWebSocket,
    ReadyState: { Connecting: 0, Open: 1, Closing: 2, Closed: 3 },
    BinaryType: { Blob: "blob", ArrayBuffer: "arraybuffer" },
    CompressionAlgorithm: { Deflate: "deflate" },
    EventName: {
      Open: "open",
      Close: "close",
      Error: "error",
      Message: "message",
      Ping: "ping",
      Pong: "pong",
    },
    MessageType: { Text: 1, Binary: 2, Close: 8, PingMessage: 9, PongMessage: 10 },
  };
});

// Mock k6/browser
vi.mock("k6/browser", () => ({
  browser: {
    newPage: vi.fn().mockResolvedValue({
      goto: vi.fn().mockResolvedValue(null),
      url: vi.fn(() => "https://test.k6.io"),
      close: vi.fn().mockResolvedValue(undefined),
      getByLabel: vi.fn(() => ({ fill: vi.fn().mockResolvedValue(undefined) })),
      getByRole: vi.fn(() => ({ click: vi.fn().mockResolvedValue(undefined) })),
      getByText: vi.fn(() => ({ click: vi.fn().mockResolvedValue(undefined) })),
      locator: vi.fn(() => ({ click: vi.fn().mockResolvedValue(undefined) })),
      frameLocator: vi.fn(() => ({ locator: vi.fn() })),
      goBack: vi.fn().mockResolvedValue(null),
      goForward: vi.fn().mockResolvedValue(null),
      route: vi.fn().mockResolvedValue(undefined),
      unrouteAll: vi.fn().mockResolvedValue(undefined),
      waitForURL: vi.fn().mockResolvedValue(undefined),
      waitForRequest: vi.fn().mockResolvedValue({}),
      waitForResponse: vi.fn().mockResolvedValue({}),
      waitForEvent: vi.fn().mockResolvedValue({}),
    }),
  },
}));

// Mock k6/crypto
vi.mock("k6/crypto", () => {
  const mockHasher = {
    update: vi.fn(),
    digest: vi.fn(() => "mockhash"),
  };
  return {
    default: {
      hmac: vi.fn(() => "mockhmac"),
      createHMAC: vi.fn(() => ({ ...mockHasher })),
      createHash: vi.fn(() => ({ ...mockHasher })),
      randomBytes: vi.fn((size: number) => new ArrayBuffer(size)),
    },
    hmac: vi.fn(() => "mockhmac"),
    createHMAC: vi.fn(() => ({ ...mockHasher })),
    createHash: vi.fn(() => ({ ...mockHasher })),
    randomBytes: vi.fn((size: number) => new ArrayBuffer(size)),
  };
});

// Mock k6/encoding
vi.mock("k6/encoding", () => ({
  default: {
    b64encode: vi.fn((data: string | ArrayBuffer, _encoding?: string) =>
      typeof data === "string" ? Buffer.from(data).toString("base64") : "base64mock"
    ),
    b64decode: vi.fn(() => ""),
  },
  b64encode: vi.fn((data: string | ArrayBuffer, _encoding?: string) =>
    typeof data === "string" ? Buffer.from(data).toString("base64") : "base64mock"
  ),
  b64decode: vi.fn(() => ""),
}));
