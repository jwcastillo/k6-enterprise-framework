import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizePrometheusLabel,
  assertValidPrometheusLabel,
  sanitizePrometheusValue,
  sanitizeTagsForPrometheus,
} from "../../src/core/prometheus-sanitizer";

describe("PrometheusSanitizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sanitizePrometheusLabel()", () => {
    it("should return a valid label unchanged", () => {
      expect(sanitizePrometheusLabel("http_req_duration")).toBe("http_req_duration");
    });

    it("should return label starting with underscore unchanged", () => {
      expect(sanitizePrometheusLabel("_private_metric")).toBe("_private_metric");
    });

    it("should replace invalid characters with underscores", () => {
      expect(sanitizePrometheusLabel("my-metric.name")).toBe("my_metric_name");
    });

    it("should replace spaces with underscores", () => {
      expect(sanitizePrometheusLabel("my metric")).toBe("my_metric");
    });

    it("should prefix with underscore if label starts with a digit", () => {
      expect(sanitizePrometheusLabel("3xx_errors")).toBe("_3xx_errors");
    });

    it("should truncate label to 128 characters", () => {
      const longLabel = "a".repeat(200);
      const result = sanitizePrometheusLabel(longLabel);
      expect(result.length).toBe(128);
    });

    it("should return '_invalid_label' for empty string", () => {
      expect(sanitizePrometheusLabel("")).toBe("_invalid_label");
    });

    it("should return '_invalid_label' for null-like input", () => {
      expect(sanitizePrometheusLabel(null as unknown as string)).toBe("_invalid_label");
      expect(sanitizePrometheusLabel(undefined as unknown as string)).toBe("_invalid_label");
    });

    it("should handle labels with only special characters", () => {
      // All chars replaced with underscore — result is non-empty underscores
      const result = sanitizePrometheusLabel("@#$%");
      expect(result).toBe("____");
    });

    it("should handle unicode characters by replacing them", () => {
      expect(sanitizePrometheusLabel("metrique_reponse")).toBe("metrique_reponse");
      expect(sanitizePrometheusLabel("metrique_r\u00e9ponse")).toBe("metrique_r_ponse");
    });
  });

  describe("assertValidPrometheusLabel()", () => {
    it("should not throw for valid label", () => {
      expect(() => assertValidPrometheusLabel("valid_label_123")).not.toThrow();
    });

    it("should not throw for label starting with underscore", () => {
      expect(() => assertValidPrometheusLabel("_starts_with_underscore")).not.toThrow();
    });

    it("should throw for label starting with digit", () => {
      expect(() => assertValidPrometheusLabel("1invalid")).toThrow(
        "[prometheus-sanitizer] Invalid Prometheus label name",
      );
    });

    it("should throw for label containing hyphens", () => {
      expect(() => assertValidPrometheusLabel("has-hyphen")).toThrow(
        "[prometheus-sanitizer] Invalid Prometheus label name",
      );
    });

    it("should throw for label containing dots", () => {
      expect(() => assertValidPrometheusLabel("has.dot")).toThrow(
        "[prometheus-sanitizer] Invalid Prometheus label name",
      );
    });

    it("should throw for label exceeding 128 characters", () => {
      const longLabel = "a".repeat(129);
      expect(() => assertValidPrometheusLabel(longLabel)).toThrow(
        "exceeds maximum length",
      );
    });

    it("should not throw for label of exactly 128 characters", () => {
      const label = "a".repeat(128);
      expect(() => assertValidPrometheusLabel(label)).not.toThrow();
    });

    it("should throw for empty string", () => {
      expect(() => assertValidPrometheusLabel("")).toThrow(
        "[prometheus-sanitizer] Invalid Prometheus label name",
      );
    });
  });

  describe("sanitizePrometheusValue()", () => {
    it("should return a normal string unchanged", () => {
      expect(sanitizePrometheusValue("hello world")).toBe("hello world");
    });

    it("should replace newlines with spaces", () => {
      expect(sanitizePrometheusValue("line1\nline2")).toBe("line1 line2");
    });

    it("should replace carriage returns with spaces", () => {
      expect(sanitizePrometheusValue("line1\rline2")).toBe("line1 line2");
    });

    it("should replace mixed newlines with spaces", () => {
      expect(sanitizePrometheusValue("a\r\nb\nc")).toBe("a  b c");
    });

    it("should truncate value to 256 characters", () => {
      const longValue = "x".repeat(300);
      const result = sanitizePrometheusValue(longValue);
      expect(result.length).toBe(256);
    });

    it("should handle non-string input by converting to string", () => {
      expect(sanitizePrometheusValue(42 as unknown as string)).toBe("42");
    });

    it("should handle null by returning empty string", () => {
      expect(sanitizePrometheusValue(null as unknown as string)).toBe("");
    });

    it("should handle undefined by returning empty string", () => {
      expect(sanitizePrometheusValue(undefined as unknown as string)).toBe("");
    });
  });

  describe("sanitizeTagsForPrometheus()", () => {
    it("should sanitize both keys and values", () => {
      const result = sanitizeTagsForPrometheus({
        "my-tag": "value\nwith newline",
      });
      expect(result).toEqual({ my_tag: "value with newline" });
    });

    it("should mask sensitive values when key suggests secret data", () => {
      const result = sanitizeTagsForPrometheus({
        token: "a_very_long_secret_token_value_here",
      });
      expect(result.token).toBe("****");
    });

    it("should mask password values when long enough", () => {
      const result = sanitizeTagsForPrometheus({
        password: "supersecretpassword123",
      });
      expect(result.password).toBe("****");
    });

    it("should not mask short values even with sensitive keys", () => {
      // Values <= 16 chars are not masked (might be enum values like "bearer")
      const result = sanitizeTagsForPrometheus({
        token: "bearer",
      });
      expect(result.token).toBe("bearer");
    });

    it("should not mask values starting with ${", () => {
      const result = sanitizeTagsForPrometheus({
        api_key: "${API_KEY_FROM_ENV_VARIABLE}",
      });
      expect(result.api_key).toBe("${API_KEY_FROM_ENV_VARIABLE}");
    });

    it("should not mask non-sensitive tag values", () => {
      const result = sanitizeTagsForPrometheus({
        environment: "production",
        client: "my-team",
      });
      expect(result.environment).toBe("production");
      expect(result.client).toBe("my-team");
    });

    it("should handle empty tags", () => {
      expect(sanitizeTagsForPrometheus({})).toEqual({});
    });

    it("should sanitize keys with digits starting", () => {
      const result = sanitizeTagsForPrometheus({
        "3xx_count": "42",
      });
      expect(result).toHaveProperty("_3xx_count", "42");
    });
  });
});
