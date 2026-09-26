---
title: "Flow Discovery"
sidebar_position: 5
---
# Flow Discovery

Writing a k6 script for a web flow starts with knowing which requests the flow makes, in
which order, and which values the server hands out that the next request must send back.
`bin/discover-flow.js` finds that out for you: it drives a real browser (Playwright) toward
a goal written in plain language, lets an AI decider choose each step, records a HAR, and
writes a plan for the k6 script — endpoint sequence and **correlation candidates**.

It is a Node tool that runs before you write the test, never inside the k6 runtime.

## Quick start

```bash
pnpm exec playwright install chromium        # once
export ANTHROPIC_API_KEY=...                 # or TYPESAFE_API_KEY with --decider=jev

node bin/discover-flow.js \
  --url=https://staging.example.com \
  --goal="search for a product and open its detail page" \
  --data=data/discovery.json \
  --stop-at=/checkout \
  --out=reports/discovery/product-detail
```

`data/discovery.json` holds the **named** test values the agent may type:

```json
{ "query": "blue shirt", "email": "qa.user@example.com" }
```

The agent only ever types a value from this file, or clearly synthetic filler it declares
as `synthetic:<description>` (e.g. `synthetic:city name` becomes `test`). The model sees the
keys (`query`, `email`), never the values.

## How a step works

1. **Observe** — URL, title and up to 120 visible interactive elements (role, accessible
   name, index; form values masked as `{{key}}` or `<n chars>`). Iframes and shadow roots
   are not entered, but their count is reported so the decider knows content is missing.
2. **Filter** — elements matching `--deny-text` are removed before the decider sees them.
3. **Redact** — `--data` values become `{{key}}`; emails, JWTs, opaque tokens and runs of
   4+ digits are replaced. Cookies and headers are never part of the observation.
4. **Decide** — the decider answers `click | fill | select | check | navigate_done | stop`,
   a candidate index, a value key and a rationale.
5. **Guard** — invalid index, unknown value key or confidence below `--min-confidence`
   stops the run for a human. Password fields are only filled from the `password` key.
6. **Act and settle** — via `getByRole(role, { name })` (falling back to a marker attribute),
   then wait until no request has been in flight for 500 ms.
7. **Record** — action, locator, value key, URL before/after, duration and request count,
   with a log line per step.

The run ends when the decider reports the goal reached, a `--stop-at` URL is reached (it is
recorded and nothing on it is touched), or a guardrail trips.

## Deciders

Both get the **same** redacted observation.

| Decider | Env | How it decides |
| --- | --- | --- |
| `claude` (default) | `ANTHROPIC_API_KEY`, `DISCOVERY_MODEL` (default `claude-sonnet-5`) | One Messages API call per step with a JSON-schema output (action, index, value key, rationale, confidence). |
| `jev` | `TYPESAFE_API_KEY`, `TYPESAFE_MODEL` (default `jev-latest`) | One TypeSafe System One request per step with three `choice` questions: status (continue / goal reached / stop), target element (criteria = candidate descriptions) and value key. The action follows from the element's role; confidence is the lowest of the answers used. |

Tests inject a scripted decider instead; no key is needed to run them.

## Options

| Flag | Default | Purpose |
| --- | --- | --- |
| `--url` | — | Start URL. Its host is always allowed. |
| `--goal` | — | What the flow should accomplish. |
| `--decider` | `claude` | `claude` or `jev`. |
| `--data` | — | JSON object of named test values. |
| `--max-steps` | `30` | Maximum actions. |
| `--allow-hosts` | — | Extra hosts main-frame navigation may reach; anything else is aborted and stops the run. |
| `--block-hosts` | — | Hosts (`*.x.com` wildcards) whose requests are aborted, for every page of the context. |
| `--stop-at` | — | Repeatable regex; when the URL matches, record and stop. |
| `--deny-text` | pay, buy, purchase, checkout, confirm/place order, delete, … | Elements whose name or text matches are never offered. |
| `--min-confidence` | `0.5` | Below this the run stops for a human. |
| `--max-tokens` | `200000` | Decider token budget (Jev: estimated from request size). |
| `--user-agent`, `--storage-state` | — | Browser identity / logged-in session. |
| `--no-headless` | headless | Show the browser. |
| `--out` | `reports/discovery/<datetime>` | Output directory. |
| `--dry-run` | off | Load the page and plan without clicking or typing. |
| `--trace` | off | Also write a Playwright `trace.zip`. |
| `--k6` | off | Run `har-to-k6` if it is installed (it is not a dependency). |

## Outputs

| File | Content |
| --- | --- |
| `flow.har` | Raw traffic with bodies embedded (what k6 Studio and `har-to-k6` consume). **Sensitive.** |
| `flow.json` | Goal, decider, steps, stop reason, hosts seen, first-party endpoints (method + path template), correlations and a `guardrails` block. Validated against [`shared/schemas/discovery-flow.schema.json`](https://github.com/jwcastillo/k6-enterprise-framework/blob/main/shared/schemas/discovery-flow.schema.json) before it is written. |
| `flow.md` | Human summary of the run. |
| `flow-plan.md` | Endpoint sequence, correlation candidates with the k6 extraction (`res.json("session.token")`), next steps. |

Before writing, `flow.json`, `flow.md` and `flow-plan.md` pass a fail-closed check: no JWTs,
cookies, `Authorization` values, emails or runs of 7+ digits. A hit aborts without writing
them. All files are created `0600`.

### Correlation candidates

Deterministic, no AI: a value (JSON leaf or hidden form input, 6+ characters) that **first
appears in a response** and is later sent in a request URL, body or header is a correlation
candidate. Values the client sent first (typed input) and cookies (k6's cookie jar handles
them) are excluded. Only the source, the selector, the targets and the value length are
reported — never the value.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Goal reached, `--stop-at` reached, or dry run complete. |
| `3` | Stopped by a guardrail: left the allowlist, budget, low confidence, loop, max steps, decider stop, invalid decision. |
| `1` | Error (bad input, missing dependency or key, schema or PII check failure). |

## From HAR to k6

1. Read `flow-plan.md`.
2. **Grafana k6 Studio:** File → Import HAR (`flow.har`) → Generator → enable
   Autocorrelation, and compare its rules with the correlation table.
3. Or `--k6` / `npx har-to-k6 flow.har -o flow-k6.js`, then replace recorded tokens with the
   extractions from the plan and move typed values to a data file.

## In a standalone client repo

Export with the tool:

```bash
./bin/export-client.sh --client=my-team --output=../my-team-k6 --with-discovery
```

Then, in the exported repo:

```bash
npm i -D playwright @anthropic-ai/sdk && npx playwright install chromium
ANTHROPIC_API_KEY=... node framework/bin/discover-flow.js --url=... --goal="..." --stop-at=/checkout
```

`ajv` and `ajv-formats` are already dev dependencies of exported repos.

## Limitations

- One tab: popups and new windows are not followed.
- Iframes and shadow DOM are reported but not entered.
- Accessible names are approximated; when `getByRole` does not resolve to the observed
  element, a marker attribute is used and the step says so.
- A dry run cannot see the effect of its own actions, so it plans from the start page only.
- Jev token usage is estimated (TypeSafe does not report it).

The pure parts (filtering, redaction, correlation, decider mapping) and an end-to-end run
against a local fixture site with a scripted decider are covered offline:

```bash
npx vitest run test/bin/discover-flow.test.ts test/bin/discover-flow.e2e.test.ts
```
