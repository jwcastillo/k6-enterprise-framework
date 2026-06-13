import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  maskRedisUrl,
  redisHostFromUrl,
  warnIfNoRedisAuth,
  warnIfLargeValue,
  SENSITIVE_KEY_DEFAULT_TTL_SECONDS,
  SENSITIVE_KEY_PREFIXES,
  isSensitiveKey,
  recommendedTtl,
  CleanupTracker,
  REDIS_ATOMICITY_NOTES,
} from "../../src/helpers/redis-security";

describe("redis-security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  // ── maskRedisUrl ──────────────────────────────────────────────────────────

  describe("maskRedisUrl", () => {
    it("masks credentials in URL", () => {
      const masked = maskRedisUrl("redis://user:password@host:6379");
      expect(masked).toBe("redis://***:***@host:6379");
      expect(masked).not.toContain("password");
    });

    it("does not mask password-only auth (no username to match)", () => {
      // The regex requires user:pass@ format; :pass@ (no user) does not match
      const masked = maskRedisUrl("redis://:mypassword@host:6379");
      expect(masked).toBe("redis://:mypassword@host:6379");
    });

    it("returns URL unchanged when no credentials", () => {
      const url = "redis://localhost:6379";
      expect(maskRedisUrl(url)).toBe(url);
    });

    it("preserves path after host", () => {
      const masked = maskRedisUrl("redis://user:pass@host:6379/0");
      expect(masked).toContain("/0");
      expect(masked).not.toContain("pass");
    });
  });

  // ── redisHostFromUrl ──────────────────────────────────────────────────────

  describe("redisHostFromUrl", () => {
    it("extracts host:port from URL with auth", () => {
      expect(redisHostFromUrl("redis://user:pass@myhost:6380")).toBe("myhost:6380");
    });

    it("extracts host:port from URL without auth", () => {
      expect(redisHostFromUrl("redis://localhost:6379")).toBe("localhost:6379");
    });

    it("handles URL with database number", () => {
      const host = redisHostFromUrl("redis://:pass@db-host:6379/2");
      expect(host).toBe("db-host:6379");
    });
  });

  // ── warnIfNoRedisAuth ─────────────────────────────────────────────────────

  describe("warnIfNoRedisAuth", () => {
    it("does not warn for local environments", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfNoRedisAuth("redis://localhost:6379", "local");
      warnIfNoRedisAuth("redis://localhost:6379", "development");
      warnIfNoRedisAuth("redis://localhost:6379", "dev");
      warnIfNoRedisAuth("redis://localhost:6379", "localhost");
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns in staging without auth", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfNoRedisAuth("redis://staging-host:6379", "staging");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no password configured"));
      warnSpy.mockRestore();
    });

    it("warns in production without auth", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfNoRedisAuth("redis://prod-host:6379", "production");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no password configured"));
      warnSpy.mockRestore();
    });

    it("does not warn when URL has auth", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfNoRedisAuth("redis://:secretpass@host:6379", "production");
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("uses __ENV when no explicit parameters", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (globalThis as Record<string, unknown>).__ENV = {
        REDIS_URL: "redis://host:6379",
        K6_ENV: "production",
      };
      warnIfNoRedisAuth();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ── warnIfLargeValue ──────────────────────────────────────────────────────

  describe("warnIfLargeValue", () => {
    it("does not warn for small values", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfLargeValue("key", "small value");
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns for values exceeding 1MB", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const largeValue = "x".repeat(1024 * 1024 + 1);
      warnIfLargeValue("big-key", largeValue);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("big-key"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("degrade Redis performance"));
      warnSpy.mockRestore();
    });

    it("does not warn for exactly 1MB", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const exactlyOneMb = "x".repeat(1024 * 1024);
      warnIfLargeValue("key", exactlyOneMb);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ── Constants ─────────────────────────────────────────────────────────────

  describe("constants", () => {
    it("SENSITIVE_KEY_DEFAULT_TTL_SECONDS is 3600 (1 hour)", () => {
      expect(SENSITIVE_KEY_DEFAULT_TTL_SECONDS).toBe(3600);
    });

    it("SENSITIVE_KEY_PREFIXES includes expected prefixes", () => {
      expect(SENSITIVE_KEY_PREFIXES).toContain("token:");
      expect(SENSITIVE_KEY_PREFIXES).toContain("auth:");
      expect(SENSITIVE_KEY_PREFIXES).toContain("session:");
      expect(SENSITIVE_KEY_PREFIXES).toContain("secret:");
    });

    it("REDIS_ATOMICITY_NOTES has safe and unsafe patterns", () => {
      expect(REDIS_ATOMICITY_NOTES.safe).toContain("incr");
      expect(REDIS_ATOMICITY_NOTES.unsafe).toContain("get-then-set");
    });
  });

  // ── isSensitiveKey ────────────────────────────────────────────────────────

  describe("isSensitiveKey", () => {
    it("returns true for keys with sensitive prefixes", () => {
      expect(isSensitiveKey("token:user123")).toBe(true);
      expect(isSensitiveKey("auth:session-abc")).toBe(true);
      expect(isSensitiveKey("session:xyz")).toBe(true);
      expect(isSensitiveKey("secret:api-key")).toBe(true);
    });

    it("returns false for non-sensitive keys", () => {
      expect(isSensitiveKey("user:123")).toBe(false);
      expect(isSensitiveKey("product:abc")).toBe(false);
      expect(isSensitiveKey("counter:visits")).toBe(false);
    });

    it("is case-sensitive (prefixes are lowercase)", () => {
      expect(isSensitiveKey("Token:abc")).toBe(false);
      expect(isSensitiveKey("AUTH:xyz")).toBe(false);
    });
  });

  // ── recommendedTtl ────────────────────────────────────────────────────────

  describe("recommendedTtl", () => {
    it("returns default TTL for sensitive keys", () => {
      expect(recommendedTtl("token:abc")).toBe(3600);
      expect(recommendedTtl("session:xyz")).toBe(3600);
    });

    it("returns undefined for non-sensitive keys", () => {
      expect(recommendedTtl("user:123")).toBeUndefined();
    });

    it("returns override TTL when provided", () => {
      expect(recommendedTtl("token:abc", 1800)).toBe(1800);
      expect(recommendedTtl("user:123", 300)).toBe(300);
    });
  });

  // ── CleanupTracker ────────────────────────────────────────────────────────

  describe("CleanupTracker", () => {
    it("tracks registered prefixes", () => {
      const tracker = new CleanupTracker();
      tracker.register("user:");
      tracker.register("product:");
      expect(tracker.allCleaned).toBe(false);
      expect(tracker.uncleaned).toEqual(["user:", "product:"]);
    });

    it("marks prefixes as cleaned", () => {
      const tracker = new CleanupTracker();
      tracker.register("user:");
      tracker.register("product:");
      tracker.markCleaned("user:");
      expect(tracker.allCleaned).toBe(false);
      expect(tracker.uncleaned).toEqual(["product:"]);
    });

    it("allCleaned returns true when all registered are cleaned", () => {
      const tracker = new CleanupTracker();
      tracker.register("user:");
      tracker.register("product:");
      tracker.markCleaned("user:");
      tracker.markCleaned("product:");
      expect(tracker.allCleaned).toBe(true);
      expect(tracker.uncleaned).toEqual([]);
    });

    it("allCleaned returns true when nothing registered", () => {
      const tracker = new CleanupTracker();
      expect(tracker.allCleaned).toBe(true);
    });

    it("warnIfUnclean emits warning for uncleaned prefixes", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tracker = new CleanupTracker();
      tracker.register("user:");
      tracker.register("session:");
      tracker.markCleaned("user:");
      tracker.warnIfUnclean();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("session:"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Teardown incomplete"));
      warnSpy.mockRestore();
    });

    it("warnIfUnclean does not warn when all clean", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tracker = new CleanupTracker();
      tracker.register("user:");
      tracker.markCleaned("user:");
      tracker.warnIfUnclean();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
