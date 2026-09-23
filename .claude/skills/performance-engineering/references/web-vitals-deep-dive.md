# Web vitals — frontend performance

Core Web Vitals (LCP, INP, CLS) and the signals that drive them. Focused on diagnosis and remediation, not generic advice.

> Sources synthesized: khanntm web-performance, KimDoubleB generating-browser-tests.

---

## The three Core Web Vitals (Google ranking signals)

| Metric | What it measures | Good | Needs work | Poor |
|--------|------------------|------|------------|------|
| **LCP** (Largest Contentful Paint) | Time until largest visible element renders | < 2.5s | 2.5-4s | > 4s |
| **INP** (Interaction to Next Paint) | Worst input latency observed during the visit | < 200ms | 200-500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | Visual stability score (0 = perfect) | < 0.1 | 0.1-0.25 | > 0.25 |

INP replaced FID in March 2024. INP is harder to pass — it tracks the **worst** interaction during the session, not just the first.

Targets: aim for "good" at the **75th percentile** of real users, segmented by device class (mobile separate from desktop).

---

## Supporting metrics (diagnose the Vitals)

| Metric | What it tells you |
|--------|-------------------|
| **TTFB** (Time to First Byte) | Server + network before any HTML arrives. If TTFB is bad, LCP can't be good. |
| **FCP** (First Contentful Paint) | First text or image. Gap between FCP and LCP = render-blocking work. |
| **TBT** (Total Blocking Time) | Time main thread was blocked > 50ms. Predictor of INP. |
| **Speed Index** | How quickly content visually populates. Composite signal. |

---

## RUM vs synthetic — both, not either

- **RUM (Real User Monitoring)**: actual user data, segmented by device/network/geo. Truth source for "is the site good for users?" Tools: Google CrUX, Datadog RUM, New Relic Browser, custom via `web-vitals` JS library.
- **Synthetic**: controlled, repeatable. Catches regressions before users see them. Tools: Lighthouse, WebPageTest, k6/browser, Playwright with custom telemetry.

**Use both.** Synthetic for CI gates and pre-deploy checks; RUM for production truth and customer-facing reporting.

---

## LCP — what makes it slow

LCP is dominated by **one specific element** (largest image or text block in viewport). To improve LCP, you must know which element it is and what's blocking it.

### Diagnose

In Chrome DevTools → Performance → record a reload → look for the LCP marker. The element is highlighted.

In RUM: collect `LargestContentfulPaint.element` — track which selector is the LCP per-page-template.

### Common causes (ranked by frequency)

1. **Slow TTFB**: server is slow before HTML even arrives. Fix backend before frontend.
2. **Render-blocking resources** (CSS, JS in `<head>` without `defer`/`async`).
3. **Large LCP image not preloaded**: browser discovers it late.
4. **Web fonts blocking text render**: text invisible until font loads.
5. **Client-side rendering**: JS framework must hydrate before rendering content.

### Fixes

```html
<!-- 1. Preload the LCP image with high priority -->
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">
<img src="/hero.webp" alt="Hero" fetchpriority="high" loading="eager" decoding="sync">

<!-- 2. Defer non-critical JS -->
<script src="/analytics.js" defer></script>

<!-- 3. font-display swap to avoid invisible text -->
<style>
@font-face {
  font-family: 'Brand';
  src: url('/brand.woff2') format('woff2');
  font-display: swap;
}
</style>

<!-- 4. Inline critical CSS, defer the rest -->
<style>/* critical above-the-fold styles */</style>
<link rel="preload" href="/full.css" as="style" onload="this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="/full.css"></noscript>
```

For SSR/SSG frameworks: ensure the LCP element is in the initial HTML (no waiting for hydration).

### Complete resource hints reference

```html
<!-- DNS resolution starts early (cheap; many origins) -->
<link rel="dns-prefetch" href="https://api.example.com">

<!-- Full TCP+TLS handshake (use sparingly; expensive) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://cdn.example.com" crossorigin>

<!-- Preload — same-page critical resources -->
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">
<link rel="preload" as="font" href="/brand.woff2" type="font/woff2" crossorigin>
<link rel="preload" as="style" href="/critical.css">

<!-- Modulepreload — for ES modules -->
<link rel="modulepreload" href="/components/header.js">

<!-- Prefetch — likely-next-page resources (low priority) -->
<link rel="prefetch" href="/products">
```

**Anti-patterns to audit:**
- Preloading something that's never used → wastes bandwidth.
- Preconnecting to many origins → connection overhead beats savings.
- Prefetching with a high-priority resource hint → defeats the purpose.

---

## INP — what makes it slow

INP measures the **slowest** input handler during the session. To pass, every interaction must be fast — one slow click ruins the score.

### Diagnose

- Chrome DevTools → Performance → Record while interacting → look for "long tasks" (> 50ms blocks).
- Field data: `web-vitals` library reports INP with the slow interaction's element selector.

### Common causes

1. **Long tasks on the main thread** during interaction: heavy JS work synchronously.
2. **React/Vue re-renders** on input: state change triggers cascading updates.
3. **Layout thrashing**: reading and writing layout properties in a tight loop forces sync layout.
4. **Heavy event handlers**: complex computation inline.

### Fixes

```javascript
// 1. Defer non-critical work with scheduler.yield (or setTimeout(0))
async function handleClick() {
  updateUIImmediately();
  await scheduler.yield();  // or: await new Promise(r => setTimeout(r, 0))
  doExpensiveWork();
}

// 2. Move heavy work off the main thread
const worker = new Worker('/worker.js');
worker.postMessage(data);
worker.onmessage = e => updateUI(e.data);

// 3. Batch state updates (React 18+ does this automatically; older code needs unstable_batchedUpdates)

// 4. Use requestAnimationFrame for visual updates, not arbitrary timers
```

For React: `useTransition` and `useDeferredValue` move expensive renders off the urgent path.

---

## CLS — visual stability

CLS measures unexpected layout shifts during the session. Score is the sum of (impact fraction × distance fraction) for each shift.

### Common causes

1. **Images without dimensions**: layout reflows when they load.
2. **Ads or embeds inserted dynamically** without reserved space.
3. **Web fonts** causing FOIT/FOUT shifts.
4. **Lazy-loaded content above the fold**.

### Fixes

```html
<!-- 1. Always specify width and height (or aspect-ratio) -->
<img src="/photo.jpg" width="800" height="600" alt="...">

<!-- 2. Reserve space for ads / embeds -->
<div style="aspect-ratio: 16/9; background: #f0f0f0">
  <!-- ad slot will populate here -->
</div>

<!-- 3. font-display: optional or swap with size-adjust to minimize shift -->
<style>
@font-face {
  font-family: 'Brand';
  src: url('/brand.woff2') format('woff2');
  font-display: swap;
  size-adjust: 95%;
  ascent-override: 90%;
}
</style>
```

For React/Vue: avoid conditionally rendering elements above the fold based on data fetched after first render.

---

## TTFB — the server-side prerequisite

If TTFB is poor, no frontend optimization can rescue LCP.

### Targets

- **Mobile 4G**: < 800ms
- **Desktop**: < 600ms
- **At p75 of real users**, not in lab

### Common causes

1. Slow server-side rendering (database calls, third-party API in the request path).
2. No CDN — every user hits origin.
3. Missing edge cache for cacheable HTML/JSON.
4. Cold serverless functions on first request (cold start).

### Fixes

1. **CDN with edge caching**: cache full HTML for static pages, fragments via edge-side includes.
2. **Streaming SSR**: send `<head>` early, stream body progressively.
3. **Move third-party API calls** out of the request path (cache, async, fallback).
4. **Edge runtime** (Cloudflare Workers, Vercel Edge, AWS Lambda@Edge) for personalized but cacheable responses.

---

## Performance budget — make it part of the contract

A budget is a numerical SLO for performance, gated in CI. Without a budget, "fast enough" becomes "whatever shipped".

### Suggested budgets (mobile, mid-tier device, slow 4G)

| Resource | Budget | Rationale |
|----------|--------|-----------|
| Total page weight (compressed) | < 1.5 MB | 3G loads in ~4s |
| JavaScript (compressed) | < 300 KB | Parse + execution time on mid-tier mobile |
| CSS (compressed) | < 100 KB | Render-blocking by default |
| Above-fold images | < 500 KB | LCP impact |
| Fonts | < 100 KB total | FOIT / FOUT prevention |
| Third-party scripts | < 200 KB | Uncontrolled latency, hard to optimize |

These are starting points. Tighten or relax based on your audience (e.g., emerging markets need stricter budgets; B2B desktop allows looser).

### Lighthouse CI budget config

```json
{
  "ci": {
    "assert": {
      "preset": "lighthouse:recommended",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "interaction-to-next-paint": ["error", { "maxNumericValue": 200 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "resource-summary:script:size": ["error", { "maxNumericValue": 300000 }],
        "resource-summary:image:size": ["error", { "maxNumericValue": 500000 }],
        "resource-summary:third-party:count": ["warn", { "maxNumericValue": 20 }]
      }
    }
  }
}
```

Run on every PR; block merge if regression.

---

## Bundle size — the lever you control

Bundle size correlates strongly with LCP and INP, especially on slow networks.

### Diagnose

- `webpack-bundle-analyzer`, `rollup-plugin-visualizer` — see what's in your bundles.
- Lighthouse "Reduce unused JavaScript" — flags dead code.
- DevTools → Coverage tab — shows which JS is actually used on a page.

### Reduce

1. **Code-split**: dynamic `import()` for routes / features. Don't ship the admin dashboard to logged-out visitors.
2. **Tree-shake**: use ES modules, avoid namespace imports (`import * as` blocks tree-shaking).
3. **Replace heavy deps**: `moment` → `date-fns` or `Temporal`; `lodash` → individual functions or native.
4. **Compress**: brotli over gzip — browsers support it widely.
5. **Lazy-load below-the-fold images**: `loading="lazy"`.

### Targets

- Critical CSS: < 14KB compressed (fits in first TCP packet).
- Initial JS bundle: < 170KB compressed for mobile.
- Total page weight: < 1MB compressed for first interaction.

---

## Synthetic testing with k6/browser

```javascript
import { browser } from 'k6/browser';
import { check } from 'k6';

export const options = {
  scenarios: {
    ui: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
      vus: 1, iterations: 5,
    },
  },
  thresholds: {
    'browser_web_vital_lcp{p:75}': ['p(75)<2500'],
    'browser_web_vital_cls{p:75}': ['p(75)<0.1'],
    'browser_web_vital_inp{p:75}': ['p(75)<200'],
  },
};

export default async function() {
  const page = await browser.newPage();
  try {
    await page.goto('https://example.com', { waitUntil: 'networkidle' });

    // Trigger an interaction to measure INP
    await page.locator('button[data-cta]').click();
    await page.waitForLoadState('networkidle');

    const vitals = await page.evaluate(() => {
      return new Promise(resolve => {
        const data = {};
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'largest-contentful-paint') data.lcp = entry.startTime;
            if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
              data.cls = (data.cls || 0) + entry.value;
            }
          }
          resolve(data);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => resolve(data), 5000);
      });
    });

    check(vitals, { 'LCP < 2.5s': v => v.lcp < 2500 });
  } finally {
    await page.close();
  }
}
```

For richer Web Vitals capture, use the `web-vitals` JS library inside `page.evaluate()` to get INP, FID, and proper LCP/CLS observers.

---

## Image optimization — detailed patterns

### Format selection (in order of preference)

| Format | Use case | Browser support |
|--------|----------|-----------------|
| AVIF | Photos, best compression | 92%+ |
| WebP | Photos, good fallback | 97%+ |
| PNG | Graphics with transparency, when AVIF/WebP not viable | Universal |
| SVG | Icons, logos, illustrations | Universal |

### Responsive picture with format fallback

```html
<picture>
  <!-- AVIF for modern browsers -->
  <source
    type="image/avif"
    srcset="/hero-400.avif 400w, /hero-800.avif 800w, /hero-1200.avif 1200w"
    sizes="(max-width: 600px) 100vw, 50vw">

  <!-- WebP fallback -->
  <source
    type="image/webp"
    srcset="/hero-400.webp 400w, /hero-800.webp 800w, /hero-1200.webp 1200w"
    sizes="(max-width: 600px) 100vw, 50vw">

  <!-- JPEG fallback + dimensions to prevent CLS -->
  <img
    src="/hero-800.jpg"
    srcset="/hero-400.jpg 400w, /hero-800.jpg 800w, /hero-1200.jpg 1200w"
    sizes="(max-width: 600px) 100vw, 50vw"
    width="1200" height="600"
    alt="Hero"
    fetchpriority="high"
    decoding="sync">
</picture>
```

### Loading strategy by viewport position

```html
<!-- Above-fold LCP: eager + sync decode + high priority -->
<img src="/hero.webp" fetchpriority="high" loading="eager" decoding="sync" alt="Hero">

<!-- Below-fold: lazy + async decode -->
<img src="/below-fold.webp" loading="lazy" decoding="async" alt="...">
```

**Common bug**: above-the-fold images marked `loading="lazy"` — delays LCP. Use the image audit snippet in `devtools-performance-snippets.md` to detect.

## Code splitting and bundle reduction

### Route-based splitting (React example)

```javascript
import { lazy, Suspense } from 'react';
const Dashboard = lazy(() => import('./Dashboard'));
const Settings = lazy(() => import('./Settings'));

<Suspense fallback={<Loading />}>
  <Routes>
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/settings" element={<Settings />} />
  </Routes>
</Suspense>
```

### Feature-based / conditional splitting

```javascript
// Only load premium features for premium users
if (user.isPremium) {
  const { PremiumDashboard } = await import('./PremiumFeatures');
  // ...
}
```

### Tree shaking — import only what you use

```javascript
// ❌ Imports entire library (300+ KB)
import _ from 'lodash';
_.debounce(fn, 300);

// ✅ Imports only debounce (~2 KB)
import debounce from 'lodash/debounce';
debounce(fn, 300);

// ✅ Even better — native or lightweight alternative
const debounce = (fn, ms) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};
```

### Webpack splitChunks (for vendor extraction)

```javascript
// webpack.config.js
module.exports = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: { test: /[\\/]node_modules[\\/]/, name: 'vendors', chunks: 'all' },
      },
    },
  },
};
```

## Font optimization — detailed

### Loading strategy

```css
body {
  font-family: 'Custom Font', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

@font-face {
  font-family: 'Custom Font';
  src: url('/fonts/custom.woff2') format('woff2');
  font-display: swap;          /* show fallback immediately, swap when loaded */
  font-weight: 400;
  unicode-range: U+0000-00FF;  /* subset to Latin to reduce file size */
}
```

### `font-display` values — pick deliberately

| Value | Behavior | Use case |
|-------|----------|----------|
| `auto` | Browser default (usually `block`) | Don't use |
| `block` | Hide text until font loads (FOIT) | Critical brand display |
| `swap` | Fallback immediately, swap when ready (FOUT) | Most cases — recommended |
| `fallback` | Brief block, then fallback if not loaded in 100ms | When swap shift is too jarring |
| `optional` | Use cached font or fallback; never block | Slow connections priority |

### Variable fonts

One file instead of multiple weights — typically 50-70% smaller than 4 separate weights.

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Variable.woff2') format('woff2-variations');
  font-weight: 100 900;  /* range */
  font-display: swap;
}

h1 { font-weight: 700; }
body { font-weight: 400; }
/* Same file serves both */
```



Mobile is the harder case. Always measure separately.

- 4G (slow) emulation in Lighthouse: `--throttling-method=devtools`.
- Mid-tier device CPU emulation: `--throttling.cpuSlowdownMultiplier=4`.
- Test on real devices for INP — emulation underestimates main-thread cost.

**For hybrid / native apps consuming web APIs**: the API server response time matters more than the rendering side. See `tool-selection-guide.md` for k6 + mobile API testing patterns.
