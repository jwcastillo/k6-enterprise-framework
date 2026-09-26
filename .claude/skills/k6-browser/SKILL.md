---
name: k6-browser
description: Write and run k6 browser-module scenarios in this framework — async API differences from Playwright, locators, contexts with custom user agent, K6_BROWSER_HEADLESS / K6_BROWSER_ARGS, Web Vitals metrics and per-stage tagging, iframes, screenshots, per-VU resource cost, the -with-browser image for k6-operator, and the probe pattern (a few browser VUs measuring what users see while protocol-level load runs). Use when asked to "add a browser probe to the load test", "measure LCP/INP during the stress run", "write a k6 browser scenario for <page>", or "why does my k6 browser test fail on the cluster". Not for Playwright capture scripts (playwright-automation).
---

# k6 browser

`<repo>` means the repository root. Framework helper: `@helpers/browser-helper`
(`BrowserHelper`, k6 v1.2.1+ APIs). Examples:
`<repo>/clients/examples/scenarios/browser/web-vitals-demo.ts` and
`<repo>/clients/examples/scenarios/mixed/99-full-dashboard-demo.ts`.

## Differences from Playwright

| Topic | k6 browser |
|-------|------------|
| API | Async: `await page.goto()`, `await locator.click()`. The default function must be `async`. |
| `group()` | Does not support async callbacks. Tag instead (see below). |
| Locators | `page.locator()`; `getByRole` / `getByLabel` / `getByText` on k6 v1.2.1+; `frameLocator` on v1.6.0+. |
| Contexts | `await browser.newContext({ userAgent: "<ua>" })`, then `context.newPage()`. |
| Cleanup | Always `await page.close()` in `finally`. |
| Scenario | Needs `options.scenarios.<name>.options.browser.type = "chromium"`. |

```typescript
import { browser } from "k6/browser";
export const options = {
  scenarios: {
    probe: { executor: "constant-vus", vus: 1, duration: "10m",
             options: { browser: { type: "chromium" } } },
  },
  thresholds: { browser_web_vital_lcp: ["p(75)<2500"], browser_web_vital_inp: ["p(75)<200"] },
};
export default async function () {
  const page = await browser.newPage();
  try {
    await page.goto(__ENV.BASE_URL);
    await page.getByRole("link", { name: "Products" }).click();
  } finally {
    await page.close();
  }
}
```

## Environment

- `K6_BROWSER_HEADLESS=false` only for local debugging.
- `K6_BROWSER_ARGS` passes Chromium flags, e.g.
  `host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE <allowed-host>` to keep the probe inside
  scope. Do not add `no-sandbox` unless the human accepts the risk for that container.

## Web Vitals

Metrics: `browser_web_vital_lcp`, `browser_web_vital_fcp`, `browser_web_vital_cls`,
`browser_web_vital_inp`, `browser_web_vital_ttfb`. To split by load stage, set a VU
metric tag before each step, e.g. `exec.vu.metrics.tags.stage = "peak";` from
`k6/execution`, and threshold on the tagged series. Grafana dashboard: web vitals
(observability-setup).

## Iframes and screenshots

- Iframes: `page.frameLocator(selector)` (v1.6.0+) or the element handle's content
  frame.
- Screenshots: `await page.screenshot({ path })` writes where k6 runs; on k6-operator
  pods the file is lost unless persistence is mounted. Screenshots can contain PII.

## Cost and the probe pattern

- One browser VU costs roughly a CPU core and hundreds of MB of memory. Measure in smoke
  before sizing. Never scale load with browser VUs.
- Probe pattern: one scenario with protocol-level VUs for load plus a separate scenario
  with 1-3 browser VUs that measures user-visible experience throughout the test.
- On k6-operator use an image tag ending in `-with-browser` and raise
  runner resources (k6-distributed-runs).
