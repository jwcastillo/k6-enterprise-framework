/** T-016: Patron de correlacion — extraccion y propagacion de datos entre requests */

import { SafeResponse } from "@types-k6/safe-response";

export interface CorrelationRule {
  /** Name of the extracted value (used as key in the extracted map) */
  name: string;
  /** JSON path to extract from response body (dot-notation, e.g. "data.id") */
  jsonPath?: string;
  /** Header name to extract from response headers */
  header?: string;
  /** Regular expression with a capture group to extract from body string */
  regex?: string;
  /** Whether extraction failure should throw (default: false = warn only) */
  required?: boolean;
}

export type ExtractedValues = Record<string, string | null>;

/**
 * Extract values from a response according to correlation rules.
 * Enables chaining of request data without manual parsing in every scenario.
 */
export function extractFromResponse(
  response: SafeResponse,
  rules: CorrelationRule[]
): ExtractedValues {
  const result: ExtractedValues = {};

  for (const rule of rules) {
    let value: string | null = null;

    if (rule.jsonPath) {
      const extracted = response.json<unknown>(rule.jsonPath);
      value = extracted != null ? String(extracted) : null;
    } else if (rule.header) {
      value = response.headers[rule.header] ?? response.headers[rule.header.toLowerCase()] ?? null;
    } else if (rule.regex) {
      const match = response.body.match(new RegExp(rule.regex));
      value = match?.[1] ?? null;
    }

    if (value === null && rule.required) {
      throw new Error(
        `CorrelationPattern: required value '${rule.name}' not found in response (status=${response.status})`
      );
    }

    if (value === null) {
      console.warn(`CorrelationPattern: optional value '${rule.name}' not found`);
    }

    result[rule.name] = value;
  }

  return result;
}

/**
 * Replace template placeholders in a URL or body string.
 * Template syntax: {{name}}
 * Example: interpolate("/users/{{userId}}/orders", { userId: "42" }) => "/users/42/orders"
 */
export function interpolate(template: string, values: ExtractedValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const val = values[key];
    if (val === null || val === undefined) {
      console.warn(`CorrelationPattern: placeholder '{{${key}}}' has no value, leaving as-is`);
      return match;
    }
    return val;
  });
}

/**
 * Build request body by merging static fields with extracted dynamic values.
 */
export function mergeWithExtracted(
  staticBody: Record<string, unknown>,
  extracted: ExtractedValues,
  mapping: Record<string, string>
): Record<string, unknown> {
  const result = { ...staticBody };
  for (const [bodyKey, extractedKey] of Object.entries(mapping)) {
    const val = extracted[extractedKey];
    if (val !== null && val !== undefined) {
      result[bodyKey] = val;
    }
  }
  return result;
}
