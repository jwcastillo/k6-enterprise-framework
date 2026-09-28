/**
 * T-134: CLI authentication and bot command authorization
 *
 * Node.js context only (bin/) — DO NOT import from k6 scripts.
 *
 * Provides:
 * - K6_AUTH_TOKEN validation for shared/CI environments (CHK-SEC-034)
 * - Bot command identity verification before execution (CHK-SEC-032)
 * - HTML report XSS guard — verifies no inline <script> beyond Chart.js (CHK-SEC-035)
 */

const crypto = require("crypto") as typeof import("crypto");
const fs = require("fs") as typeof import("fs");

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum token length for K6_AUTH_TOKEN */
const MIN_TOKEN_LENGTH = 32;

/** Expected prefix for framework auth tokens */
const AUTH_TOKEN_PREFIX = "k6tok_";

/**
 * Per-process random key used for HMAC-based constant-time token comparison (CR-03).
 * Generated once at module load so the same key is reused for all comparisons within
 * a process but never exposed outside it.
 */
const HMAC_COMPARISON_KEY: Buffer = crypto.randomBytes(32);

// ── CLI Authentication (CHK-SEC-034) ─────────────────────────────────────────

export interface CliAuthResult {
  authenticated: boolean;
  userId: string;
  reason?: string;
}

/**
 * Validate the K6_AUTH_TOKEN environment variable.
 *
 * In shared or multi-user environments, set K6_AUTH_TOKEN to a shared
 * secret so that only authorized callers can execute tests.
 *
 * If K6_AUTH_TOKEN is not set, authentication is skipped (single-user / local dev).
 * If K6_AUTH_TOKEN is set, the provided token must match.
 *
 * @param providedToken - Token from --auth-token CLI flag or K6_AUTH_TOKEN env var
 * @returns CliAuthResult with authenticated flag and resolved userId
 */
export function validateCliAuth(providedToken?: string): CliAuthResult {
  const expectedToken = process.env["K6_AUTH_TOKEN"];

  // No token configured — permissive mode (local dev / single user)
  if (!expectedToken) {
    const userId = process.env["K6_USER"] ?? process.env["USER"] ?? "anonymous";
    return { authenticated: true, userId };
  }

  if (!providedToken) {
    return {
      authenticated: false,
      userId: "anonymous",
      reason:
        "K6_AUTH_TOKEN is required in this environment. " +
        "Pass it via --auth-token or set K6_AUTH_TOKEN env var.",
    };
  }

  if (providedToken.length < MIN_TOKEN_LENGTH) {
    return {
      authenticated: false,
      userId: "anonymous",
      reason: `Auth token is too short (min ${MIN_TOKEN_LENGTH} characters).`,
    };
  }

  // Constant-time comparison to prevent timing attacks (CR-03: HMAC-based, length-independent)
  // Using HMAC with a per-process random key normalises both tokens to the same digest
  // length before timingSafeEqual, so wrong-length tokens take the same code path as
  // wrong-content tokens and do not leak expected token length via timing.
  const hmacKey = HMAC_COMPARISON_KEY;
  const expectedHmac = crypto.createHmac("sha256", hmacKey).update(expectedToken).digest();
  const providedHmac = crypto.createHmac("sha256", hmacKey).update(providedToken).digest();

  let match = false;
  try {
    match = crypto.timingSafeEqual(expectedHmac, providedHmac);
  } catch {
    match = false;
  }

  if (!match) {
    return {
      authenticated: false,
      userId: "anonymous",
      reason: "Invalid auth token.",
    };
  }

  // Extract user identity from token prefix if using k6tok_{userId}_{random} format
  const userId = parseUserFromToken(providedToken) ?? process.env["K6_USER"] ?? "ci-runner";
  return { authenticated: true, userId };
}

/**
 * Parse userId from a k6tok_{userId}_{random} formatted token.
 * Returns null for opaque tokens.
 */
function parseUserFromToken(token: string): string | null {
  if (!token.startsWith(AUTH_TOKEN_PREFIX)) return null;
  const rest = token.slice(AUTH_TOKEN_PREFIX.length);
  const parts = rest.split("_");
  if (parts.length >= 2) {
    // userId is everything except the last segment (the random suffix)
    return (
      parts
        .slice(0, -1)
        .join("_")
        .replace(/[^a-zA-Z0-9_.@-]/g, "")
        .slice(0, 64) || null
    );
  }
  return null;
}

// ── Bot command authorization (CHK-SEC-032) ───────────────────────────────────

export interface BotCommandContext {
  /** Identity of the user invoking the bot command (e.g. Slack user ID) */
  userId: string;
  /** The command being invoked */
  command: string;
  /** Signing secret to verify the request comes from the trusted bot platform */
  signingSecret?: string;
  /** Request timestamp (Unix seconds) — used to prevent replay attacks */
  timestamp?: number;
  /** HMAC signature from the bot platform header */
  signature?: string;
  /** Raw request body (for HMAC verification) */
  rawBody?: string;
}

export interface BotAuthResult {
  authorized: boolean;
  userId: string;
  reason?: string;
}

/** Maximum age of a bot request before it is rejected (5 minutes) */
const MAX_REQUEST_AGE_SECS = 300;

/**
 * Authorize a bot command invocation.
 *
 * Verifies:
 * 1. Request is not a replay (timestamp within 5 minutes)
 * 2. HMAC signature matches (if signingSecret + rawBody provided)
 * 3. userId is non-empty and properly formatted
 *
 * @param ctx - Bot command context with identity and optional HMAC fields
 * @returns BotAuthResult
 */
export function authorizeBotCommand(ctx: BotCommandContext): BotAuthResult {
  // 1. Validate userId presence and format
  if (!ctx.userId || ctx.userId.trim().length === 0) {
    return {
      authorized: false,
      userId: "anonymous",
      reason: "Bot command rejected: missing user identity.",
    };
  }
  const sanitizedUserId = ctx.userId.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 128);
  if (!sanitizedUserId) {
    return {
      authorized: false,
      userId: "anonymous",
      reason: "Bot command rejected: invalid user identity format.",
    };
  }

  // 2. Replay protection — reject stale requests
  if (ctx.timestamp !== undefined) {
    const ageSecs = Math.floor(Date.now() / 1000) - ctx.timestamp;
    if (Math.abs(ageSecs) > MAX_REQUEST_AGE_SECS) {
      return {
        authorized: false,
        userId: sanitizedUserId,
        reason: `Bot command rejected: request is too old (${ageSecs}s). Max age: ${MAX_REQUEST_AGE_SECS}s.`,
      };
    }
  }

  // SEC-04: HMAC fail-closed — if signingSecret configured, all three fields required
  if (ctx.signingSecret && (!ctx.rawBody || !ctx.signature || !ctx.timestamp)) {
    const missing: string[] = [];
    if (!ctx.rawBody) missing.push("rawBody");
    if (!ctx.signature) missing.push("signature");
    if (ctx.timestamp === undefined || ctx.timestamp === null) missing.push("timestamp");
    return {
      authorized: false,
      userId: sanitizedUserId,
      reason:
        `Bot command rejected: HMAC required but missing field(s): ${missing.join(", ")}. ` +
        `When signingSecret is configured, rawBody, signature, and timestamp are mandatory.`,
    };
  }

  // 3. HMAC signature verification (e.g. Slack signing secret pattern)
  if (ctx.signingSecret && ctx.rawBody && ctx.signature && ctx.timestamp) {
    const baseString = `v0:${ctx.timestamp}:${ctx.rawBody}`;
    const expected =
      "v0=" + crypto.createHmac("sha256", ctx.signingSecret).update(baseString).digest("hex");

    // WR-01: Apply the same HMAC-then-timingSafeEqual normalization as validateCliAuth
    // (CR-03). Both the expected and received signatures are HMACed with the per-process
    // random key so they are normalized to the same digest length before the constant-time
    // comparison — wrong-length submissions take the same code path as wrong-content
    // submissions and cannot leak the expected signature length via timing.
    const hmacKey = HMAC_COMPARISON_KEY;
    const expectedHmac = crypto.createHmac("sha256", hmacKey).update(expected).digest();
    const receivedHmac = crypto.createHmac("sha256", hmacKey).update(ctx.signature).digest();

    let signatureValid = false;
    try {
      signatureValid = crypto.timingSafeEqual(expectedHmac, receivedHmac);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      return {
        authorized: false,
        userId: sanitizedUserId,
        reason: "Bot command rejected: HMAC signature mismatch.",
      };
    }
  }

  return { authorized: true, userId: sanitizedUserId };
}

// ── HTML report XSS guard (CHK-SEC-035) ──────────────────────────────────────

/**
 * SHA-256 hashes of permitted inline <script> bodies in HTML reports (CR-01).
 *
 * The HTML report is the k6 web-dashboard export (K6_WEB_DASHBOARD_EXPORT). k6
 * already separates code from data: the run data travels in
 * `<script id="data" type="application/json; charset=utf-8; gzip; base64">`
 * (a non-executable data block, skipped below), and the only executable inline
 * script is the dashboard application, which is identical on every run for a
 * given dashboard bundle. So the hash does not change per run; it changes when
 * k6 ships a new dashboard bundle (as it did between k6 v1.x and v2.x).
 *
 * How to add a new hash after a k6 upgrade (review the bundle first):
 *   1. Run any scenario; the report lands as html-report-*.html.quarantined.
 *   2. node -e "const c=require('crypto'),fs=require('fs');
 *        const re=/<script([^>]*)>([\s\S]*?)<\/script>/gi;
 *        const html=fs.readFileSync('report.html','utf-8');
 *        let m; while((m=re.exec(html))!==null){
 *          const trimmed=m[2].trim(); if(!trimmed) continue;
 *          const hash=c.createHash('sha256').update(trimmed).digest('hex');
 *          console.log(hash, m[1].trim() || '(no attrs)', trimmed.length,'chars');
 *        }"
 *   3. Append the hash of the type="module" script to the Set below, with the
 *      k6 versions it was verified on. test/core/report-xss-guard.test.ts runs
 *      the installed k6 and fails until you do.
 */
const ALLOWED_INLINE_SCRIPT_HASHES = new Set<string>([
  // SHA-256("") — safety net (empty trimmed bodies never reach this check)
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  // k6 web-dashboard v1.x: bundled dashboard application (~147 KB, type="module")
  "ffa09d2736d152c3f9f8f6d64bd9feaab7023cd166f7226decd08278759b916b",
  // k6 web-dashboard v1.x: DOM helper script (~2.3 KB, no type attribute)
  "c6241047be3f780d041aff457bf49d87cd41f5629c74d6f4f611537da65b54bf",
  // k6 web-dashboard v2.x: bundled dashboard application (150732 chars, type="module").
  // Verified on k6 v2.2.0 (darwin/amd64) and v2.3.0 (darwin/arm64). v2.x has no DOM helper.
  "288d3fbb023a5e5f5aa0d0898150785aa85c138fb0c78255ec1baf75a080a73d",
]);

/**
 * JavaScript MIME type essences (WHATWG MIME Sniffing §4.6). A <script> whose
 * type matches one of these (case-insensitive, no parameters) is executed by
 * browsers, so all of them must be audited — not only text/javascript.
 */
const JS_MIME_ESSENCES = new Set<string>([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/**
 * Read one attribute from the raw attribute string of a start tag. Matches the
 * attribute name exactly (so `data-type` is not `type`) and returns the first
 * occurrence, as browsers do. Returns undefined when absent.
 */
function readTagAttribute(attrs: string, name: string): string | undefined {
  const re = new RegExp(
    `(?:^|[\\s/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))|(?:^|[\\s/])${name}(?=[\\s/]|$)`,
    "i"
  );
  const m = re.exec(attrs);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3] ?? "";
}

/**
 * Does the browser execute a <script> with this type attribute? Mirrors the
 * HTML "prepare the script element" rules: absent/empty type, a JavaScript MIME
 * essence, or "module" execute; "importmap" and "speculationrules" are not data
 * blocks either (they change how code loads), so they are treated as executable.
 * Anything else (application/json, …; gzip; base64, etc.) is an inert data block.
 */
function isExecutableScriptType(type: string | undefined): boolean {
  if (type === undefined) return true;
  const t = type.trim().toLowerCase();
  if (t === "") return true;
  return JS_MIME_ESSENCES.has(t) || t === "module" || t === "importmap" || t === "speculationrules";
}

/**
 * Verify that an HTML report file contains no unauthorized inline scripts.
 *
 * Inline <script> blocks are validated against a SHA-256 hash allowlist (CR-01).
 * External <script src="..."> blocks are allowed only for Chart.js paths.
 * Non-executable data blocks (e.g. the k6 dashboard's JSON payload) are skipped.
 * All other script content is rejected as a violation.
 *
 * @param htmlPath - Absolute path to the HTML report file
 * @returns Array of violation strings; empty array means the report is clean
 */
export function auditHtmlReportForXss(htmlPath: string): string[] {
  const violations: string[] = [];

  if (!fs.existsSync(htmlPath)) return violations;

  const content = fs.readFileSync(htmlPath, "utf-8");

  // Find all <script ...> blocks
  const scriptTagRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptTagRe.exec(content)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";

    // External src= scripts (exact `src` attribute — `data-src` does not count)
    const src = readTagAttribute(attrs, "src");
    if (src !== undefined && src !== "") {
      // Allow only CDN-hosted Chart.js (or relative path for offline bundle)
      if (
        !src.includes("chart.js") &&
        !src.includes("chartjs") &&
        !src.startsWith("./") &&
        !src.startsWith("../")
      ) {
        violations.push(`Unauthorized external script src: ${src}`);
      }
      continue;
    }

    // CR-01: skip non-executable data blocks (application/json, …; gzip; base64).
    // Everything the browser would run — any JS MIME essence, module, importmap —
    // goes through the hash allowlist.
    if (!isExecutableScriptType(readTagAttribute(attrs, "type"))) continue;

    // Inline script content — hash-based allowlist (CR-01: replaces bypassable substring heuristic)
    const trimmed = body.trim();
    if (trimmed.length === 0) continue;

    const scriptHash = crypto.createHash("sha256").update(trimmed).digest("hex");

    if (!ALLOWED_INLINE_SCRIPT_HASHES.has(scriptHash)) {
      violations.push(
        `Unauthorized inline script (sha256:${scriptHash.slice(0, 16)}..., ${trimmed.length} chars). ` +
          `Only allowlisted scripts are permitted. ` +
          `If this is the k6 dashboard after a k6 upgrade, review it and add sha256:${scriptHash} ` +
          `to ALLOWED_INLINE_SCRIPT_HASHES in cli-auth.ts.`
      );
    }
  }

  return violations;
}
