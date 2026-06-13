import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "k6/crypto";
import { CryptoHelper } from "../../src/helpers/crypto-helper";

describe("CryptoHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hmacSign", () => {
    it("should call crypto.hmac with correct params", () => {
      CryptoHelper.hmacSign("data", "secret");

      expect(crypto.hmac).toHaveBeenCalledWith("sha256", "secret", "data", "hex");
    });

    it("should support custom algorithm and encoding", () => {
      CryptoHelper.hmacSign("data", "secret", "sha512", "base64");

      expect(crypto.hmac).toHaveBeenCalledWith("sha512", "secret", "data", "base64");
    });

    it("should return the hmac result", () => {
      const result = CryptoHelper.hmacSign("data", "secret");

      expect(result).toBe("mockhmac");
    });
  });

  describe("hmacStream", () => {
    it("should create HMAC hasher and update with each part", () => {
      CryptoHelper.hmacStream(["part1", "part2"], "secret");

      expect(crypto.createHMAC).toHaveBeenCalledWith("sha256", "secret");
    });

    it("should return the digest", () => {
      const result = CryptoHelper.hmacStream(["hello", " world"], "secret");

      expect(result).toBe("mockhash");
    });
  });

  describe("hash", () => {
    it("should create hash and return digest", () => {
      const result = CryptoHelper.hash("data");

      expect(crypto.createHash).toHaveBeenCalledWith("sha256");
      expect(result).toBe("mockhash");
    });

    it("should support custom algorithm", () => {
      CryptoHelper.hash("data", "sha512");

      expect(crypto.createHash).toHaveBeenCalledWith("sha512");
    });
  });

  describe("randomHex", () => {
    it("should generate random bytes and convert to hex", () => {
      const result = CryptoHelper.randomHex(16);

      expect(crypto.randomBytes).toHaveBeenCalledWith(16);
      // ArrayBuffer(16) → all zeros in mock → "00000000..."
      expect(result).toMatch(/^[0-9a-f]+$/);
      expect(result.length).toBe(32); // 16 bytes = 32 hex chars
    });

    it("should default to 16 bytes", () => {
      CryptoHelper.randomHex();

      expect(crypto.randomBytes).toHaveBeenCalledWith(16);
    });
  });

  describe("randomBase64", () => {
    it("should generate random bytes and convert to base64", () => {
      const result = CryptoHelper.randomBase64(16);

      expect(crypto.randomBytes).toHaveBeenCalledWith(16);
      expect(typeof result).toBe("string");
    });
  });

  describe("createTestJwt", () => {
    it("should create a JWT with three dot-separated parts", () => {
      const result = CryptoHelper.createTestJwt({ sub: "user1" }, "secret");

      const parts = result.split(".");
      expect(parts.length).toBe(3);
    });

    it("should call crypto.hmac for signing", () => {
      CryptoHelper.createTestJwt({ sub: "user1" }, "secret");

      expect(crypto.hmac).toHaveBeenCalledWith(
        "sha256",
        "secret",
        expect.stringContaining("."),
        "base64rawurl",
      );
    });
  });
});
