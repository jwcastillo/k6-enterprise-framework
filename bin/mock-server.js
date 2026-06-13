#!/usr/bin/env node
/**
 * T-151: Mock server for load test development and CI
 *
 * Starts a lightweight HTTP/HTTPS mock server with configurable REST endpoints.
 * Designed for k6 test development: provides predictable responses so tests
 * can validate framework behavior without a real backend.
 *
 * Features:
 * - Pre-configured REST endpoints: /health, /api/users, /api/login, /api/orders
 * - Configurable latency simulation (--latency=50)
 * - Configurable error rate (--error-rate=0.05 for 5% random 500s)
 * - Rate limiting simulation (--rate-limit=100 reqs/s)
 * - Custom routes via JSON file (--routes=routes.json)
 * - Request logging with timestamps
 *
 * Usage:
 *   node bin/mock-server.js
 *   node bin/mock-server.js --port=8080
 *   node bin/mock-server.js --port=8080 --latency=100 --error-rate=0.05
 *   node bin/mock-server.js --routes=custom-routes.json
 *   node bin/mock-server.js --help
 *
 * Exit codes:
 *   0  graceful shutdown
 *   1  startup error
 */

"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : defaultVal;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

if (hasFlag("help") || args.includes("-h")) {
  require("./_help").printHelp({
    name: "mock-server",
    description:
      "Lightweight mock HTTP server for k6 test development (T-151) — built-ins: /health, /api/users, /api/login, /api/orders, /slow, /error, /rate-limited",
    usage: "node bin/mock-server.js [options]",
    flags: [
      { flag: "--port=<n>", description: "Listen port (default: 8080)" },
      { flag: "--host=<host>", description: "Listen host (default: 0.0.0.0)" },
      {
        flag: "--latency=<ms>",
        description: "Add artificial latency to all responses (default: 0)",
      },
      {
        flag: "--error-rate=<rate>",
        description: "Fraction of requests that return 500 (e.g. 0.05 = 5%)",
      },
      {
        flag: "--rate-limit=<rps>",
        description: "Simulate rate limiting: return 429 above this req/s",
      },
      { flag: "--routes=<file>", description: "JSON file with custom route definitions" },
      { flag: "--log", description: "Enable request logging (default: on)" },
      { flag: "--no-log", description: "Disable request logging" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/mock-server.js --port=8080",
      "node bin/mock-server.js --port=8080 --latency=100 --error-rate=0.05 --routes=routes.json",
    ],
  });
  process.exit(0);
}

const PORT = parseInt(getArg("port", "8080"), 10);
const HOST = getArg("host", "0.0.0.0");
const BASE_LATENCY = parseInt(getArg("latency", "0"), 10);
const ERROR_RATE = parseFloat(getArg("error-rate", "0"));
const RATE_LIMIT_RPS = parseFloat(getArg("rate-limit", "0"));
const ROUTES_FILE = getArg("routes", "");
const LOGGING = !hasFlag("no-log");

// ── Request counter for rate limiting ─────────────────────────────────────────

let reqCountThisSecond = 0;
let reqWindowStart = Date.now();

function isRateLimited() {
  if (!RATE_LIMIT_RPS) return false;
  const now = Date.now();
  if (now - reqWindowStart > 1000) {
    reqCountThisSecond = 0;
    reqWindowStart = now;
  }
  reqCountThisSecond++;
  return reqCountThisSecond > RATE_LIMIT_RPS;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const USERS = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  role: i === 0 ? "admin" : "user",
  createdAt: new Date(Date.now() - i * 86400000).toISOString(),
}));

const ORDERS = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  userId: (i % 5) + 1,
  total: (Math.random() * 200 + 10).toFixed(2),
  status: ["pending", "processing", "shipped", "delivered"][i % 4],
  createdAt: new Date(Date.now() - i * 3600000).toISOString(),
}));

let nextUserId = USERS.length + 1;
let nextOrderId = ORDERS.length + 1;

// ── Custom routes ─────────────────────────────────────────────────────────────

let customRoutes = [];
if (ROUTES_FILE) {
  try {
    customRoutes = JSON.parse(fs.readFileSync(ROUTES_FILE, "utf-8"));
    console.log(`[mock-server] Loaded ${customRoutes.length} custom route(s) from ${ROUTES_FILE}`);
  } catch (err) {
    console.error(`[mock-server] Cannot load routes file '${ROUTES_FILE}': ${err.message}`);
    process.exit(1);
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "X-Mock-Server": "k6-enterprise-framework",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Route matching ────────────────────────────────────────────────────────────

function matchRoute(method, pathname) {
  // Custom routes (exact match)
  for (const r of customRoutes) {
    if (r.method.toUpperCase() === method && r.path === pathname) {
      return { type: "custom", route: r };
    }
  }

  // Built-in routes
  const segments = pathname.split("/").filter(Boolean);

  if (method === "GET" && pathname === "/health") return { type: "health" };
  if (method === "GET" && pathname === "/slow") return { type: "slow" };
  if (method === "GET" && pathname === "/error") return { type: "error" };
  if (method === "GET" && pathname === "/rate-limited") return { type: "rate-limited" };

  if (segments[0] === "api") {
    if (segments[1] === "users") {
      if (!segments[2]) {
        if (method === "GET") return { type: "users-list" };
        if (method === "POST") return { type: "users-create" };
      } else {
        const id = parseInt(segments[2], 10);
        if (!isNaN(id)) {
          if (method === "GET") return { type: "users-get", id };
          if (method === "PUT" || method === "PATCH") return { type: "users-update", id };
          if (method === "DELETE") return { type: "users-delete", id };
        }
      }
    }

    if (segments[1] === "login" && method === "POST") return { type: "login" };

    if (segments[1] === "orders") {
      if (!segments[2]) {
        if (method === "GET") return { type: "orders-list" };
        if (method === "POST") return { type: "orders-create" };
      } else {
        const id = parseInt(segments[2], 10);
        if (!isNaN(id) && method === "GET") return { type: "orders-get", id };
      }
    }
  }

  return { type: "not-found" };
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handle(req, res) {
  const start = Date.now();
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = (req.method || "GET").toUpperCase();

  // Simulate global error rate
  if (ERROR_RATE > 0 && Math.random() < ERROR_RATE) {
    await sleep(BASE_LATENCY);
    json(res, 500, { error: "Simulated server error", code: "MOCK_ERROR" });
    if (LOGGING)
      console.log(`[mock] ${method} ${pathname} → 500 (simulated error) +${Date.now() - start}ms`);
    return;
  }

  // Rate limiting check
  if (isRateLimited()) {
    json(res, 429, { error: "Too Many Requests", retryAfter: 1 });
    if (LOGGING)
      console.log(`[mock] ${method} ${pathname} → 429 (rate limited) +${Date.now() - start}ms`);
    return;
  }

  // Add base latency
  if (BASE_LATENCY > 0) await sleep(BASE_LATENCY);

  const match = matchRoute(method, pathname);
  let status = 200;

  switch (match.type) {
    case "health":
      json(res, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
      break;

    case "slow":
      await sleep(2000);
      json(res, 200, { status: "ok", message: "slow response", elapsed: 2000 });
      break;

    case "error":
      json(res, 500, { error: "Internal Server Error", code: "ALWAYS_ERROR" });
      status = 500;
      break;

    case "rate-limited":
      json(res, 429, { error: "Too Many Requests", retryAfter: 60 });
      status = 429;
      break;

    case "custom": {
      const r = match.route;
      const body = r.body !== undefined ? r.body : { ok: true };
      json(res, r.status || 200, body);
      status = r.status || 200;
      break;
    }

    case "users-list":
      json(res, 200, { users: USERS, total: USERS.length });
      break;

    case "users-get": {
      const user = USERS.find((u) => u.id === match.id);
      if (user) {
        json(res, 200, user);
      } else {
        json(res, 404, { error: "User not found", id: match.id });
        status = 404;
      }
      break;
    }

    case "users-create": {
      const body = await readBody(req);
      const newUser = {
        id: nextUserId++,
        createdAt: new Date().toISOString(),
        role: "user",
        ...body,
      };
      USERS.push(newUser);
      json(res, 201, newUser);
      status = 201;
      break;
    }

    case "users-update": {
      const idx = USERS.findIndex((u) => u.id === match.id);
      if (idx >= 0) {
        const body = await readBody(req);
        Object.assign(USERS[idx], body);
        json(res, 200, USERS[idx]);
      } else {
        json(res, 404, { error: "User not found" });
        status = 404;
      }
      break;
    }

    case "users-delete": {
      const idx = USERS.findIndex((u) => u.id === match.id);
      if (idx >= 0) {
        USERS.splice(idx, 1);
        json(res, 200, { deleted: true, id: match.id });
      } else {
        json(res, 404, { error: "User not found" });
        status = 404;
      }
      break;
    }

    case "login": {
      const body = await readBody(req);
      const { username, password } = body;
      // Accept test credentials or any non-empty credentials
      if (username && password) {
        json(res, 200, {
          token: `mock-jwt-${Buffer.from(`${username}:${Date.now()}`).toString("base64")}`,
          expiresIn: 3600,
          user: { username, role: username === "admin" ? "admin" : "user" },
        });
      } else {
        json(res, 401, { error: "Unauthorized", message: "username and password required" });
        status = 401;
      }
      break;
    }

    case "orders-list":
      json(res, 200, { orders: ORDERS, total: ORDERS.length });
      break;

    case "orders-get": {
      const order = ORDERS.find((o) => o.id === match.id);
      if (order) {
        json(res, 200, order);
      } else {
        json(res, 404, { error: "Order not found", id: match.id });
        status = 404;
      }
      break;
    }

    case "orders-create": {
      const body = await readBody(req);
      const newOrder = {
        id: nextOrderId++,
        status: "pending",
        createdAt: new Date().toISOString(),
        ...body,
      };
      ORDERS.push(newOrder);
      json(res, 201, newOrder);
      status = 201;
      break;
    }

    default:
      json(res, 404, { error: "Not Found", path: pathname, method });
      status = 404;
  }

  if (LOGGING) {
    console.log(`[mock] ${method} ${pathname} → ${status} +${Date.now() - start}ms`);
  }
}

// ── Start server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`[mock-server] Handler error: ${err.message}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal mock server error" }));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-server] k6 Enterprise Framework Mock Server`);
  console.log(`[mock-server] Listening on http://${HOST}:${PORT}`);
  console.log(
    `[mock-server] Latency: ${BASE_LATENCY}ms | Error rate: ${(ERROR_RATE * 100).toFixed(0)}% | Rate limit: ${RATE_LIMIT_RPS || "none"}`
  );
  console.log(`[mock-server] Endpoints: /health /api/users /api/login /api/orders /slow /error`);
  console.log(`[mock-server] Press Ctrl+C to stop\n`);
});

server.on("error", (err) => {
  console.error(`[mock-server] Failed to start: ${err.message}`);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[mock-server] Received ${signal} — shutting down gracefully`);
  server.close(() => {
    console.log("[mock-server] Server closed");
    process.exit(0);
  });
  setTimeout(() => {
    console.log("[mock-server] Forced shutdown after timeout");
    process.exit(0);
  }, 3000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
