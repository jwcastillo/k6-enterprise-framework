# DevTools performance snippets

Curated JavaScript snippets to run in **Chrome DevTools Console** to measure, debug, and audit web performance — vendor-neutral, no MCP required, no instrumentation needed. Paste, hit Enter, read the output.

> Source synthesized: nucliweb/webperf-snippets (Joan León's curated library of 49 snippets) reorganized into PE workflows. Snippets here are rewritten for readability based on standard Web Performance APIs. The original minified library is at https://webperf-snippets.nucliweb.net.

---

## How to use

**One-shot in console:**
1. Open DevTools (`F12` or `Cmd+Option+I` / `Ctrl+Shift+I`)
2. Go to **Console** tab
3. Paste the snippet, press Enter
4. Read the result

**Save as DevTools snippet** for repeated use:
1. DevTools → **Sources** tab → **Snippets** panel
2. Click **+ New snippet**
3. Name it (e.g., "LCP-debug"), paste, save
4. Right-click → **Run** (or `Cmd+Enter` / `Ctrl+Enter`)

**Workflow rule:** measure → diagnose → remediate → re-measure. Every snippet below tells you which one to run next based on the result.

---

## Section 1 — Core Web Vitals measurement

### LCP (Largest Contentful Paint)

```javascript
// LCP — measures load
new PerformanceObserver((list) => {
  const entries = list.getEntries();
  const last = entries[entries.length - 1];
  const lcp = last.startTime;
  const verdict = lcp <= 2500 ? '🟢 Good' : lcp <= 4000 ? '🟡 Needs work' : '🔴 Poor';
  console.log(`%c LCP: ${lcp.toFixed(0)}ms — ${verdict}`, 'font-size: 14px; font-weight: bold');
  console.log('LCP element:', last.element);
  if (last.element) last.element.style.outline = '3px dashed lime';
}).observe({ type: 'largest-contentful-paint', buffered: true });
```

**Interpretation:**
- 🟢 ≤ 2.5s → done, no action needed at this level.
- 🟡 2.5-4s → run **LCP-Sub-Parts** to find which phase is slow.
- 🔴 > 4s → run **LCP-Sub-Parts** AND audit the LCP element (image preload, font, render-blocking).

### LCP sub-parts breakdown

LCP = TTFB + resource load delay + resource load time + render delay. Find the dominant phase.

```javascript
// LCP sub-parts — break down what's contributing
const navEntry = performance.getEntriesByType('navigation')[0];
new PerformanceObserver((list) => {
  const lcpEntry = list.getEntries().pop();
  const ttfb = navEntry.responseStart;
  const resLoadDelay = lcpEntry.startTime - ttfb - (lcpEntry.url ?
    (performance.getEntriesByName(lcpEntry.url)[0]?.duration || 0) : 0);
  const resLoadTime = lcpEntry.url ?
    (performance.getEntriesByName(lcpEntry.url)[0]?.duration || 0) : 0;
  const renderDelay = lcpEntry.startTime - (resLoadDelay + resLoadTime + ttfb);

  console.table({
    'TTFB': `${ttfb.toFixed(0)}ms (${(ttfb / lcpEntry.startTime * 100).toFixed(0)}%)`,
    'Resource load delay': `${Math.max(0, resLoadDelay).toFixed(0)}ms`,
    'Resource load time': `${resLoadTime.toFixed(0)}ms`,
    'Render delay': `${Math.max(0, renderDelay).toFixed(0)}ms`,
    'Total LCP': `${lcpEntry.startTime.toFixed(0)}ms`
  });
}).observe({ type: 'largest-contentful-paint', buffered: true });
```

**Interpretation by dominant phase:**
- **TTFB dominant** → backend / CDN problem. See Section 2 (TTFB).
- **Resource load delay dominant** → preload missing or wrong priority.
- **Resource load time dominant** → image/asset too large, wrong format.
- **Render delay dominant** → render-blocking JS/CSS, framework hydration cost.

### CLS (Cumulative Layout Shift)

```javascript
// CLS — measures visual stability
let cls = 0;
const shifts = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      cls += entry.value;
      shifts.push({
        time: entry.startTime.toFixed(0) + 'ms',
        score: entry.value.toFixed(4),
        sources: entry.sources?.map(s => s.node?.tagName).filter(Boolean) || []
      });
      // Highlight shifted nodes
      entry.sources?.forEach(s => {
        if (s.node) s.node.style.outline = '2px dashed red';
      });
    }
  }
  const verdict = cls <= 0.1 ? '🟢 Good' : cls <= 0.25 ? '🟡 Needs work' : '🔴 Poor';
  console.log(`%c CLS: ${cls.toFixed(3)} — ${verdict}`, 'font-size: 14px; font-weight: bold');
  console.table(shifts);
}).observe({ type: 'layout-shift', buffered: true });
```

**Interpretation:**
- Look at `sources` — those are the elements that shifted.
- Common culprits: `<img>` without `width`/`height`, fonts swapping, ads/embeds inserted dynamically, lazy-loaded content above the fold.
- Fix patterns in `web-vitals-deep-dive.md`.

### INP (Interaction to Next Paint)

```javascript
// INP — measures interactivity (worst interaction during the session)
const interactions = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.interactionId) {
      interactions.push({
        id: entry.interactionId,
        type: entry.name,
        target: entry.target?.tagName,
        duration: entry.duration,
        processingTime: entry.processingEnd - entry.processingStart,
        inputDelay: entry.processingStart - entry.startTime
      });
    }
  }
}).observe({ type: 'event', buffered: true, durationThreshold: 16 });

// Call this after interacting with the page
window.getINP = () => {
  if (interactions.length === 0) return console.log('No interactions yet');
  const sorted = [...interactions].sort((a, b) => b.duration - a.duration);
  const inp = sorted[0].duration;
  const verdict = inp <= 200 ? '🟢 Good' : inp <= 500 ? '🟡 Needs work' : '🔴 Poor';
  console.log(`%c INP: ${inp.toFixed(0)}ms — ${verdict}`, 'font-size: 14px; font-weight: bold');
  console.log('Worst interaction:', sorted[0]);
  console.log('All interactions:'); console.table(sorted.slice(0, 10));
};

console.log('Interact with the page, then run getINP()');
```

**Interpretation:** look at `inputDelay` (waiting before handler runs), `processingTime` (handler execution), and `duration - inputDelay - processingTime` (presentation delay).

---

## Section 2 — Loading performance

### TTFB (Time to First Byte)

```javascript
// TTFB — server + network before any content arrives
const nav = performance.getEntriesByType('navigation')[0];
if (!nav) { console.error('No navigation entry'); }
else {
  const ttfb = nav.responseStart;
  const verdict = ttfb <= 800 ? '🟢 Good' : ttfb <= 1800 ? '🟡 Needs work' : '🔴 Poor';
  console.log(`%c TTFB: ${ttfb.toFixed(0)}ms — ${verdict}`, 'font-size: 14px');
  console.table({
    'DNS lookup': (nav.domainLookupEnd - nav.domainLookupStart).toFixed(0) + 'ms',
    'TCP connect': (nav.connectEnd - nav.connectStart).toFixed(0) + 'ms',
    'TLS': nav.secureConnectionStart > 0 ?
      (nav.connectEnd - nav.secureConnectionStart).toFixed(0) + 'ms' : 'N/A',
    'Request': (nav.responseStart - nav.requestStart).toFixed(0) + 'ms (server thinking)',
    'Total TTFB': ttfb.toFixed(0) + 'ms'
  });
}
```

**Interpretation:**
- DNS or TCP slow → network / CDN issue.
- TLS slow → certificate or cipher misconfiguration.
- Request slow → backend or origin slow; check server-side traces.

### Render-blocking resources

```javascript
// Find resources blocking render (Chrome 107+)
const blocking = performance.getEntriesByType('resource')
  .filter(e => e.renderBlockingStatus === 'blocking')
  .map(e => ({
    type: e.initiatorType,
    name: e.name.split('/').pop().slice(0, 60),
    'load (ms)': e.duration.toFixed(0),
    'finish (ms)': e.responseEnd.toFixed(0),
    'size (KB)': e.transferSize ? (e.transferSize / 1024).toFixed(1) : '?'
  }))
  .sort((a, b) => parseFloat(b['finish (ms)']) - parseFloat(a['finish (ms)']));

if (blocking.length === 0) {
  console.log('🟢 No render-blocking resources detected');
} else {
  console.log(`🔴 ${blocking.length} render-blocking resource(s) — these delay FCP/LCP:`);
  console.table(blocking);
}
```

**Fix:** add `defer` to non-critical scripts, inline critical CSS + defer the rest, preload + async-load fonts.

### Resource hints validation

```javascript
// Check usage of preconnect, preload, prefetch, dns-prefetch
const hints = ['preconnect', 'preload', 'prefetch', 'dns-prefetch', 'modulepreload'];
const summary = {};
hints.forEach(h => {
  const links = document.querySelectorAll(`link[rel="${h}"]`);
  summary[h] = {
    count: links.length,
    targets: Array.from(links).slice(0, 5).map(l => l.getAttribute('href') || l.getAttribute('imagesrcset'))
  };
});
console.table(Object.entries(summary).map(([hint, data]) => ({
  hint, count: data.count, examples: data.targets.join(', ')
})));

// Detect anti-patterns
const preloads = document.querySelectorAll('link[rel="preload"]');
preloads.forEach(p => {
  const href = p.href;
  const used = performance.getEntriesByName(href).length > 0;
  if (!used) console.warn(`⚠️ Preload not used (waste): ${href}`);
});
```

### First-party vs third-party scripts

```javascript
// Audit what your site loads vs third parties
const origin = location.origin;
const scripts = performance.getEntriesByType('resource')
  .filter(e => e.initiatorType === 'script')
  .map(e => ({
    party: e.name.startsWith(origin) ? 'first' : 'third',
    host: new URL(e.name).hostname,
    duration: e.duration.toFixed(0),
    size: e.transferSize ? (e.transferSize / 1024).toFixed(1) + ' KB' : '?'
  }));

const byParty = scripts.reduce((acc, s) => {
  acc[s.party] = (acc[s.party] || 0) + 1;
  return acc;
}, {});
console.log('Script counts by party:', byParty);

// Top 10 by load time
const slowest = [...scripts].sort((a, b) => parseFloat(b.duration) - parseFloat(a.duration)).slice(0, 10);
console.table(slowest);
```

**Pattern:** if third-party scripts dominate, defer them or remove unused ones. Run before/after `gtag`, ad scripts, marketing tags.

### Font loading audit

```javascript
// Check fonts: preloaded, swapped, used above the fold
const fonts = performance.getEntriesByType('resource')
  .filter(e => /\.(woff2?|ttf|otf)$/.test(e.name));

const preloaded = new Set(
  Array.from(document.querySelectorAll('link[rel="preload"][as="font"]'))
    .map(l => l.href)
);

const audit = fonts.map(f => ({
  file: f.name.split('/').pop(),
  loadTime: f.duration.toFixed(0) + 'ms',
  size: f.transferSize ? (f.transferSize / 1024).toFixed(1) + ' KB' : '?',
  preloaded: preloaded.has(f.name) ? '✅' : '❌',
  finishedAt: f.responseEnd.toFixed(0) + 'ms'
}));

console.table(audit);

// Check font-display
document.fonts.forEach(f => {
  console.log(`${f.family} ${f.weight}: display=${f.display}, status=${f.status}`);
});
```

**Pattern:** critical fonts should be preloaded with `<link rel="preload" as="font" type="font/woff2" crossorigin>` and have `font-display: swap` or `optional`.

### Service Worker analysis

```javascript
// Check SW: registered? controlling? cache hits?
if (!('serviceWorker' in navigator)) {
  console.log('Service Worker not supported');
} else {
  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg) return console.log('🟡 No service worker registered');
    console.log(`✅ SW registered, scope: ${reg.scope}`);
    console.log(`Controlling page: ${navigator.serviceWorker.controller ? '✅' : '❌'}`);
  });

  // Resources served from SW cache appear in resource timing with deliveryType
  const swServed = performance.getEntriesByType('resource')
    .filter(e => e.deliveryType === 'cache' || e.transferSize === 0 && e.encodedBodySize > 0);
  console.log(`Resources from cache: ${swServed.length} / ${performance.getEntriesByType('resource').length}`);
}
```

---

## Section 3 — Interaction debugging

### Long Animation Frames (LoAF)

LoAF is the new Web API (Chrome 123+) that replaces Long Tasks for diagnosing INP causes.

```javascript
// Capture long animation frames — anything > 50ms is suspect for INP
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`🔴 LoAF: ${entry.duration.toFixed(0)}ms at ${entry.startTime.toFixed(0)}ms`);
    console.log(`  Render: ${entry.renderStart > 0 ? entry.renderStart - entry.startTime : 0}ms (style+layout+paint)`);
    if (entry.scripts && entry.scripts.length > 0) {
      console.table(entry.scripts.map(s => ({
        invoker: s.invoker || s.invokerType,
        duration: s.duration.toFixed(0) + 'ms',
        sourceURL: s.sourceURL?.split('/').pop() || 'inline'
      })));
    }
  }
}).observe({ type: 'long-animation-frame', buffered: true });

console.log('Interact with the page; LoAFs > 50ms will be logged');
```

**Interpretation:** the script with longest `duration` is your INP suspect. If render dominates, it's a layout / paint problem (often huge DOM or expensive CSS).

### Event timing breakdown

```javascript
// Show all interactions with their three-phase breakdown
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.interactionId) continue;
    const inputDelay = entry.processingStart - entry.startTime;
    const processingTime = entry.processingEnd - entry.processingStart;
    const presentationDelay = entry.startTime + entry.duration - entry.processingEnd;
    console.log(`%c ${entry.name} on ${entry.target?.tagName} — ${entry.duration}ms`,
      entry.duration > 200 ? 'color: red' : 'color: green');
    console.table({
      'Input delay': inputDelay.toFixed(0) + 'ms',
      'Processing': processingTime.toFixed(0) + 'ms',
      'Presentation delay': presentationDelay.toFixed(0) + 'ms'
    });
  }
}).observe({ type: 'event', buffered: true, durationThreshold: 16 });
```

**Interpretation:**
- **Input delay** dominant → main thread busy before handler runs (other JS work). Defer that work.
- **Processing** dominant → handler is slow. Move work off-thread or break it up.
- **Presentation delay** dominant → DOM updates triggered after handler are heavy. Reduce reflow/repaint.

---

## Section 4 — Media audit

### Image audit

```javascript
// Audit all images on the page
const images = Array.from(document.querySelectorAll('img')).map(img => {
  const rect = img.getBoundingClientRect();
  const visible = rect.top < window.innerHeight && rect.bottom > 0;
  return {
    src: img.src.split('/').pop().slice(0, 40),
    width: img.width,
    height: img.height,
    naturalW: img.naturalWidth,
    naturalH: img.naturalHeight,
    oversized: img.naturalWidth > img.width * 2 || img.naturalHeight > img.height * 2 ? '⚠️' : '✅',
    loading: img.loading,
    fetchPriority: img.fetchPriority,
    'visible (ATF)': visible ? '✅' : '❌',
    'lazy ATF (BUG)': visible && img.loading === 'lazy' ? '🔴 BUG' : '',
    'eager BTF (waste)': !visible && img.loading !== 'lazy' ? '⚠️' : '',
    decoding: img.decoding
  };
});
console.table(images);
```

**Common bugs found:**
- `lazy ATF` → above-the-fold images with `loading="lazy"` delay LCP.
- `oversized` → image is much larger than rendered size; serve responsive sizes.
- `eager BTF` without `loading="lazy"` → wastes bandwidth on below-fold.

### Above-the-fold lazy-loaded images (anti-pattern)

```javascript
// Find images that are visible (or near-visible) but lazy-loaded
const atfLazy = Array.from(document.querySelectorAll('img[loading="lazy"]')).filter(img => {
  const rect = img.getBoundingClientRect();
  return rect.top < window.innerHeight * 1.5; // 1.5x viewport
});
if (atfLazy.length === 0) {
  console.log('🟢 No above-the-fold images with loading="lazy"');
} else {
  console.warn(`🔴 ${atfLazy.length} above-the-fold image(s) are lazy-loaded — this delays LCP`);
  atfLazy.forEach(img => {
    img.style.outline = '3px solid red';
    console.log(img);
  });
}
```

### Video element audit

```javascript
// Audit videos
Array.from(document.querySelectorAll('video')).forEach(v => {
  console.table({
    src: v.currentSrc?.split('/').pop() || 'no source',
    poster: v.poster ? '✅' : '❌',
    autoplay: v.autoplay,
    muted: v.muted,
    'autoplay+muted (req for autoplay)': v.autoplay && v.muted ? '✅' : v.autoplay ? '🔴' : 'N/A',
    preload: v.preload,
    'aspect ratio set': v.style.aspectRatio || (v.width && v.height) ? '✅ no CLS' : '❌ may cause CLS',
    width: v.videoWidth,
    height: v.videoHeight,
    duration: v.duration?.toFixed(0) + 's' || '?'
  });
});
```

---

## Section 5 — Resources analysis

### Resource summary by type

```javascript
const summary = performance.getEntriesByType('resource').reduce((acc, r) => {
  const t = r.initiatorType || 'other';
  if (!acc[t]) acc[t] = { count: 0, bytes: 0, ms: 0 };
  acc[t].count++;
  acc[t].bytes += r.transferSize || 0;
  acc[t].ms += r.duration;
  return acc;
}, {});

console.table(
  Object.entries(summary)
    .map(([type, s]) => ({
      type,
      count: s.count,
      'total KB': (s.bytes / 1024).toFixed(1),
      'avg ms': (s.ms / s.count).toFixed(0)
    }))
    .sort((a, b) => parseFloat(b['total KB']) - parseFloat(a['total KB']))
);
```

### Slowest resources

```javascript
const slowest = performance.getEntriesByType('resource')
  .map(r => ({
    type: r.initiatorType,
    name: r.name.split('/').pop().slice(0, 50),
    duration: r.duration.toFixed(0) + 'ms',
    size: r.transferSize ? (r.transferSize / 1024).toFixed(1) + ' KB' : '?',
    cached: r.transferSize === 0 && r.encodedBodySize > 0 ? '✅' : '❌',
    protocol: r.nextHopProtocol || '?'
  }))
  .sort((a, b) => parseFloat(b.duration) - parseFloat(a.duration))
  .slice(0, 15);

console.table(slowest);
```

### JavaScript execution time

```javascript
// Approximate JS exec time from long tasks
const tasks = performance.getEntriesByType('longtask');
const totalLong = tasks.reduce((sum, t) => sum + t.duration, 0);
console.log(`Long tasks: ${tasks.length}, total time: ${totalLong.toFixed(0)}ms`);

// Per-script load and parse approximation
const scripts = performance.getEntriesByType('resource')
  .filter(r => r.initiatorType === 'script')
  .map(r => ({
    name: r.name.split('/').pop().slice(0, 50),
    transfer: r.transferSize ? (r.transferSize / 1024).toFixed(1) + ' KB' : '?',
    duration: r.duration.toFixed(0) + 'ms',
    blockingStatus: r.renderBlockingStatus
  }))
  .sort((a, b) => parseFloat(b.duration) - parseFloat(a.duration));
console.table(scripts.slice(0, 15));
```

---

## Section 6 — Recommended workflows

### "The page is slow" — full audit (60 seconds)

Run in this order:
1. **TTFB** — is the backend slow?
2. **LCP** — what's the load impact?
3. **LCP sub-parts** — which phase dominates?
4. **Render-blocking resources** — what's delaying first paint?
5. **Resource summary** — too much JS? CSS? Images?
6. **Image audit** — any LCP-relevant image bugs?

### "INP is bad" — interaction audit

1. **INP** — establish baseline, identify worst interaction.
2. **Long Animation Frames** — find offending scripts.
3. **Event timing** — break down into 3 phases.
4. Profile in DevTools → Performance tab during the slow interaction.

### "CLS is bad" — visual stability audit

1. **CLS** — what shifted, and when.
2. **Image audit** → look for missing `width`/`height`.
3. **Font audit** → check `font-display` is `swap` or `optional`.
4. Check ad/embed slots for reserved space.

### "Pre-deploy regression check"

Run all of Section 1 (CWV) + Section 2 (Loading) before and after your change. Compare the numbers.

---

## When to run these vs other tools

| Situation | Use |
|-----------|-----|
| Quick check on a real page | These snippets in DevTools console |
| Repeatable measurement in CI | Lighthouse CI (see `cicd-perf-gates.md`) |
| Production truth across all users | RUM (Faro, Datadog, New Relic) — see `grafana-stack-observability.md` |
| Synthetic with full load model | k6/browser (see `k6-patterns.md`) |
| Deep CPU/memory profile | DevTools Performance tab + flame graph |

These snippets are **diagnosis tools**, not measurement tools for SLO. Use them when investigating; use RUM and Lighthouse CI for ongoing monitoring.

---

## Source attribution

The snippet **catalog and workflow structure** is inspired by Joan León's [webperf-snippets](https://github.com/nucliweb/webperf-snippets) library. The implementations here are rewritten for readability based on standard Web Performance APIs (`PerformanceObserver`, `PerformanceResourceTiming`, `LayoutShift`, `LargestContentfulPaint`, `EventTiming`, `LongAnimationFrame`). For the original full library (49 snippets, including media, DevTools overrides, and bfcache analysis), visit https://webperf-snippets.nucliweb.net.
