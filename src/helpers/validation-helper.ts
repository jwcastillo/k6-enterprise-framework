/** T-011: ValidationHelper — Validadores de respuesta y formato */

import { SafeResponse } from "@types-k6/safe-response";

/**
 * Result of a single response-level assertion check.
 * Distinct from the framework-wide ValidationResult in types/ai.d.ts (errors[]
 * + warnings[]) and the ConfigValidationResult in core/config-validator.ts.
 */
export interface ResponseValidation {
  passed: boolean;
  message: string;
}

/** @deprecated renamed to ResponseValidation — name collided with two other ValidationResult shapes. */
export type ValidationResult = ResponseValidation;

export class ValidationHelper {
  /** Validate HTTP status code */
  static status(response: SafeResponse, expected: number): ResponseValidation {
    const passed = response.status === expected;
    return {
      passed,
      message: passed
        ? `Status ${response.status} matches expected ${expected}`
        : `Expected status ${expected}, got ${response.status}`,
    };
  }

  /** Validate JSON body has required fields */
  static hasFields(response: SafeResponse, fields: string[]): ResponseValidation {
    const body = response.json<Record<string, unknown>>();
    if (body === null || typeof body !== "object") {
      return { passed: false, message: "Response body is not a JSON object" };
    }
    const missing = fields.filter((f) => !(f in body));
    const passed = missing.length === 0;
    return {
      passed,
      message: passed ? "All required fields present" : `Missing fields: ${missing.join(", ")}`,
    };
  }

  /** Validate response time against threshold (ms) */
  static responseTime(response: SafeResponse, maxMs: number): ResponseValidation {
    const duration = response.timings.duration;
    const passed = duration <= maxMs;
    return {
      passed,
      message: passed
        ? `Response time ${duration.toFixed(0)}ms within ${maxMs}ms`
        : `Response time ${duration.toFixed(0)}ms exceeds ${maxMs}ms`,
    };
  }

  /** Validate email format */
  static isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  /** Validate URL format */
  static isValidUrl(value: string): boolean {
    return /^https?:\/\/.+/.test(value);
  }

  /** Validate credit card with Luhn algorithm */
  static isValidCreditCard(value: string): boolean {
    const digits = value.replace(/\D/g, "").split("").map(Number);
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let isEven = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits[i];
      if (isEven) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      isEven = !isEven;
    }
    return sum % 10 === 0;
  }

  /** Validate UUID v4 format */
  static isValidUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
