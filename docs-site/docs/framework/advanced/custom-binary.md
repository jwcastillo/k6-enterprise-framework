---
title: "Custom k6 Binary & jslib Modules (T-159)"
sidebar_position: 1
---
# Custom k6 Binary & jslib Modules (T-159)

## Using a Custom k6 Binary (`K6_BINARY_PATH`)

Replace the system `k6` binary with a custom build (e.g. compiled with xk6 extensions):

```bash
# Set the path to your custom binary
export K6_BINARY_PATH=./dist/binaries/my-team/linux_amd64/k6-my-team

# Run tests — framework uses the custom binary automatically
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

### Trusted directory restriction

For security (T-137), `K6_BINARY_PATH` must resolve inside a trusted directory.
The default trusted paths are:

```
/usr/local/bin
/usr/bin
/opt/k6
/opt/homebrew/bin
<project>/dist/binaries
```

Override with:
```bash
export K6_BINARY_ALLOWED_PATHS="/custom/bin:/another/path"
```

### Building a custom binary with xk6

```bash
# Install xk6
go install go.k6.io/xk6/cmd/xk6@latest

# Build with extensions
xk6 build \
  --with github.com/grafana/xk6-redis \
  --with github.com/grafana/xk6-sql \
  --output dist/binaries/my-team/k6-custom

# Use it
export K6_BINARY_PATH=dist/binaries/my-team/k6-custom
./bin/run-test.sh --client=my-team --scenario=api/smoke-users
```

### Using framework-built binary

```bash
# Build client binary (embeds compiled JS scripts)
./bin/build-binary.sh --client=my-team --platform=linux/amd64

# The binary is self-contained — no external files needed
./dist/binaries/my-team/linux_amd64/k6-my-team list-scripts
./dist/binaries/my-team/linux_amd64/k6-my-team run embedded://api/smoke-users
```

---

## Using jslib Modules (T-158 / T-159)

Import k6 community modules (`jslib.k6.io`) directly from scripts.
These are fetched at bundle time (webpack) — no runtime network access needed.

> **TypeScript note**: Remote imports are not type-safe. Use `// @ts-ignore`
> or add a local `*.d.ts` declaration file.

### httpx — enhanced HTTP client

```typescript
// @ts-ignore — jslib remote import, no TypeScript declarations
import { Httpx } from "https://jslib.k6.io/httpx/0.1.0/index.js";

const session = new Httpx({
  baseURL: "https://api.example.com",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

export default function () {
  const res = session.get("/users");
  // httpx supports beforeRequest / afterResponse hooks for auto-tracing
}
```

### k6-utils — utility helpers

```typescript
// @ts-ignore
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

export default function () {
  const correlationId = uuidv4();
  const res = http.get(url, {
    headers: { "X-Correlation-ID": correlationId },
  });
}
```

### Local TypeScript declarations for jslib

Create a declaration file to get IDE completion without `@ts-ignore`:

```typescript
// src/types/jslib.d.ts
declare module "https://jslib.k6.io/httpx/0.1.0/index.js" {
  export class Httpx {
    constructor(params?: Record<string, unknown>);
    get(url: string, params?: Record<string, unknown>): import("k6/http").RefinedResponse<any>;
    post(url: string, body?: unknown, params?: Record<string, unknown>): import("k6/http").RefinedResponse<any>;
  }
}

declare module "https://jslib.k6.io/k6-utils/1.4.0/index.js" {
  export function uuidv4(): string;
  export function randomIntBetween(min: number, max: number): number;
  export function randomItem<T>(array: T[]): T;
}
```

### webpack configuration for jslib

jslib URLs are treated as externals by webpack — they are NOT bundled.
k6 fetches them at script init time from its built-in module cache.

```javascript
// webpack.config.js — jslib externals (already configured)
externals: {
  "https://jslib.k6.io/httpx/0.1.0/index.js": "commonjs https://jslib.k6.io/httpx/0.1.0/index.js",
  "https://jslib.k6.io/k6-utils/1.4.0/index.js": "commonjs https://jslib.k6.io/k6-utils/1.4.0/index.js",
}
```

### Using jslib with xk6 extensions

If your test uses both jslib and xk6 extensions, you need a custom binary:

```bash
# Build binary with redis extension
xk6 build --with github.com/grafana/xk6-redis --output ./k6-custom

# Script can then use both jslib AND xk6 extension
# import redis from "k6/x/redis";                   ← xk6 extension
# import { Httpx } from "https://jslib.k6.io/...";  ← jslib (no binary change needed)
```

If `k6/x/redis` is imported but the binary doesn't include it:
```
ERRO[0000] could not initialize 'k6/x/redis': 'k6/x/redis' external module is not available
```
→ Compile: `xk6 build --with github.com/grafana/xk6-redis`
→ Use: `K6_BINARY_PATH=./k6-custom ./bin/run-test.sh ...`
