---
name: test-data-management
description: Prepare and use test data for this framework's k6 scenarios — client data directories, SharedArray and DataPool loading, per-VU and cross-instance uniqueness (scenario.iterationInTest, instance slicing), synthetic generation with generate-data.js, Redis-backed pools with load-redis-data.js, and PII rules (synthetic only, never committed, sanitized before sharing). Use when asked to "generate 10k test users", "make each VU use a unique account", "load this CSV into the scenario", "share data across pods", or "is this data file safe to commit". Not for HAR sanitizing details (har-to-k6).
---

# Test data management

`<repo>` means the repository root.

## Where data lives

- Monorepo: `clients/<client>/data`. Client directories are gitignored except the
  public reference clients; keep it that way.
- Standalone export: `data` at the repo root. Check its `.gitignore` before adding
  anything sensitive.
- Never commit real customer data, production exports, credentials, session cookies
  or captured HARs. Generated synthetic data may be committed only if small and useful.

## Loading in k6 (init context only)

```typescript
import { SharedArray } from "k6/data";
import exec from "k6/execution";
// USERS_FILE: path to users.json relative to the built bundle
const users = new SharedArray("users", () => JSON.parse(open(USERS_FILE)));
const user = users[exec.scenario.iterationInTest % users.length];
```

- `SharedArray` keeps one read-only copy for all VUs: use it for anything larger than a
  few KB.
- `DataPool` / `createPool` / `createCsvPool` from `@helpers/data-pool` add exhaustion
  policies (`recycle`, `generate`, `stop`) and per-VU allocation.
- Never call `open()` in the default function or in `setup()` loops.

## Uniqueness

| Scope | Technique |
|-------|-----------|
| Per VU | `DataPool` per-VU allocation, or index by the VU id in test (exec, vu, idInTest). |
| Per iteration, one instance | `exec.scenario.iterationInTest` from `k6/execution`. |
| Across distributed instances | `iterationInTest` is unique test-wide under k6-operator execution segments; alternatively slice the file per instance (offset from the instance execution info in k6/execution) or pre-split files per pod. |
| Consumable records (one-time tokens, accounts) | Redis pool: load with `node <repo>/bin/load-redis-data.js --file=<json> --prefix=<p>: --clear`, pop per iteration via `@helpers/redis-helper` / `@patterns/redis-patterns` (needs the Redis extension, see run-operations `--extensions`). |

When records run out, fail loudly (`stop` policy) rather than silently reusing data
that makes the backend cache everything.

## Synthetic generation

```bash
node <repo>/bin/generate-data.js --type=users|products|transactions --count=<n> \
  --format=csv|json --output=<client data dir>
```

In-script generation: `DataHelper` from `@helpers/data-helper` (random users, emails on a
reserved test domain, prices, UUIDs). Use reserved domains (example.com, the test TLD) and
documentation IP ranges only.

## PII rules

- Synthetic by default. Real identifiers only if the human provides them for a test
  environment and confirms they may be used.
- Data with secrets for cluster runs goes through a Kubernetes Secret or a short-lived
  URL (see k6-distributed-runs), never a ConfigMap or the image.
- Before sharing any data sample in chat, a report or a ticket, mask identifiers.
- Run `<repo>/bin/detect-secrets.sh <data dir>` before committing anything in a data
  directory.
