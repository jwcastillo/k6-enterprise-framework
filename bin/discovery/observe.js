// bin/discovery/observe.js — what the decider is allowed to see of the current page.
//
// collectCandidates() runs inside the browser; everything else is pure Node so it can be
// unit tested. The raw observation never leaves the machine: deciders only get the output
// of redactObservation().

"use strict";

const MAX_CANDIDATES = 120;
const MAX_TEXT = 80;

/** Default --deny-text: elements whose name or text matches are never offered to the decider. */
const DEFAULT_DENY =
  /\b(pay|pagar|comprar|buy|purchase|checkout|confirm order|place order|delete|eliminar|borrar|unsubscribe|close account)\b/i;

/**
 * Runs in the page (page.evaluate). Lists visible interactive elements in DOM order, tags each
 * with data-discover-idx so it can be located again, and reports iframes / shadow roots that
 * the explorer does not enter.
 */
function collectCandidates(max) {
  const SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=tab]",
    "[role=menuitem]", "[role=option]", "[role=combobox]", "[role=switch]", "[contenteditable=true]",
  ].join(",");
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const textOf = (id) => clean((document.getElementById(id) || {}).textContent);

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(" ")[0];
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (["submit", "button", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return "generic";
  };

  // Approximation of the accessible name; the explorer verifies it against getByRole.
  const nameOf = (el) => {
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(/\s+/).map(textOf).join(" "));
    if (el.labels && el.labels.length) return clean([...el.labels].map((l) => l.textContent).join(" "));
    const tag = el.tagName.toLowerCase();
    if (tag === "input" && ["submit", "button", "reset"].includes(el.type)) return clean(el.value);
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return clean(el.getAttribute("title") || el.getAttribute("placeholder"));
    }
    return clean(el.textContent) || clean(el.getAttribute("title"));
  };

  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };

  document.querySelectorAll("[data-discover-idx]").forEach((el) => el.removeAttribute("data-discover-idx"));
  const all = [...document.querySelectorAll(SELECTOR)].filter(visible);
  const candidates = all.slice(0, max).map((el, index) => {
    el.setAttribute("data-discover-idx", String(index));
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? (el.type || "text").toLowerCase() : "";
    const candidate = {
      index,
      role: roleOf(el),
      name: nameOf(el).slice(0, 80),
      text: clean(el.innerText || el.textContent).slice(0, 80),
      tag,
      type,
      disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
    };
    if (tag === "input" || tag === "textarea" || tag === "select") {
      // Raw value stays in Node; maskValues() replaces it before anything is shared.
      candidate.value = type === "password" ? (el.value ? "<set>" : "") : el.value;
      if (type === "checkbox" || type === "radio") candidate.checked = el.checked;
      if (tag === "select") candidate.options = [...el.options].slice(0, 10).map((o) => clean(o.text).slice(0, 40));
    }
    if (tag === "a") candidate.href = el.getAttribute("href");
    return candidate;
  });

  let shadowRoots = 0;
  for (const el of [...document.querySelectorAll("*")].slice(0, 5000)) if (el.shadowRoot) shadowRoots++;

  return {
    candidates,
    total: all.length,
    iframes: document.querySelectorAll("iframe,frame").length,
    shadowRoots,
  };
}

/** Is this candidate denied by --deny-text? Checked on both accessible name and visible text. */
function isDenied(candidate, denyRe) {
  return !!denyRe && (denyRe.test(candidate.name || "") || denyRe.test(candidate.text || ""));
}

/**
 * Replace raw form values with the --data key they came from ({{email}}), or a length hint.
 * Values typed by the explorer are therefore recognisable without being disclosed.
 */
function maskValues(candidates, data) {
  const byValue = new Map(Object.entries(data || {}).map(([k, v]) => [String(v), k]));
  return candidates.map((c) => {
    if (c.value === undefined) return c;
    const { value, ...rest } = c;
    const filled = value !== "";
    const masked = !filled ? "" : byValue.has(value) ? `{{${byValue.get(value)}}}` : `<${value.length} chars>`;
    return { ...rest, filled, value: masked };
  });
}

/**
 * Redact free text before it reaches a model: known --data values become {{key}}, then JWTs,
 * emails, long opaque tokens and any run of 4+ digits are replaced.
 */
function redact(text, data) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  // Longest first so a value that contains another is replaced whole
  const entries = Object.entries(data || {})
    .filter(([, v]) => String(v).length >= 3)
    .sort((a, b) => String(b[1]).length - String(a[1]).length);
  for (const [key, value] of entries) out = out.split(String(value)).join(`{{${key}}}`);
  return out
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g, "<token>")
    .replace(/\d{4,}/g, (m, at, all) => (isPort(m, at, all) ? m : "<n>"));
}

/** A URL port (":8080/") is not personal data; keep it readable. */
const isPort = (m, at, all) => all[at - 1] === ":" && m.length <= 5 && /^([/?#]|$)/.test(all.charAt(at + m.length));

/** The only view of the page a decider ever receives. Cookies and headers are never part of it. */
function redactObservation(observation, data) {
  const r = (s) => redact(s, data);
  return {
    url: r(observation.url),
    title: r(observation.title),
    iframes: observation.iframes,
    shadowRoots: observation.shadowRoots,
    truncated: observation.truncated,
    deniedCount: observation.deniedCount,
    candidates: observation.candidates.map((c) => {
      const out = { ...c, name: r(c.name), text: c.text === c.name ? undefined : r(c.text) };
      if (c.href) out.href = r(c.href);
      if (c.options) out.options = c.options.map(r);
      if (!out.text) delete out.text;
      return out;
    }),
  };
}

/** Build the observation of the current page: collect, mask, drop denied candidates. */
async function observe(page, { data, denyRe, max = MAX_CANDIDATES } = {}) {
  const raw = await page.evaluate(collectCandidates, max);
  const masked = maskValues(raw.candidates, data);
  const allowed = masked.filter((c) => !isDenied(c, denyRe));
  return {
    url: page.url(),
    title: (await page.title()).slice(0, MAX_TEXT),
    iframes: raw.iframes,
    shadowRoots: raw.shadowRoots,
    truncated: raw.total > max,
    deniedCount: masked.length - allowed.length,
    // Local only (guardrail accounting); redactObservation() does not pass it on
    deniedNames: masked.filter((c) => isDenied(c, denyRe)).map((c) => c.name || c.text),
    candidates: allowed,
  };
}

/** One-line description used in prompts, Jev criteria and logs. */
function describeCandidate(c) {
  let s = `${c.role} "${c.name || c.text || c.tag}"`;
  if (c.type && !["text", "submit", "button"].includes(c.type)) s += ` (${c.type})`;
  if (c.value !== undefined) s += c.filled ? ` [value: ${c.value}]` : " [empty]";
  if (c.checked !== undefined) s += c.checked ? " [checked]" : " [unchecked]";
  if (c.options) s += ` options: ${c.options.join(" | ")}`;
  if (c.disabled) s += " [disabled]";
  return s;
}

module.exports = {
  DEFAULT_DENY,
  MAX_CANDIDATES,
  collectCandidates,
  isDenied,
  maskValues,
  redact,
  redactObservation,
  observe,
  describeCandidate,
};
