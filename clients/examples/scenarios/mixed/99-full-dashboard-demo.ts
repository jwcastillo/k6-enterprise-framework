/**
 * 99-full-dashboard-demo — Comprehensive test exercising ALL report panels
 *
 * Combines in a SINGLE test:
 *   - Groups          (5 groups with checks → Groups Analysis panel)
 *   - Custom Metrics  (2 Counters, 2 Trends, Rate, Gauge → Custom Metrics panel)
 *   - Web Vitals      (LCP, FCP, CLS, TTFB, INP → Web Vitals panel)
 *   - HTTP metrics    (req duration, error rate → KPIs, APDEX, Percentile chart)
 *   - SLA thresholds  (intentional mix of pass/fail → SLA panel, Anomaly alerts)
 *
 * Uses two k6 scenarios running in parallel:
 *   1. "api_flow"       — HTTP-based groups + custom metrics  (constant-vus)
 *   2. "browser_vitals" — Chromium browser collecting Web Vitals (constant-vus)
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=mixed/99-full-dashboard-demo --profile=smoke
 *
 * Expected panels populated:
 *   ✓ KPI strip (Checks, Avg, p95, p99, Error Rate, Throughput, APDEX, SLA)
 *   ✓ APDEX gauge
 *   ✓ SLA compliance table
 *   ✓ Percentile distribution chart
 *   ✓ Anomaly / Recommendation alerts
 *   ✓ Groups Analysis (5 groups with timing + checks)
 *   ✓ Custom Metrics (6 custom metrics: 2 counters, 2 trends, rate, gauge)
 *   ✓ Web Vitals (LCP, FCP, CLS, TTFB, INP)
 *   ✓ Historical Comparison (on re-runs)
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { browser } from "k6/browser";
import { Counter, Trend, Rate, Gauge } from "k6/metrics";
import { Options } from "k6/options";

// ── Custom Metrics (module-level init) ──────────────────────────────────────

const businessTransactions = new Counter("business_transactions");
const errorCount = new Counter("business_errors");
const apiLatency = new Trend("api_latency_ms");
const payloadSize = new Trend("response_payload_bytes");
const successRate = new Rate("business_success_rate");
const activeUsers = new Gauge("active_users_gauge");

// ── Options ─────────────────────────────────────────────────────────────────

export const options: Options = {
  scenarios: {
    api_flow: {
      executor: "constant-vus",
      exec: "apiFlow",
      vus: 2,
      duration: "30s",
    },
    browser_vitals: {
      executor: "constant-vus",
      exec: "browserVitals",
      vus: 1,
      duration: "40s",
      startTime: "5s", // slight delay to let API warm up
      options: {
        browser: {
          type: "chromium",
        },
      },
    },
  },
  thresholds: {
    // HTTP thresholds
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.10"],

    // Group thresholds (framework injects remaining groups automatically)
    "group_duration{group:::Checkout}": ["p(95)<3000"],

    // Custom metric thresholds
    business_success_rate: ["rate>0.50"],
    api_latency_ms: ["p(95)<2500"],

    // Web Vitals thresholds
    browser_web_vital_lcp: ["p(90)<2500"],
    browser_web_vital_fcp: ["p(90)<1800"],
    browser_web_vital_cls: ["p(90)<0.1"],
    browser_web_vital_ttfb: ["p(90)<800"],
    browser_web_vital_inp: ["p(90)<200"],
  },
};

// ── Constants ───────────────────────────────────────────────────────────────

const API_BASE = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";
const SITE_URL = "https://test.k6.io";

// ── Scenario 1: API Flow with Groups + Custom Metrics ───────────────────────

export function apiFlow(): void {
  activeUsers.add(__VU);

  let productId: string | null = null;
  let cartId: string | null = null;

  // ── Group 1: Browse Catalog ──
  group("Browse Catalog", () => {
    const res = http.get(`${API_BASE}/get?page=home&category=all`);
    const ok = check(res, {
      "browse: status 200": (r) => r.status === 200,
      "browse: has body": (r) => (r.body as string).length > 0,
    });

    apiLatency.add(res.timings.duration);
    payloadSize.add((res.body as string).length);
    businessTransactions.add(1);
    if (!ok) errorCount.add(1);
    successRate.add(ok ? 1 : 0);
    sleep(0.3);
  });

  // ── Group 2: Search Products ──
  group("Search Products", () => {
    const query = ["shoes", "jacket", "watch", "bag"][Math.floor(Math.random() * 4)];
    const res = http.get(`${API_BASE}/get?q=${query}&sort=relevance`);
    const ok = check(res, {
      "search: status 200": (r) => r.status === 200,
      "search: has results": (r) => {
        try {
          return "args" in (JSON.parse(r.body as string) as Record<string, unknown>);
        } catch {
          return false;
        }
      },
    });

    productId = `PROD-${__VU}-${__ITER}-${Date.now()}`;
    apiLatency.add(res.timings.duration);
    payloadSize.add((res.body as string).length);
    businessTransactions.add(1);
    if (!ok) errorCount.add(1);
    successRate.add(ok ? 1 : 0);
    sleep(0.2);
  });

  // ── Group 3: View Product Detail ──
  group("View Product", () => {
    const res = http.get(`${API_BASE}/anything/products/${productId}`);
    const ok = check(res, {
      "product: status 200": (r) => r.status === 200,
      "product: body valid": (r) => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          return typeof body.url === "string";
        } catch {
          return false;
        }
      },
    });

    apiLatency.add(res.timings.duration);
    payloadSize.add((res.body as string).length);
    businessTransactions.add(1);
    if (!ok) errorCount.add(1);
    successRate.add(ok ? 1 : 0);
    sleep(0.5);
  });

  // ── Group 4: Add to Cart ──
  group("Add to Cart", () => {
    const payload = JSON.stringify({
      productId,
      quantity: Math.floor(Math.random() * 3) + 1,
      userId: `user-${__VU}`,
    });
    const res = http.post(`${API_BASE}/post`, payload, {
      headers: { "Content-Type": "application/json" },
    });
    const ok = check(res, {
      "cart: status 200": (r) => r.status === 200,
      "cart: echoed json": (r) => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          return body.json !== undefined;
        } catch {
          return false;
        }
      },
    });

    cartId = `CART-${__VU}-${__ITER}`;
    apiLatency.add(res.timings.duration);
    payloadSize.add((res.body as string).length);
    businessTransactions.add(1);
    if (!ok) errorCount.add(1);
    successRate.add(ok ? 1 : 0);
    sleep(0.2);
  });

  // ── Group 5: Checkout ──
  group("Checkout", () => {
    const order = JSON.stringify({
      cartId,
      payment: { method: "card", last4: "4242", cvv: "***" },
      shipping: { address: "123 Test St", city: "LoadCity", zip: "90210" },
      total: (Math.random() * 200 + 10).toFixed(2),
    });
    const res = http.post(`${API_BASE}/post`, order, {
      headers: { "Content-Type": "application/json" },
    });
    const ok = check(res, {
      "checkout: status 200": (r) => r.status === 200,
      "checkout: order confirmed": (r) => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          return body.json !== undefined;
        } catch {
          return false;
        }
      },
    });

    apiLatency.add(res.timings.duration);
    payloadSize.add((res.body as string).length);
    businessTransactions.add(1);
    if (!ok) errorCount.add(1);
    successRate.add(ok ? 1 : 0);
    sleep(0.3);
  });
}

// ── Scenario 2: Browser Web Vitals ──────────────────────────────────────────

export async function browserVitals(): Promise<void> {
  const page = await browser.newPage();

  try {
    // Page 1: Landing
    await page.goto(`${SITE_URL}/`, { waitUntil: "networkidle" });
    check(page, {
      "vitals: landing loaded": (p) => p.url().includes("test.k6.io"),
    });
    sleep(3);

    // Page 2: Contacts
    await page.goto(`${SITE_URL}/contacts.php`, { waitUntil: "networkidle" });
    check(page, {
      "vitals: contacts loaded": (p) => p.url().includes("contacts"),
    });
    sleep(3);

    // Page 3: News — trigger interactions for INP
    await page.goto(`${SITE_URL}/news.php`, { waitUntil: "networkidle" });
    check(page, {
      "vitals: news loaded": (p) => p.url().includes("news"),
    });

    // Click around to generate INP data
    const links = await page.$$("a");
    if (links.length > 0) {
      await links[0].click();
      sleep(1);
    }

    sleep(2);
  } finally {
    await page.close();
  }
}
