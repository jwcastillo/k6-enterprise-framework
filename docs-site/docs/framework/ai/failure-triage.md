---
title: "Failure Triage"
sidebar_position: 4
---
# Failure Triage

A failed run tells you *that* requests failed. This tells you **whose fault it is**: the
system under test, the test itself, or the environment around it. Until you know that, a
red run is not a finding — a WAF blocking the generator and a saturated service look the
same in the summary.

`bin/triage-failures.js` reads the `k6-execution-*.log` of a run, groups its error and
warning lines into redacted signatures, and asks [TypeSafe](https://typesafe.ai)
(System One) for the most likely cause of each one in a single batched request.

This is not the [Analyst Agent](./agents.md): that one correlates `summary.json` with
Prometheus, Loki and Tempo to explain *why* the system behaved as it did. Triage works on
the generator's own log, needs no observability stack, and answers a narrower question.

## Enabling it

Opt-in twice over — it is off unless both are set:

```bash
export TYPESAFE_API_KEY=...   # no key, no call
K6_TRIAGE=true ./bin/run-test.sh --client=my-team --scenario=api/checkout --profile=load
```

The result is printed and written to `triage-<timestamp>.txt` next to the other artifacts.
Triage never changes the exit code — gating stays with `bin/slo-report.js`.

Run it on its own against any execution log:

```bash
TYPESAFE_API_KEY=... node bin/triage-failures.js reports/my-team/api_checkout/k6-execution-20260921-120000.log
```

## Causes and owners

The model picks the cause; **the owner is policy kept in code**, not something the model
decides:

| Cause | Owner | Typical signature |
| --- | --- | --- |
| `waf_block` | environment | edge 403, HTML "Access Denied" |
| `network` | environment | DNS failure, connection refused/reset, TLS error |
| `auth` | test | 401, expired or missing token |
| `test_data` | test | 400/404/422 tied to a specific record or payload |
| `script_bug` | test | exception in the scenario itself |
| `saturation` | sut | timeouts, 429, 502/503/504, stream resets |
| `server_error` | sut | 5xx or stack trace that is not a capacity problem |
| `other` | unknown | nothing fits, or the line is not a failure |

Answers below `confidence >= 0.5` are parked under `unknown` and marked `(review)` rather
than counted. When more than half the failures land on *test* or *environment*, the report
says so plainly: fix those before trusting the numbers.

## What leaves the machine

Only redacted signatures, never the raw log. Before the request is built, `normalize()`
replaces JWTs, URLs, hostnames, IPs, emails, timestamps, query strings and mixed
alphanumeric ids, collapses the variable parts so identical failures group together, and
truncates each message to 400 characters. At most 25 signatures are sent, in one request.

Add client or service names with `TRIAGE_REDACT=acme,acme-orders` — literal terms, applied
after the pattern rules.

## Knobs

| Variable | Default | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | — | Required. Without it the script exits without calling anything. |
| `TYPESAFE_MODEL` | `jev-latest` | Model id. |
| `TRIAGE_REDACT` | — | Extra literal terms to hide, comma separated. |
| `K6_TRIAGE` | `false` | Whether `run-test.sh` runs triage after a test. |

The parsing, redaction and owner policy are covered offline, with no network:

```bash
npx vitest run test/bin/triage-failures.test.ts
```
