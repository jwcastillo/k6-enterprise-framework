// bin/discovery/har-analysis.js — deterministic analysis of the recorded HAR for k6 authoring.
//
// endpoints():    first-party requests in order, as METHOD + path template
// correlations(): values that first appear in a response body and are sent back in a later
//                 request (URL, body or header) — the things a k6 script must extract.
//
// Output never carries raw values: only where they come from, where they go and their length.

"use strict";

const STATIC = /\.(js|mjs|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|map)$/i;
const MIN_VALUE_LENGTH = 6;
// Values that recur for reasons other than correlation
const TRIVIAL = /^(true|false|null|undefined|success|ok|error|active|pending|default|[a-z]+)$/i;

function hostMatches(host, patterns) {
  return patterns.some((p) => (p.startsWith("*.") ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p));
}

/** /api/orders/123/items/0f8fad5b-d9cb-469f-a165-70867728950e -> /api/orders/{id}/items/{uuid} */
function templatePath(pathname) {
  return pathname
    .split("/")
    .map((seg) => {
      if (/^\d+$/.test(seg)) return "{id}";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return "{uuid}";
      if (/^[0-9a-f]{12,}$/i.test(seg) || (/\d/.test(seg) && /^[\w-]{16,}$/.test(seg))) return "{token}";
      if (/\d{4,}/.test(seg)) return "{id}";
      return seg;
    })
    .join("/");
}

function bodyText(content) {
  if (!content || typeof content.text !== "string") return "";
  if (content.encoding === "base64") {
    if (!/json|html|text|xml|javascript/i.test(content.mimeType || "")) return "";
    return Buffer.from(content.text, "base64").toString("utf8");
  }
  return content.text;
}

function isFirstParty(entry, hosts) {
  const url = new URL(entry.request.url);
  return hostMatches(url.hostname, hosts) && !STATIC.test(url.pathname);
}

/** First-party, non-static requests in the order they happened. */
function endpoints(har, hosts) {
  return har.log.entries
    .filter((e) => isFirstParty(e, hosts))
    .map((e) => {
      const url = new URL(e.request.url);
      return {
        method: e.request.method,
        path: templatePath(url.pathname),
        status: e.response.status,
        mimeType: ((e.response.content || {}).mimeType || "").split(";")[0],
      };
    });
}

/** Leaf values of a JSON document, with a k6 res.json() selector for each. */
function jsonLeaves(value, path = "", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => jsonLeaves(v, `${path}.${i}`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) jsonLeaves(v, path ? `${path}.${k}` : k, out);
  } else if (typeof value === "string" || typeof value === "number") {
    out.push({ selector: path, value: String(value) });
  }
  return out;
}

/** Candidate values a response hands to the client: JSON leaves and hidden form inputs. */
function responseValues(entry) {
  const text = bodyText(entry.response.content);
  const mime = (entry.response.content || {}).mimeType || "";
  if (!text) return [];
  if (/json/i.test(mime)) {
    try {
      return jsonLeaves(JSON.parse(text)).map((v) => ({ ...v, kind: "json" }));
    } catch {
      return [];
    }
  }
  if (/html/i.test(mime)) {
    const hidden = /<input\b[^>]*type=["']?hidden["']?[^>]*>/gi;
    const attr = (tag, name) => (new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(tag) || [])[1];
    return (text.match(hidden) || [])
      .map((tag) => ({ selector: attr(tag, "name"), value: attr(tag, "value"), kind: "hidden-input" }))
      .filter((v) => v.selector && v.value);
  }
  return [];
}

function requestParts(entry) {
  const parts = [{ where: "url", text: entry.request.url }];
  const post = entry.request.postData && entry.request.postData.text;
  if (post) parts.push({ where: "body", text: post });
  for (const h of entry.request.headers || []) {
    if (/^(cookie|:)/i.test(h.name)) continue; // the cookie jar is k6's job, not correlation
    parts.push({ where: `header ${h.name.toLowerCase()}`, text: h.value });
  }
  return parts;
}

const contains = (text, value) => text.includes(value) || text.includes(encodeURIComponent(value));

/**
 * Values that first appear in a response and are reused by a later request.
 * A value the client already sent before (typed input, --data) is not a correlation.
 */
function correlations(har, hosts) {
  const entries = har.log.entries.filter((e) => isFirstParty(e, hosts));
  const found = [];
  const seen = new Set();
  entries.forEach((source, i) => {
    for (const { selector, value, kind } of responseValues(source)) {
      if (value.length < MIN_VALUE_LENGTH || TRIVIAL.test(value) || seen.has(value)) continue;
      const sentBefore = entries.slice(0, i + 1).some((e) => requestParts(e).some((p) => contains(p.text, value)));
      if (sentBefore) continue;
      const usedIn = [];
      entries.slice(i + 1).forEach((target) => {
        const wheres = requestParts(target).filter((p) => contains(p.text, value)).map((p) => p.where);
        if (wheres.length) {
          usedIn.push({ method: target.request.method, path: templatePath(new URL(target.request.url).pathname), where: wheres });
        }
      });
      if (!usedIn.length) continue;
      seen.add(value);
      found.push({
        name: selector.split(".").pop(),
        source: { method: source.request.method, path: templatePath(new URL(source.request.url).pathname), kind, selector },
        valueLength: value.length,
        usedIn,
      });
    }
  });
  return found;
}

/** k6 snippet that extracts a correlation from the source response `res`. */
function k6Extract(c) {
  const v = c.name.replace(/\W/g, "_");
  return c.source.kind === "json"
    ? `const ${v} = res.json("${c.source.selector}");`
    : `const ${v} = res.html().find('input[name="${c.source.selector}"]').attr("value");`;
}

module.exports = { hostMatches, templatePath, endpoints, correlations, k6Extract, bodyText };
