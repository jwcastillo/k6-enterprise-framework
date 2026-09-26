# k6 patterns and templates

Synthesized k6 reference: project structure, executors, the 5-block pattern, common mistakes, multi-environment configs. Use when generating, fixing, or reviewing k6 scripts.

> Sources synthesized: rcampos09/k6-best-practices, khanntm k6-patterns, KimDoubleB grafana-k6-skills (api/browser/openapi/code), pabblaz k6 project structure, charlyautomatiza k6 plan-build-validate lifecycle.

---

## Project structure (for repos beyond a single script)

When the user is starting a k6 project or has more than 2-3 scripts, recommend this layout:

```
perf-tests/
├── tests/                    # k6 test scripts (one per scenario or journey)
│   ├── smoke.js
│   ├── load.js
│   ├── stress.js
│   └── soak.js
├── config/                   # JSON configs per environment
│   ├── dev.json
│   ├── staging.json
│   └── prod.json
├── adapters/                 # External integrations (auth providers, data fetchers)
│   ├── auth.js
│   └── token-generator.js
├── resources/                # Test data (CSVs, JSONs) — never hardcode
│   ├── users.csv
│   └── products.json
├── utils/                    # Helpers: setup, custom metrics, assertions
│   ├── checks.js
│   └── thresholds.js
├── global/                   # Cross-product shared logic
│   └── correlation-ids.js
└── run-k6.sh                 # Wrapper script for consistent execution
```

**Key rules:**
- No hardcoded URLs, credentials, or thresholds — all in `config/`.
- Reusable cross-product logic goes in `global/`.
- Each major directory should have a `README.md`.

---

## The 5-block pattern (every script follows this)

Every k6 script must have these five blocks in order. Generate the skeleton first, then fill in.

```
Block 1 → options       scenarios + thresholds (executor, VUs, duration, SLA gates)
Block 2 → data          SharedArray for parameterized inputs — loaded once, shared across VUs
Block 3 → setup()       one-time auth or preparation — runs once before VUs start
Block 4 → default()     the VU workload: requests, checks, groups, sleep
Block 5 → teardown()    cleanup (optional — required for gRPC/WS connection close)
```

---

## Executors — pick the right one

| Executor | Workload model | When to use |
|----------|---------------|-------------|
| `constant-vus` | Closed (fixed VUs) | Simple smoke or quick benchmark |
| `ramping-vus` | Closed (varying VUs) | Validate behavior across user counts |
| `constant-arrival-rate` | **Open (fixed RPS)** | **Load tests — coordinated-omission-aware** |
| `ramping-arrival-rate` | Open (varying RPS) | Stress, spike, soak with realistic traffic shapes |
| `per-vu-iterations` | Closed | Each VU runs N times, then exits |
| `shared-iterations` | Closed | Total iterations split across VUs |

**Default for production-realistic tests: `constant-arrival-rate` or `ramping-arrival-rate`.** Open-model executors decouple request submission from response time and avoid coordinated omission.

```javascript
export const options = {
  scenarios: {
    load: {
      executor: 'constant-arrival-rate',
      rate: 200,                  // 200 RPS sustained
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    'http_req_duration{expected_response:true}': [
      'p(95)<300',
      'p(99)<500',
      'p(99.9)<1500',
    ],
    'http_req_failed': ['rate<0.001'],
  },
};
```

---

## Test type templates

### Smoke (sanity check, ~1 min)
```javascript
export const options = {
  vus: 1,
  duration: '1m',
  thresholds: { http_req_failed: ['rate<0.01'] },
};
```

### Load (validate expected peak)
```javascript
scenarios: {
  load: {
    executor: 'constant-arrival-rate',
    rate: 100, timeUnit: '1s', duration: '15m',
    preAllocatedVUs: 30, maxVUs: 150,
  },
}
```

### Stress (find breaking point)
```javascript
scenarios: {
  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 50, timeUnit: '1s',
    stages: [
      { target: 100, duration: '5m' },
      { target: 200, duration: '5m' },
      { target: 400, duration: '5m' },
      { target: 600, duration: '5m' },
    ],
    preAllocatedVUs: 100, maxVUs: 600,
  },
}
```

### Spike (sudden burst)
```javascript
scenarios: {
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 10, timeUnit: '1s',
    stages: [
      { target: 10,   duration: '30s' },  // baseline
      { target: 1000, duration: '10s' },  // spike
      { target: 1000, duration: '1m' },   // hold
      { target: 10,   duration: '30s' },  // recover
    ],
    preAllocatedVUs: 100, maxVUs: 1500,
  },
}
```

### Soak (memory leaks, degradation — 4-12h)
```javascript
scenarios: {
  soak: {
    executor: 'constant-arrival-rate',
    rate: 50, timeUnit: '1s', duration: '8h',
    preAllocatedVUs: 30, maxVUs: 100,
  },
}
```

### Breakpoint (gradually increase until failure)
```javascript
scenarios: {
  breakpoint: {
    executor: 'ramping-arrival-rate',
    startRate: 1, timeUnit: '1s',
    stages: [{ target: 5000, duration: '30m' }],
    preAllocatedVUs: 50, maxVUs: 5000,
  },
}
```

---

## Common mistakes — check every script for these

### 1. No `sleep()` between requests — generates unrealistic load

```javascript
// Wrong — zero think time, hammers the server
export default function() {
  http.get(`${BASE_URL}/api/products`);
  http.get(`${BASE_URL}/api/cart`);
}

// Correct — realistic think time
import { sleep } from 'k6';
export default function() {
  http.get(`${BASE_URL}/api/products`);
  sleep(Math.random() * 2 + 1);  // 1-3s
  http.get(`${BASE_URL}/api/cart`);
  sleep(1);
}
```

### 2. `check()` as a test gate — it never fails the test

`check()` records pass/fail stats but **never stops or fails the test**. Use `thresholds` to actually fail.

```javascript
// Wrong — test always exits 0 even if every request returns 500
check(res, { 'status is 200': (r) => r.status === 200 });

// Correct — threshold fails the run
export const options = {
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'checks{check_name:status_200}': ['rate>0.99'],
  },
};
check(res, { 'status_200': (r) => r.status === 200 });
```

### 3. `open()` in VU context — runtime error

```javascript
// Wrong — `can't call open() in the VU context`
export default function() {
  const data = JSON.parse(open('./data.json'));
}

// Correct — open in init context, share across VUs
import { SharedArray } from 'k6/data';
const users = new SharedArray('users', () => JSON.parse(open('./data.json')));
export default function() {
  const u = users[Math.floor(Math.random() * users.length)];
}
```

### 4. Loading parameterized data without SharedArray — OOM

```javascript
// Wrong — data copied per VU; with 1000 VUs, 1000 copies → OOM
const users = JSON.parse(open('./users.json'));

// Correct — single copy shared across VUs
import { SharedArray } from 'k6/data';
const users = new SharedArray('users', () => JSON.parse(open('./users.json')));
```

### 5. Hardcoded base URL / credentials

```javascript
// Wrong
const BASE_URL = 'https://api.staging.example.com';

// Correct — environment variables and config files
const BASE_URL = __ENV.BASE_URL;       // pass with -e BASE_URL=...
const TOKEN = __ENV.AUTH_TOKEN;
```

### 6. Using mean for SLA validation

```javascript
// Wrong — mean hides tail latency
'http_req_duration': ['avg<300']

// Correct — percentiles
'http_req_duration': ['p(95)<300', 'p(99)<500']
```

---

## Thresholds and SLOs in k6

Thresholds are the contract. They turn a load test into a CI/CD gate.

```javascript
thresholds: {
  // Latency per endpoint, by tag
  'http_req_duration{name:checkout}': ['p(95)<400', 'p(99)<800'],
  'http_req_duration{name:login}': ['p(95)<200'],

  // Global error rate
  'http_req_failed': ['rate<0.001'],

  // Custom check rates
  'checks{type:auth}': ['rate>0.99'],

  // Custom metrics
  'business_transaction_duration': ['p(95)<1000'],
}
```

To tag requests:
```javascript
http.get(`${BASE_URL}/checkout`, { tags: { name: 'checkout' } });
```

---

## Environment-aware configuration

`config/staging.json`:
```json
{
  "BASE_URL": "https://api.staging.example.com",
  "RATE": 100,
  "DURATION": "10m",
  "THRESHOLDS": {
    "p95": 400,
    "p99": 800,
    "error_rate": 0.005
  }
}
```

In the script:
```javascript
const env = JSON.parse(open(`./config/${__ENV.ENV || 'staging'}.json`));
export const options = {
  scenarios: {
    load: {
      executor: 'constant-arrival-rate',
      rate: env.RATE, timeUnit: '1s', duration: env.DURATION,
      preAllocatedVUs: 30, maxVUs: env.RATE * 2,
    },
  },
  thresholds: {
    'http_req_duration': [`p(95)<${env.THRESHOLDS.p95}`],
    'http_req_failed': [`rate<${env.THRESHOLDS.error_rate}`],
  },
};
```

Run: `k6 run -e ENV=staging tests/load.js`

---

## Authentication patterns

### Token (Bearer)
```javascript
import http from 'k6/http';
let token;

export function setup() {
  const res = http.post(`${BASE_URL}/auth/login`, {
    username: __ENV.USER, password: __ENV.PASSWORD,
  });
  return { token: res.json('access_token') };
}

export default function(data) {
  http.get(`${BASE_URL}/api/me`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
}
```

### HMAC signature (per request)
```javascript
import crypto from 'k6/crypto';
function sign(method, path, body, secret) {
  const ts = Date.now();
  const payload = `${method}\n${path}\n${ts}\n${body}`;
  const sig = crypto.hmac('sha256', secret, payload, 'hex');
  return { 'X-Timestamp': ts, 'X-Signature': sig };
}
```

### API key (header)
```javascript
const headers = { 'X-API-Key': __ENV.API_KEY };
http.get(url, { headers });
```

---

## Beyond HTTP

### Browser tests (k6/browser, stable in v1.x)
For Core Web Vitals (LCP, INP, CLS) and end-to-end user journeys.

```javascript
import { browser } from 'k6/browser';
export const options = {
  scenarios: {
    ui: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
};
export default async function() {
  const page = await browser.newPage();
  await page.goto('https://example.com');
  await page.waitForLoadState('networkidle');
  // Capture Web Vitals via page.evaluate(() => performance.getEntriesByType(...))
  await page.close();
}
```

### gRPC
```javascript
import grpc from 'k6/net/grpc';
const client = new grpc.Client();
client.load(['./protos'], 'service.proto');

export default function() {
  client.connect('grpc.example.com:443', { plaintext: false });
  const res = client.invoke('package.Service/Method', { id: 123 });
  client.close();
}
```

### WebSocket (use `k6/websockets`, not legacy `k6/ws`)
```javascript
import { WebSocket } from 'k6/experimental/websockets';
export default function() {
  const ws = new WebSocket('wss://example.com');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'ping' }));
  ws.onmessage = (e) => { /* assert */ ws.close(); };
}
```

---

## Generating tests from OpenAPI / source code

When the user has an OpenAPI spec or existing route code:

1. **OpenAPI**: parse paths and methods → generate one scenario per critical endpoint with realistic params from `examples` field. Tag each request by `operationId`. Set per-endpoint thresholds based on operation criticality (read-heavy < write-heavy).
2. **From source code (Express, FastAPI, Spring routes)**: scan route definitions, infer params from handler signatures, generate one scenario per route. Stub auth via `setup()`.

For both: do not auto-include destructive operations (DELETE, drops) without explicit user confirmation.

---

## Reporting and result analysis

### Built-in
- `k6 run --summary-export=summary.json` — JSON summary
- `K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html k6 run …` — HTML report

### Stream to backends
- Prometheus remote write: `K6_PROMETHEUS_RW_SERVER_URL=…`
- Grafana Cloud k6: `k6 cloud script.js`
- InfluxDB: `K6_OUT=influxdb=http://...`

### Custom metrics for business KPIs
```javascript
import { Trend, Counter, Rate } from 'k6/metrics';
const checkoutDuration = new Trend('checkout_duration_ms', true);
const ordersCreated = new Counter('orders_created');
const conversionRate = new Rate('conversion_rate');

export default function() {
  const start = Date.now();
  const res = http.post(/* checkout */);
  checkoutDuration.add(Date.now() - start);
  if (res.status === 200) {
    ordersCreated.add(1);
    conversionRate.add(true);
  } else {
    conversionRate.add(false);
  }
}
```

---

## Plan → Build → Validate lifecycle

When generating a k6 artifact from scratch, follow this disciplined flow:

1. **Plan** — collect target endpoints, SLA, protocol, scenario type, environment. Don't generate without these.
2. **Build** — produce the runnable script following the 5-block pattern, plus a `config/<env>.json` and run command.
3. **Validate** — review against the common-mistakes checklist (sleep, check vs threshold, SharedArray, hardcoded values, percentiles not means). Run `k6 inspect` for syntax. If the user confirms a non-production target, run a 30s smoke and report results.

Never skip Plan when starting fresh. Never skip Validate before handing off to the user.

---

## Output format when generating a k6 artifact

When producing a script, always deliver three things:

1. **A complete, runnable script file** — never a partial snippet.
2. **The exact run command** with environment variables.
3. **A one-line explanation** of the executor chosen and why it fits the load goal.

Example:
> Run with: `k6 run -e ENV=staging -e AUTH_TOKEN=$TOKEN tests/load.js`
> Used `constant-arrival-rate` at 200 RPS because the goal is to validate sustained production peak; an open-model executor avoids coordinated omission for accurate p99.
