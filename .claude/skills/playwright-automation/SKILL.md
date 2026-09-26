---
name: playwright-automation
description: Use Playwright (pinned 1.63.0) in this framework for flow capture and discovery support (not load) — codegen, role/name locators, saved auth state, recordHar content modes and PII, tracing, network routing and host blocking, headless/CI runs, reliable waits, and when to use Playwright Test Agents (planner / generator / healer) or the Playwright MCP server instead of discover-flow.js. Use when asked to "record this flow with Playwright", "capture a HAR of <journey> with Playwright", "write a Playwright script to log in and save the session", "block third-party hosts while capturing", or "why is my Playwright capture flaky". Not for browser load tests (k6-browser) or HAR conversion (har-to-k6).
---

# Playwright automation (capture, not load)

Playwright is an optional dependency of this repo (`playwright` ^1.63.0). Use the
pinned CLI: `npx playwright@1.63.0 <command>`. Browsers install with
`npx playwright@1.63.0 install chromium` (ask before installing on a shared machine).
Playwright never generates load: one browser, one user, for capture and discovery.

## Which tool

| Goal | Tool |
|------|------|
| Autonomous exploration of a flow with safety stops, output ready for planning | discover-flow.js (flow-discovery) |
| Human clicks the flow once, you want a script | `npx playwright@1.63.0 codegen <url>` |
| Repeatable capture script (HAR + trace) | Playwright script, this skill |
| Agent-driven browsing inside Claude Code | Playwright MCP server (`@playwright/mcp@0.0.82`), scoped to allowed hosts |
| Maintaining functional Playwright tests | Playwright Test Agents: `npx playwright@1.63.0 init-agents --loop=claude` (planner, generator, healer; v1.56+). Review generated agent files before committing. |

## Capture script essentials

```typescript
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  recordHar: { path: HAR_PATH, content: "omit", mode: "full", urlFilter: ALLOWED_HOSTS_REGEX },
  storageState: AUTH_STATE_PATH, // optional, from a prior login run
});
await context.route(BLOCKED_HOSTS_REGEX, (route) => route.abort());
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
await page.goto(START_URL);
await page.getByRole("button", { name: "Continue" }).click();
await page.waitForResponse((r) => r.url().includes("/api/cart") && r.ok());
await context.tracing.stop({ path: TRACE_PATH });
await context.close(); // flushes the HAR
await browser.close();
```

Paths (HAR, trace, auth state) point under `reports/` (gitignored), never a tracked
directory.

## HAR content modes

| `content` | Bodies | Use |
|-----------|--------|-----|
| `omit` | none | Default for sharing; enough for endpoints and headers. |
| `attach` | separate files | Correlation work needs response bodies; keep local. |
| `embed` | inline | Single-file convenience; largest PII exposure. |

Every HAR contains cookies and auth headers regardless of mode. Sanitize before
sharing (har-to-k6).

## Auth state

Log in once, save with `context.storageState({ path: AUTH_STATE_PATH })`, reuse with
`storageState`. The file is a live session: treat as a secret, keep under `reports/`,
delete when done, never commit.

## Network scoping

- `context.route(pattern, route => route.abort())` blocks analytics, payments and
  third parties.
- Chromium-level hard block: launch arg
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE <allowed-host>` so only allowed hosts
  resolve.

## Reliable waits

- Prefer role/label/text locators (`getByRole`, `getByLabel`, `getByText`) over CSS/XPath.
- Rely on auto-waiting actions; wait on a specific response or a visible element.
- Avoid fixed sleeps (`waitForTimeout`) and `networkidle` on apps with polling.
- Flaky step: record a trace and open it with `npx playwright@1.63.0 show-trace <trace>`.

## CI

Headless by default; install only the browser you need; set a timeout per step;
upload traces only as private build artifacts.
