/**
 * Unit tests for WebhookValidator (SEC-05)
 *
 * Tests cover:
 * - validateWebhookUrl: scheme validation (https only by default)
 * - validateWebhookUrl: deny-list IPv4 CIDRs (loopback, link-local, RFC1918)
 * - validateWebhookUrl: deny-list IPv6 loopback and private ranges
 * - validateWebhookUrl: allow-list (K6_WEBHOOK_ALLOWED_HOSTS)
 * - validateWebhookUrl: overrides (K6_WEBHOOK_ALLOW_PRIVATE, K6_WEBHOOK_ALLOW_HTTP)
 * - validateWebhookUrl: edge cases — non-private IPv4 must pass
 * - validateWebhookUrl: malformed URL handling
 * - assertWebhookAllowed: throws on denied URL, silent on allowed URL
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateWebhookUrl, assertWebhookAllowed } from "../../src/integrations/webhook-validator";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("validateWebhookUrl", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset __ENV — critical because validator reads __ENV["K6_WEBHOOK_*"]
    (globalThis as Record<string, unknown>).__ENV = {};
    // Spy on console.warn so warn-emitting tests can assert
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // ── Deny-list only mode (no allow-list configured) ────────────────────────

  describe("deny-list-only mode", () => {
    it("allows https://hooks.slack.com/services/T00/B00/abc (Test 1)", () => {
      const result = validateWebhookUrl("https://hooks.slack.com/services/T00/B00/abc");
      expect(result.allowed).toBe(true);
    });

    it("allows https://api.pagerduty.com/webhooks (public host, deny-list-only mode)", () => {
      const result = validateWebhookUrl("https://api.pagerduty.com/webhooks");
      expect(result.allowed).toBe(true);
    });
  });

  // ── Scheme validation ─────────────────────────────────────────────────────

  describe("scheme validation", () => {
    it("rejects http:// when K6_WEBHOOK_ALLOW_HTTP not set (Test 2)", () => {
      const result = validateWebhookUrl("http://hooks.slack.com/services/T00/B00/abc");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/scheme|https/i);
    });

    it("allows http:// when K6_WEBHOOK_ALLOW_HTTP=true and host not in deny-list (Test 3)", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_WEBHOOK_ALLOW_HTTP: "true" };
      const result = validateWebhookUrl("http://hooks.slack.com/services/T00/B00/abc");
      expect(result.allowed).toBe(true);
    });

    it("emits console.warn containing K6_WEBHOOK_ALLOW_HTTP when http:// override active (Test 14)", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_WEBHOOK_ALLOW_HTTP: "true" };
      validateWebhookUrl("http://hooks.slack.com/services/T00/B00/abc");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/K6_WEBHOOK_ALLOW_HTTP/));
    });

    it("still rejects http:// to private CIDR even with K6_WEBHOOK_ALLOW_HTTP=true", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_WEBHOOK_ALLOW_HTTP: "true" };
      const result = validateWebhookUrl("http://169.254.169.254/latest/meta-data/");
      expect(result.allowed).toBe(false);
    });
  });

  // ── Deny-list: cloud metadata / link-local ────────────────────────────────

  describe("deny-list (cloud metadata 169.254.0.0/16)", () => {
    it("rejects https://169.254.169.254/latest/meta-data/ (Test 4)", () => {
      const result = validateWebhookUrl("https://169.254.169.254/latest/meta-data/");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/169\.254|metadata|private/i);
    });

    it("rejects https://169.254.0.1/ (link-local range boundary)", () => {
      const result = validateWebhookUrl("https://169.254.0.1/");
      expect(result.allowed).toBe(false);
    });
  });

  // ── Deny-list: loopback ───────────────────────────────────────────────────

  describe("deny-list (loopback)", () => {
    it("rejects https://127.0.0.1/foo (Test 5)", () => {
      const result = validateWebhookUrl("https://127.0.0.1/foo");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/loopback|127|localhost/i);
    });

    it("rejects https://localhost/foo (Test 6)", () => {
      const result = validateWebhookUrl("https://localhost/foo");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/loopback|localhost/i);
    });

    it("rejects https://127.255.255.255/ (127.0.0.0/8 boundary)", () => {
      const result = validateWebhookUrl("https://127.255.255.255/");
      expect(result.allowed).toBe(false);
    });
  });

  // ── Deny-list: RFC1918 ───────────────────────────────────────────────────

  describe("deny-list (RFC1918 IPv4)", () => {
    it("rejects https://10.0.0.5/x (Test 7)", () => {
      const result = validateWebhookUrl("https://10.0.0.5/x");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/private|10\.0\.0/i);
    });

    it("rejects https://172.16.0.5/x (Test 8 — 172.16.0.0/12 start)", () => {
      const result = validateWebhookUrl("https://172.16.0.5/x");
      expect(result.allowed).toBe(false);
    });

    it("rejects https://172.31.0.5/x (172.16.0.0/12 end)", () => {
      const result = validateWebhookUrl("https://172.31.0.5/x");
      expect(result.allowed).toBe(false);
    });

    it("rejects https://192.168.1.5/x (Test 8 — 192.168.0.0/16)", () => {
      const result = validateWebhookUrl("https://192.168.1.5/x");
      expect(result.allowed).toBe(false);
    });

    it("rejects https://0.0.0.0/ (special broadcast)", () => {
      const result = validateWebhookUrl("https://0.0.0.0/");
      expect(result.allowed).toBe(false);
    });
  });

  // ── Deny-list: IPv6 ──────────────────────────────────────────────────────

  describe("deny-list (IPv6)", () => {
    it("rejects https://[::1]/foo (Test 12 — IPv6 loopback in brackets)", () => {
      const result = validateWebhookUrl("https://[::1]/foo");
      expect(result.allowed).toBe(false);
    });

    it("rejects https://[fe80::1]/foo (link-local IPv6)", () => {
      const result = validateWebhookUrl("https://[fe80::1]/foo");
      expect(result.allowed).toBe(false);
    });

    it("rejects https://[fc00::1]/foo (unique local IPv6 fc00::/7)", () => {
      const result = validateWebhookUrl("https://[fc00::1]/foo");
      expect(result.allowed).toBe(false);
    });

    it("rejects https://[fd12:3456:789a::1]/foo (unique local IPv6 fd00::/8)", () => {
      const result = validateWebhookUrl("https://[fd12:3456:789a::1]/foo");
      expect(result.allowed).toBe(false);
    });
  });

  // ── Edge cases: non-private IPv4 MUST pass (over-blocking regression guard) ─

  describe("edge cases (non-private IPv4 must pass)", () => {
    it.each([
      "172.15.0.1", // 172.15 is NOT in RFC1918 172.16/12 range
      "172.32.0.1", // 172.32 is NOT in RFC1918 172.16/12 range
      "11.0.0.1", // 11.0 is NOT private (only 10.0/8 is)
      "8.8.8.8", // public DNS
    ])("allows https://%s/x (non-private, not in any deny-list CIDR)", (ip) => {
      const result = validateWebhookUrl(`https://${ip}/x`);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Override: K6_WEBHOOK_ALLOW_PRIVATE ────────────────────────────────────

  describe("overrides (K6_WEBHOOK_ALLOW_PRIVATE)", () => {
    it("allows private target when K6_WEBHOOK_ALLOW_PRIVATE=true (Test 9)", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_WEBHOOK_ALLOW_PRIVATE: "true" };
      const result = validateWebhookUrl("https://169.254.169.254/latest/meta-data/");
      expect(result.allowed).toBe(true);
    });

    it("emits console.warn containing K6_WEBHOOK_ALLOW_PRIVATE when override active (Test 15)", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_WEBHOOK_ALLOW_PRIVATE: "true" };
      validateWebhookUrl("https://169.254.169.254/latest/meta-data/");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/K6_WEBHOOK_ALLOW_PRIVATE/));
    });

    it("console.warn includes the host when K6_WEBHOOK_ALLOW_PRIVATE=true (Test 15 extended)", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_WEBHOOK_ALLOW_PRIVATE: "true" };
      validateWebhookUrl("https://10.0.0.5/x");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/10\.0\.0\.5/));
    });
  });

  // ── Allow-list (K6_WEBHOOK_ALLOWED_HOSTS) ────────────────────────────────

  describe("allow-list", () => {
    it("allows host in K6_WEBHOOK_ALLOWED_HOSTS (Test 10)", () => {
      (globalThis as Record<string, unknown>).__ENV = {
        K6_WEBHOOK_ALLOWED_HOSTS: "hooks.slack.com,api.pagerduty.com",
      };
      const result = validateWebhookUrl("https://hooks.slack.com/services/T00/B00/abc");
      expect(result.allowed).toBe(true);
    });

    it("rejects host NOT in K6_WEBHOOK_ALLOWED_HOSTS with reason matching /allow-list/i (Test 10)", () => {
      (globalThis as Record<string, unknown>).__ENV = {
        K6_WEBHOOK_ALLOWED_HOSTS: "hooks.slack.com,api.pagerduty.com",
      };
      const result = validateWebhookUrl("https://evil.com/payload");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/allow-list/i);
    });

    it("allow-list check is case-insensitive for host matching", () => {
      (globalThis as Record<string, unknown>).__ENV = {
        K6_WEBHOOK_ALLOWED_HOSTS: "HOOKS.SLACK.COM",
      };
      const result = validateWebhookUrl("https://hooks.slack.com/services/T00/B00/abc");
      expect(result.allowed).toBe(true);
    });

    it("allow-list trims whitespace around host entries", () => {
      (globalThis as Record<string, unknown>).__ENV = {
        K6_WEBHOOK_ALLOWED_HOSTS: " hooks.slack.com , api.example.com ",
      };
      const result = validateWebhookUrl("https://hooks.slack.com/services/x");
      expect(result.allowed).toBe(true);
    });
  });

  // ── Malformed URLs ────────────────────────────────────────────────────────

  describe("malformed URLs", () => {
    it("rejects non-URL string with reason matching /parse|invalid URL|malformed/i (Test 11)", () => {
      const result = validateWebhookUrl("not-a-url");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/parse|invalid URL|malformed/i);
    });

    it("rejects empty string", () => {
      const result = validateWebhookUrl("");
      expect(result.allowed).toBe(false);
    });

    it("rejects just a hostname without scheme", () => {
      const result = validateWebhookUrl("hooks.slack.com/path");
      expect(result.allowed).toBe(false);
    });
  });
});

// ── assertWebhookAllowed ──────────────────────────────────────────────────────

describe("assertWebhookAllowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("throws when validateWebhookUrl returns allowed=false (Test 13)", () => {
    expect(() => assertWebhookAllowed("https://169.254.169.254/latest/meta-data/")).toThrow();
  });

  it("error.message contains the rejected host literal — 169.254 visible (Test 16)", () => {
    expect(() => assertWebhookAllowed("https://169.254.169.254/latest/meta-data/")).toThrowError(
      /169\.254/
    );
  });

  it("does not throw when allowed=true — https://hooks.slack.com/... (Test 17)", () => {
    expect(() =>
      assertWebhookAllowed("https://hooks.slack.com/services/T00/B00/abc")
    ).not.toThrow();
  });

  it("throws for http:// scheme without override", () => {
    expect(() => assertWebhookAllowed("http://hooks.slack.com/services/T00/B00/abc")).toThrow();
  });

  it("throws for localhost", () => {
    expect(() => assertWebhookAllowed("https://localhost/payload")).toThrow();
  });

  it("error thrown is an instance of Error", () => {
    expect(() => assertWebhookAllowed("https://127.0.0.1/foo")).toThrowError(Error);
  });
});
