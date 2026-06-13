/**
 * SEC-05: Webhook SSRF defense — allow-list + private-CIDR deny-list
 *
 * Runs in k6 goja runtime.
 * MUST NOT import Node.js modules (no fs, net, path, url, process).
 *
 * Provides zero-dependency webhook URL validation with:
 * - Scheme enforcement (https only by default)
 * - Deny-list of private/metadata CIDRs (always active unless overridden)
 * - Optional allow-list via K6_WEBHOOK_ALLOWED_HOSTS env var
 * - Override paths: K6_WEBHOOK_ALLOW_PRIVATE, K6_WEBHOOK_ALLOW_HTTP
 *
 * Usage:
 *   const result = validateWebhookUrl("https://hooks.slack.com/...");
 *   if (!result.allowed) throw new Error(result.reason);
 *
 *   // Or use the throwing wrapper:
 *   assertWebhookAllowed("https://hooks.slack.com/...");
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Result returned by validateWebhookUrl — never throws */
export interface WebhookValidationResult {
  allowed: boolean;
  reason?: string;
}

// ── IPv4 helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a string as an IPv4 address.
 * Returns [a, b, c, d] octets if valid, null otherwise.
 * Only accepts dotted-decimal notation (no leading zeros handled specially).
 */
function parseIPv4(host: string): [number, number, number, number] | null {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return null;
  }
  const parts = host.split(".").map(Number);
  if (parts.length !== 4) return null;
  for (const octet of parts) {
    if (octet > 255) return null;
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

/**
 * Check if an IPv4 address is in a private/denied CIDR range.
 * Returns a category string if denied, null if allowed.
 */
function checkPrivateIPv4(octets: [number, number, number, number]): string | null {
  const [a, b] = octets;

  // 127.0.0.0/8 — loopback
  if (a === 127) {
    return "loopback 127.0.0.0/8";
  }

  // 169.254.0.0/16 — link-local / cloud metadata (AWS, GCP, Azure)
  if (a === 169 && b === 254) {
    return "cloud metadata 169.254.0.0/16";
  }

  // 10.0.0.0/8 — RFC1918 private
  if (a === 10) {
    return "private RFC1918 10.0.0.0/8";
  }

  // 172.16.0.0/12 — RFC1918 private (172.16.x.x to 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) {
    return "private RFC1918 172.16.0.0/12";
  }

  // 192.168.0.0/16 — RFC1918 private
  if (a === 192 && b === 168) {
    return "private RFC1918 192.168.0.0/16";
  }

  // 100.64.0.0/10 — RFC 6598 CGNAT / Shared Address Space (WR-07)
  // Used by cloud providers and ISPs for carrier-grade NAT; some Kubernetes CNI
  // configurations also assign pod IPs in this range.
  if (a === 100 && b >= 64 && b <= 127) {
    return "CGNAT RFC6598 100.64.0.0/10";
  }

  return null;
}

// ── IPv6 helpers ──────────────────────────────────────────────────────────────

/**
 * Strip brackets from an IPv6 hostname like [::1] → ::1.
 * The WHATWG URL parser sets hostname to [::1] for IPv6 addresses.
 */
function stripIPv6Brackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

/**
 * Check if an IPv6 address string is in a private/denied range.
 * Returns a category string if denied, null if allowed.
 * Handles bare addresses and bracket-wrapped addresses.
 */
function checkPrivateIPv6(host: string): string | null {
  const addr = stripIPv6Brackets(host).toLowerCase();

  // ::1 — loopback
  if (addr === "::1") {
    return "IPv6 loopback ::1";
  }

  // fe80::/10 — link-local
  if (addr.startsWith("fe80")) {
    return "IPv6 link-local fe80::/10";
  }

  // fc00::/7 — unique local (covers fc00:: and fd00::)
  if (addr.startsWith("fc") || addr.startsWith("fd")) {
    return "IPv6 unique local fc00::/7";
  }

  return null;
}

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * Validate a webhook URL against scheme requirements and SSRF deny-list.
 *
 * Pure function — never throws. Reads config from __ENV only (k6 goja runtime).
 *
 * Algorithm:
 * 1. Parse URL — malformed → denied
 * 2. Check scheme (https only unless K6_WEBHOOK_ALLOW_HTTP=true)
 * 3. Check deny-list (loopback, link-local, RFC1918, IPv6 private)
 *    unless K6_WEBHOOK_ALLOW_PRIVATE=true
 * 4. Check allow-list (K6_WEBHOOK_ALLOWED_HOSTS) if configured
 *
 * @param url - Webhook URL string to validate
 * @returns WebhookValidationResult with allowed flag and optional reason
 */
export function validateWebhookUrl(url: string): WebhookValidationResult {
  // Step 1: Parse the URL
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    const prefix = url.slice(0, 50);
    return {
      allowed: false,
      reason: `Invalid URL: failed to parse '${prefix}'`,
    };
  }

  // WR-02: resolve all __ENV reads through a single guarded accessor so the
  // function is safe in both k6 goja runtime (where __ENV is a global) and plain
  // Node.js contexts (where __ENV may not be declared at all).
  const env =
    ((globalThis as Record<string, unknown>).__ENV as Record<string, string> | undefined) ?? {};

  // Step 2: Scheme check
  const allowHttp = env["K6_WEBHOOK_ALLOW_HTTP"] === "true";

  if (u.protocol !== "https:") {
    if (!allowHttp) {
      return {
        allowed: false,
        reason:
          `Webhook scheme '${u.protocol}' not allowed (https required). ` +
          `Set K6_WEBHOOK_ALLOW_HTTP=true to override.`,
      };
    }
    // Allow HTTP with visible warning
    console.warn(
      `[webhook-validator] WARNING: K6_WEBHOOK_ALLOW_HTTP=true — accepting http:// target. Audit logged.`
    );
  }

  // Step 3: Deny-list check
  const hostname = u.hostname.toLowerCase();
  const allowPrivate = env["K6_WEBHOOK_ALLOW_PRIVATE"] === "true";

  let denyCategory: string | null = null;
  let denyHost = hostname;

  // Check exact-match denials
  if (hostname === "localhost" || hostname === "0.0.0.0") {
    denyCategory = hostname === "localhost" ? "loopback localhost" : "special 0.0.0.0";
    denyHost = hostname;
  }

  // Check IPv4 ranges
  if (!denyCategory) {
    const octets = parseIPv4(hostname);
    if (octets !== null) {
      denyCategory = checkPrivateIPv4(octets);
      denyHost = hostname;
    }
  }

  // Check IPv6 ranges (hostname may be [::1] or plain ::1 from URL parser)
  if (!denyCategory) {
    const ipv6Category = checkPrivateIPv6(hostname);
    if (ipv6Category !== null) {
      denyCategory = ipv6Category;
      denyHost = hostname;
    }
  }

  if (denyCategory !== null) {
    if (!allowPrivate) {
      return {
        allowed: false,
        reason:
          `Webhook target rejected: '${denyHost}' is in deny-list (${denyCategory}). ` +
          `Set K6_WEBHOOK_ALLOW_PRIVATE=true to override.`,
      };
    }
    // Allow private with visible warning
    console.warn(
      `[webhook-validator] WARNING: K6_WEBHOOK_ALLOW_PRIVATE=true — allowing private/metadata target '${denyHost}'. Audit logged.`
    );
  }

  // Step 4: Allow-list check
  const allowedHostsRaw = env["K6_WEBHOOK_ALLOWED_HOSTS"];
  if (allowedHostsRaw) {
    const allowedHosts = allowedHostsRaw
      .split(",")
      .map((h: string) => h.trim().toLowerCase())
      .filter((h: string) => h.length > 0);

    if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
      return {
        allowed: false,
        reason:
          `Webhook target rejected: '${hostname}' is not in K6_WEBHOOK_ALLOWED_HOSTS allow-list ` +
          `(configured hosts: ${allowedHosts.join(", ")}).`,
      };
    }
  }

  // All checks passed
  return { allowed: true };
}

// ── Throwing wrapper ──────────────────────────────────────────────────────────

/**
 * Assert that a webhook URL is allowed, throwing if not.
 *
 * Designed to integrate with notification-service.ts sendWithRetry() catch/backoff:
 * the thrown Error participates in the retry loop per CONTEXT D-17.
 *
 * @param url - Webhook URL string to validate
 * @throws Error with descriptive reason when URL is denied
 */
export function assertWebhookAllowed(url: string): void {
  const result = validateWebhookUrl(url);
  if (!result.allowed) {
    throw new Error(result.reason);
  }
}
