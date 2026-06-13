/**
 * Unit tests for CLI auth and bot command authorization (T-134, SEC-04)
 *
 * Covers:
 * - validateCliAuth: token validation logic
 * - authorizeBotCommand: HMAC fail-closed when signingSecret configured (SEC-04)
 * - Backwards compatibility: no-signingSecret path still returns authorized=true
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as nodeCrypto from "crypto";
import {
  validateCliAuth,
  authorizeBotCommand,
} from "../../src/core/cli-auth";
import type { BotCommandContext } from "../../src/core/cli-auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeValidHmac(secret: string, rawBody: string, timestamp: number): string {
  const baseString = `v0:${timestamp}:${rawBody}`;
  return "v0=" + nodeCrypto.createHmac("sha256", secret).update(baseString).digest("hex");
}

function makeCtx(overrides: Partial<BotCommandContext> = {}): BotCommandContext {
  return {
    userId: "alice",
    command: "run-test",
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("validateCliAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["K6_AUTH_TOKEN"];
    delete process.env["K6_USER"];
  });

  it("should return authenticated=true when no K6_AUTH_TOKEN configured", () => {
    const result = validateCliAuth();
    expect(result.authenticated).toBe(true);
  });

  it("should return authenticated=false when K6_AUTH_TOKEN configured and no token provided", () => {
    process.env["K6_AUTH_TOKEN"] = "k6tok_" + "a".repeat(32);
    const result = validateCliAuth(undefined);
    expect(result.authenticated).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("should return authenticated=true when provided token matches K6_AUTH_TOKEN", () => {
    const token = "k6tok_" + "a".repeat(32);
    process.env["K6_AUTH_TOKEN"] = token;
    const result = validateCliAuth(token);
    expect(result.authenticated).toBe(true);
  });
});

describe("authorizeBotCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── HMAC fail-closed when signingSecret set (SEC-04) ─────────────────────────

  describe("HMAC fail-closed when signingSecret set (SEC-04)", () => {
    it("should return authorized=false when signingSecret set but no rawBody/signature/timestamp", () => {
      const result = authorizeBotCommand(makeCtx({ signingSecret: "secret" }));
      expect(result.authorized).toBe(false);
      expect(result.userId).toBe("alice");
      expect(result.reason).toMatch(/HMAC required|rawBody|signature|timestamp missing/i);
    });

    it("should return authorized=false when signingSecret set but rawBody missing", () => {
      const ts = Math.floor(Date.now() / 1000);
      const result = authorizeBotCommand(makeCtx({
        signingSecret: "secret",
        signature: "v0=abc",
        timestamp: ts,
        // rawBody missing
      }));
      expect(result.authorized).toBe(false);
      expect(result.reason).toMatch(/HMAC required|rawBody|missing/i);
    });

    it("should return authorized=false when signingSecret set but signature missing", () => {
      const ts = Math.floor(Date.now() / 1000);
      const result = authorizeBotCommand(makeCtx({
        signingSecret: "secret",
        rawBody: "x",
        timestamp: ts,
        // signature missing
      }));
      expect(result.authorized).toBe(false);
      expect(result.reason).toMatch(/HMAC required|signature|missing/i);
    });

    it("should return authorized=false when signingSecret set but timestamp missing", () => {
      const result = authorizeBotCommand(makeCtx({
        signingSecret: "secret",
        rawBody: "x",
        signature: "v0=abc",
        // timestamp missing
      }));
      expect(result.authorized).toBe(false);
      expect(result.reason).toMatch(/HMAC required|timestamp|missing/i);
    });

    it("should return authorized=true when no signingSecret (backwards-compat)", () => {
      // No signingSecret — should work as before: authorized=true
      const result = authorizeBotCommand(makeCtx());
      expect(result.authorized).toBe(true);
      expect(result.userId).toBe("alice");
    });

    it("should return authorized=false when all fields present but bad signature", () => {
      const ts = Math.floor(Date.now() / 1000);
      const result = authorizeBotCommand(makeCtx({
        signingSecret: "secret",
        rawBody: "x",
        signature: "v0=BADBADBAD",
        timestamp: ts,
      }));
      expect(result.authorized).toBe(false);
      expect(result.reason).toMatch(/signature mismatch/i);
    });

    it("should return authorized=true when all fields present and valid HMAC", () => {
      const ts = Math.floor(Date.now() / 1000);
      const secret = "my-signing-secret";
      const rawBody = '{"command":"run-test"}';
      const sig = makeValidHmac(secret, rawBody, ts);

      const result = authorizeBotCommand(makeCtx({
        signingSecret: secret,
        rawBody,
        signature: sig,
        timestamp: ts,
      }));
      expect(result.authorized).toBe(true);
      expect(result.userId).toBe("alice");
    });
  });

  // ── Existing behavior ────────────────────────────────────────────────────────

  it("should return authorized=false when userId is empty", () => {
    const result = authorizeBotCommand(makeCtx({ userId: "" }));
    expect(result.authorized).toBe(false);
    expect(result.reason).toMatch(/missing user identity/i);
  });

  it("should return authorized=false when request is too old", () => {
    // Timestamp 10 minutes in the past
    const staleTimestamp = Math.floor(Date.now() / 1000) - 601;
    const secret = "s";
    const rawBody = "x";
    const sig = makeValidHmac(secret, rawBody, staleTimestamp);

    const result = authorizeBotCommand(makeCtx({
      signingSecret: secret,
      rawBody,
      signature: sig,
      timestamp: staleTimestamp,
    }));
    expect(result.authorized).toBe(false);
    expect(result.reason).toMatch(/too old/i);
  });
});
