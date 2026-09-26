---
name: har-to-k6
description: Handle HAR files end-to-end for this framework — capture (browser devtools, Playwright recordHar, Grafana k6 Studio recorder), sanitizing cookies, tokens and PII before sharing, storing outside git, converting with k6 Studio's generator and autocorrelation or the har-to-k6 converter (pinned 0.14.16), and mapping the result into framework conventions instead of keeping the raw generated script. Use when asked to "convert this HAR to a k6 test", "sanitize this HAR before sending it", "record the flow in k6 Studio", or "turn the generated script into a proper scenario". Not for autonomous discovery (flow-discovery).
---

# HAR to k6

`<repo>` means the repository root.

## Capture options

| Option | When |
|--------|------|
| Browser devtools, Network tab, "Save all as HAR" | Quick one-off, human-driven. |
| Playwright `recordHar` (playwright-automation) | Repeatable capture with host filters. |
| Grafana k6 Studio recorder (desktop app) | Record + generate + autocorrelate in one tool. |
| discover-flow.js output (flow-discovery) | Autonomous exploration with safety stops. |

Store every HAR under `reports/` (gitignored) or outside the repo. Never commit one,
never attach one to a ticket or chat before sanitizing.

## Sanitize before sharing

A HAR holds cookies, `Authorization` headers, tokens in query strings and bodies,
and personal data in form posts and responses. Before any HAR leaves your machine:

1. Remove or mask `Cookie`, `Set-Cookie`, `Authorization`, API-key headers.
2. Mask tokens and ids in URLs and bodies (JWT, session ids, emails, phone numbers,
   national ids, card numbers).
3. Drop third-party entries (analytics, ads, payment processors).
4. Re-check with `<repo>/bin/detect-secrets.sh <dir containing the HAR>`.

Keep the unsanitized original local and delete it when the scenario is done.

## Convert

- Preferred: k6 Studio generator. Apply its autocorrelation rules, add verification
  rules for status codes, and review every extracted variable.
- CLI alternative: the `har-to-k6` converter at version 0.14.16, added as a pinned dev
  dependency only after the human approves the dependency change. Output goes to
  `reports/`, not to a scenarios directory.

## Map into the framework (do not keep the raw script)

The generated script is input, not a deliverable. Rewrite it with
k6-scenario-authoring:

| Generated script | Framework version |
|------------------|-------------------|
| One long default function | Steps as functions; journey in `flow/`, single endpoint in `api/`, service in `domain/` |
| Hard-coded host | `__ENV` / client config base URL |
| Recorded tokens and cookies | Auth in `setup()` via `@patterns/auth-pattern`; secrets from env |
| Copied response values | `extractFromResponse` + `interpolate` (`@patterns/correlation-pattern`) |
| Literal user data | Data file + `SharedArray` / `DataPool` (test-data-management) |
| Every static asset request | Drop static assets unless the test plan includes them |
| No thresholds | Thresholds from the test plan SLO |
| Raw URLs as metric names | Stable `name` tags |

Then run the generation gate (guardrails-gate) and a smoke run (run-operations).
