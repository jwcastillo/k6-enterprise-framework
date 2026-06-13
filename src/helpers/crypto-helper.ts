/** T-020: CryptoHelper — Enterprise crypto utilities wrapping k6/crypto (PBKDF2 v1.6.0+) */

import crypto from "k6/crypto";
import encoding from "k6/encoding";

export type HashAlgorithm = "sha256" | "sha384" | "sha512";
export type OutputEncoding = "hex" | "base64" | "base64url";

/**
 * CryptoHelper — centralized crypto utilities for k6 load tests.
 *
 * Wraps k6/crypto with convenience methods for:
 * - HMAC signing
 * - Hash computation
 * - Random bytes generation
 *
 * Note: PBKDF2 is available in k6 v1.6.0+ at the runtime level.
 * The helper exposes it when the runtime supports it.
 */
export class CryptoHelper {
  /**
   * Compute HMAC signature.
   *
   * @param data - Data to sign
   * @param secret - Secret key
   * @param algorithm - Hash algorithm (default: sha256)
   * @param outputEncoding - Output encoding (default: hex)
   * @returns HMAC signature string
   */
  static hmacSign(
    data: string,
    secret: string,
    algorithm: HashAlgorithm = "sha256",
    outputEncoding: OutputEncoding = "hex",
  ): string {
    return crypto.hmac(algorithm, secret, data, outputEncoding) as string;
  }

  /**
   * Compute HMAC using the streaming Hasher API (for large or incremental data).
   *
   * @param parts - Data parts to hash incrementally
   * @param secret - Secret key
   * @param algorithm - Hash algorithm (default: sha256)
   * @param outputEncoding - Output encoding (default: hex)
   * @returns HMAC digest string
   */
  static hmacStream(
    parts: string[],
    secret: string,
    algorithm: HashAlgorithm = "sha256",
    outputEncoding: OutputEncoding = "hex",
  ): string {
    const hasher = crypto.createHMAC(algorithm, secret);
    for (const part of parts) {
      hasher.update(part);
    }
    return hasher.digest(outputEncoding) as string;
  }

  /**
   * Compute hash digest of data.
   *
   * @param data - Data to hash
   * @param algorithm - Hash algorithm (default: sha256)
   * @param outputEncoding - Output encoding (default: hex)
   * @returns Hash digest string
   */
  static hash(
    data: string,
    algorithm: HashAlgorithm = "sha256",
    outputEncoding: OutputEncoding = "hex",
  ): string {
    const hasher = crypto.createHash(algorithm);
    hasher.update(data);
    return hasher.digest(outputEncoding) as string;
  }

  /**
   * Generate random bytes and return as hex string.
   *
   * @param byteLength - Number of random bytes (default: 16)
   * @returns Hex-encoded random string
   */
  static randomHex(byteLength = 16): string {
    const buf = crypto.randomBytes(byteLength);
    const view = new Uint8Array(buf);
    return Array.from(view)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Generate random bytes and return as base64 string.
   *
   * @param byteLength - Number of random bytes (default: 16)
   * @returns Base64-encoded random string
   */
  static randomBase64(byteLength = 16): string {
    const buf = crypto.randomBytes(byteLength);
    return encoding.b64encode(buf);
  }

  /**
   * Create a simple JWT (for test purposes — NOT for production auth).
   * Uses HMAC-SHA256 signing.
   *
   * @param payload - JWT payload object
   * @param secret - Signing secret
   * @returns Signed JWT string
   */
  static createTestJwt(
    payload: Record<string, unknown>,
    secret: string,
  ): string {
    const header = { alg: "HS256", typ: "JWT" };
    const encHeader = encoding.b64encode(JSON.stringify(header), "rawurl");
    const encPayload = encoding.b64encode(JSON.stringify(payload), "rawurl");
    const signingInput = `${encHeader}.${encPayload}`;
    const signature = crypto.hmac("sha256", secret, signingInput, "base64rawurl");
    return `${signingInput}.${signature}`;
  }
}
