/**
 * T-135: Prometheus label sanitization
 *
 * Compatible with k6 goja runtime — uses only string operations, no Node.js APIs.
 *
 * Prometheus label naming rules:
 * - Label names: [a-zA-Z_][a-zA-Z0-9_]* (must start with letter or underscore)
 * - Label values: any UTF-8, but newlines must be removed
 * - Max recommended label length: 128 characters (names), 256 characters (values)
 *
 * This module ensures that custom tags injected by the framework comply with
 * these rules and do not expose sensitive information in metric labels.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const PROMETHEUS_LABEL_MAX_NAME_LEN = 128;
const PROMETHEUS_LABEL_MAX_VALUE_LEN = 256;

/** Pattern for valid Prometheus label names */
const VALID_LABEL_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Patterns that indicate a label value may contain sensitive data */
const SENSITIVE_VALUE_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /api_key/i,
  /credential/i,
  /private/i,
];

// ── Label name sanitization ───────────────────────────────────────────────────

/**
 * Sanitize a string for use as a Prometheus label name.
 *
 * Transformations applied:
 * - Characters outside [a-zA-Z0-9_] are replaced with underscore
 * - If the first character is a digit, prefix with underscore
 * - Result is truncated to 128 characters
 * - Empty or all-invalid input returns "_invalid_label"
 *
 * @param label - The raw label name to sanitize
 * @returns A valid Prometheus label name
 */
export function sanitizePrometheusLabel(label: string): string {
  if (!label || typeof label !== "string") {
    return "_invalid_label";
  }

  // Replace all invalid characters with underscore
  let sanitized = label.replace(/[^a-zA-Z0-9_]/g, "_");

  // Prometheus label names must start with a letter or underscore
  if (sanitized.length > 0 && /^[0-9]/.test(sanitized[0])) {
    sanitized = "_" + sanitized;
  }

  // Truncate to maximum length
  sanitized = sanitized.slice(0, PROMETHEUS_LABEL_MAX_NAME_LEN);

  return sanitized || "_empty_label";
}

/**
 * Assert that a label name is already valid without modification.
 * Use this when you want strict validation rather than silent sanitization.
 *
 * @param label - The label name to validate
 * @throws Error if the label does not conform to Prometheus naming rules
 */
export function assertValidPrometheusLabel(label: string): void {
  if (!VALID_LABEL_PATTERN.test(label)) {
    throw new Error(
      `[prometheus-sanitizer] Invalid Prometheus label name: '${label}'. ` +
        `Format required: [a-zA-Z_][a-zA-Z0-9_]*`,
    );
  }
  if (label.length > PROMETHEUS_LABEL_MAX_NAME_LEN) {
    throw new Error(
      `[prometheus-sanitizer] Label name '${label.slice(0, 32)}...' ` +
        `exceeds maximum length (${label.length} > ${PROMETHEUS_LABEL_MAX_NAME_LEN})`,
    );
  }
}

// ── Label value sanitization ──────────────────────────────────────────────────

/**
 * Sanitize a string for use as a Prometheus label value.
 *
 * Transformations applied:
 * - Newline characters (\n, \r) are replaced with space
 * - Result is truncated to 256 characters
 *
 * @param value - The raw label value to sanitize
 * @returns A sanitized label value safe for Prometheus
 */
export function sanitizePrometheusValue(value: string): string {
  if (typeof value !== "string") {
    return String(value ?? "");
  }

  return value
    .replace(/[\n\r]/g, " ")
    .slice(0, PROMETHEUS_LABEL_MAX_VALUE_LEN);
}

// ── Tag map sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize a complete map of tags for use with Prometheus metrics.
 * Applies sanitizePrometheusLabel to all keys and sanitizePrometheusValue to all values.
 * Removes tags whose values match sensitive data patterns (T-135).
 *
 * @param tags - Raw tag map from k6 execution context
 * @returns Sanitized tag map safe for Prometheus labels
 */
export function sanitizeTagsForPrometheus(
  tags: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [k, v] of Object.entries(tags)) {
    const sanitizedKey = sanitizePrometheusLabel(k);
    const sanitizedValue = sanitizePrometheusValue(v);

    // Skip tags whose values look like secrets (e.g. accidentally tagged token values)
    const valueIsSensitive =
      SENSITIVE_VALUE_PATTERNS.some((p) => p.test(k)) &&
      sanitizedValue.length > 16 &&
      !sanitizedValue.startsWith("${");

    if (valueIsSensitive) {
      result[sanitizedKey] = "****";
    } else {
      result[sanitizedKey] = sanitizedValue;
    }
  }

  return result;
}
