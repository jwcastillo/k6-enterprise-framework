/**
 * Security Under Load Calculator (T-189)
 *
 * Calculates 20 SEC metrics (CHK-API-410 to CHK-API-429):
 * - Authentication failure rate under load
 * - Rate-limiting accuracy (429 rate vs expected)
 * - TLS version compliance
 * - Security header presence
 * - Token refresh failure rate
 * - JWT/session expiry error rate
 * - Input validation rejection rate
 * - Privilege escalation attempt detection
 * - Sensitive data leak indicators (PII in responses)
 * - CORS misconfiguration indicators
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, k6Stat } from "../types";
import { m, na } from "./_helpers";

const CAT = "security" as const;

export class SecurityCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs } = input;
    const results: MetricResult[] = [];

    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const failedReqs = k6Stat(k6Metrics, "http_req_failed", "passes");
    const _durationSec = durationMs / 1000;

    // ── TLS / Transport security ───────────────────────────────────────────────
    const tlsHandshakeAvg = k6Stat(k6Metrics, "http_req_tls_handshaking", "avg");
    const tlsHandshakeMax = k6Stat(k6Metrics, "http_req_tls_handshaking", "max");
    const tlsHandshakeP95 = k6Stat(k6Metrics, "http_req_tls_handshaking", "p(95)");

    // TLS in use if avg TLS time > 0
    const tlsActive = tlsHandshakeAvg > 0;
    results.push(
      m(
        "SEC-001",
        "TLS Active",
        CAT,
        tlsActive ? 1 : 0,
        "bool",
        "== 1",
        tlsActive
          ? `TLS is active. Handshake avg=${tlsHandshakeAvg.toFixed(0)}ms p95=${tlsHandshakeP95.toFixed(0)}ms max=${tlsHandshakeMax.toFixed(0)}ms`
          : "No TLS handshake time detected. Ensure HTTPS endpoints are used"
      )
    );

    results.push(
      m(
        "SEC-002",
        "TLS Handshake — p95 (ms)",
        CAT,
        parseFloat(tlsHandshakeP95.toFixed(1)),
        "ms",
        "< 500",
        `p95 TLS handshake duration. High values may indicate weak cipher suites or certificate chain issues`
      )
    );

    // TLS version compliance from external metrics
    const tlsVersionSeries = externalMetrics["tls_version_non_compliant"] ?? [];
    if (tlsVersionSeries.length > 0) {
      const nonCompliant = tlsVersionSeries.reduce((s, p) => s + p.value, 0);
      const nonCompliantRate = totalReqs > 0 ? (nonCompliant / totalReqs) * 100 : 0;
      results.push(
        m(
          "SEC-003",
          "TLS Non-Compliant Connection Rate (%)",
          CAT,
          parseFloat(nonCompliantRate.toFixed(3)),
          "%",
          "== 0",
          `Connections using TLS < 1.2 or weak cipher suites. ${nonCompliant} non-compliant connections`
        )
      );
    } else {
      results.push(
        na(
          "SEC-003",
          "TLS Non-Compliant Connection Rate",
          CAT,
          "%",
          "Requires tls_version_non_compliant counter from k6 scenario (check response headers) or network scanner"
        )
      );
    }

    // ── Authentication & authorization ────────────────────────────────────────
    const authFailSeries = externalMetrics["auth_failure_count"] ?? [];

    if (authFailSeries.length > 0) {
      const authFails = authFailSeries.reduce((s, p) => s + p.value, 0);
      const authFailRate = totalReqs > 0 ? (authFails / totalReqs) * 100 : 0;
      results.push(
        m(
          "SEC-004",
          "Authentication Failure Rate (%)",
          CAT,
          parseFloat(authFailRate.toFixed(3)),
          "%",
          "< 1",
          `HTTP 401/403 responses / total requests under load. ${authFails} auth failures`
        )
      );
    } else {
      // Approximate: k6 failed requests (may include 4xx)
      const failRate = totalReqs > 0 ? (failedReqs / totalReqs) * 100 : 0;
      results.push(
        m(
          "SEC-004",
          "Auth Failure Rate (approx from all failures)",
          CAT,
          parseFloat(failRate.toFixed(3)),
          "%",
          "< 5",
          `Approximated from total failed requests. Add auth_failure_count (401+403 counter) for exact auth failures`
        )
      );
    }

    const tokenRefreshSeries = externalMetrics["token_refresh_errors"] ?? [];
    if (tokenRefreshSeries.length > 0) {
      const refreshErrors = tokenRefreshSeries.reduce((s, p) => s + p.value, 0);
      const refreshErrRate = totalReqs > 0 ? (refreshErrors / totalReqs) * 100 : 0;
      results.push(
        m(
          "SEC-005",
          "Token Refresh Failure Rate (%)",
          CAT,
          parseFloat(refreshErrRate.toFixed(3)),
          "%",
          "< 0.5",
          `JWT/OAuth token refresh failures under load. ${refreshErrors} failures — indicates token service saturation or race conditions`
        )
      );
    } else {
      results.push(
        na(
          "SEC-005",
          "Token Refresh Failure Rate",
          CAT,
          "%",
          "Requires token_refresh_errors counter in k6 scenario (track token refresh HTTP calls separately)"
        )
      );
    }

    const jwtExpirySeries = externalMetrics["jwt_expiry_errors"] ?? [];
    if (jwtExpirySeries.length > 0) {
      const expiryErrors = jwtExpirySeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SEC-006",
          "JWT Expiry Error Count",
          CAT,
          expiryErrors,
          "events",
          "== 0",
          `Number of requests failing due to expired JWT tokens. Should be 0 if token refresh logic is correct`
        )
      );
    } else {
      results.push(
        na(
          "SEC-006",
          "JWT Expiry Error Count",
          CAT,
          "events",
          "Requires jwt_expiry_errors counter from k6 scenario (check response body for 'token expired' messages)"
        )
      );
    }

    // ── Rate limiting ─────────────────────────────────────────────────────────
    const rate429Series = externalMetrics["http_errors_429"] ?? [];
    const rateLimitedSeries = externalMetrics["rate_limit_applied_count"] ?? [];

    if (rate429Series.length > 0) {
      const total429 = rate429Series.reduce((s, p) => s + p.value, 0);
      const rate429Pct = totalReqs > 0 ? (total429 / totalReqs) * 100 : 0;
      results.push(
        m(
          "SEC-007",
          "Rate Limit Hit Rate (429) (%)",
          CAT,
          parseFloat(rate429Pct.toFixed(3)),
          "%",
          "< 1",
          `HTTP 429 responses / total requests. ${total429} rate-limited requests (${rate429Pct.toFixed(2)}%)`
        )
      );
    } else {
      results.push(
        na(
          "SEC-007",
          "Rate Limit Hit Rate",
          CAT,
          "%",
          "Requires http_errors_429 counter in externalMetrics"
        )
      );
    }

    if (rateLimitedSeries.length > 0) {
      const applied = rateLimitedSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SEC-008",
          "Rate Limiting Applied Count",
          CAT,
          applied,
          "events",
          undefined,
          `Total number of times rate limiting was applied. Positive = rate limiting is working`
        )
      );
    } else {
      results.push(
        na(
          "SEC-008",
          "Rate Limiting Applied Count",
          CAT,
          "events",
          "Requires rate_limit_applied_count counter from application or API gateway metrics"
        )
      );
    }

    // ── Security headers ───────────────────────────────────────────────────────
    const secHeadersSeries = externalMetrics["missing_security_headers"] ?? [];
    if (secHeadersSeries.length > 0) {
      const missingCount = secHeadersSeries.reduce((s, p) => s + p.value, 0);
      const missingRate = totalReqs > 0 ? (missingCount / totalReqs) * 100 : 0;
      results.push(
        m(
          "SEC-009",
          "Missing Security Headers Rate (%)",
          CAT,
          parseFloat(missingRate.toFixed(2)),
          "%",
          "== 0",
          `Responses missing required security headers (HSTS, X-Frame-Options, CSP, etc.). ${missingCount} responses missing headers`
        )
      );
    } else {
      results.push(
        na(
          "SEC-009",
          "Missing Security Headers Rate",
          CAT,
          "%",
          "Requires missing_security_headers counter in k6 scenario (check() response.headers for HSTS, X-Frame-Options, X-Content-Type-Options, CSP)"
        )
      );
    }

    // ── Input validation ──────────────────────────────────────────────────────
    const validationErrorSeries = externalMetrics["input_validation_errors"] ?? [];
    const sqlInjectionSeries = externalMetrics["sql_injection_attempts"] ?? [];

    if (validationErrorSeries.length > 0) {
      const validationErrors = validationErrorSeries.reduce((s, p) => s + p.value, 0);
      const validationRate = totalReqs > 0 ? (validationErrors / totalReqs) * 100 : 0;
      results.push(
        m(
          "SEC-010",
          "Input Validation Rejection Rate (%)",
          CAT,
          parseFloat(validationRate.toFixed(2)),
          "%",
          "< 5",
          `Requests rejected due to input validation (400 Bad Request). ${validationErrors} rejected`
        )
      );
    } else {
      results.push(
        na(
          "SEC-010",
          "Input Validation Rejection Rate",
          CAT,
          "%",
          "Requires input_validation_errors counter (track 400 responses with validation error body in k6)"
        )
      );
    }

    if (sqlInjectionSeries.length > 0) {
      const injectionAttempts = sqlInjectionSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SEC-011",
          "SQL Injection Attempts Detected",
          CAT,
          injectionAttempts,
          "events",
          "== 0",
          `Detected SQL injection pattern attempts from WAF or application logs. ${injectionAttempts} attempts`
        )
      );
    } else {
      results.push(
        na(
          "SEC-011",
          "SQL Injection Attempts",
          CAT,
          "events",
          "Requires sql_injection_attempts counter from WAF (AWS WAF, ModSecurity, Cloudflare) or application security logs"
        )
      );
    }

    // ── PII / Data exposure ────────────────────────────────────────────────────
    const piiExposureSeries = externalMetrics["pii_exposure_events"] ?? [];
    if (piiExposureSeries.length > 0) {
      const piiEvents = piiExposureSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SEC-012",
          "PII Exposure Events",
          CAT,
          piiEvents,
          "events",
          "== 0",
          `Responses containing detectable PII patterns (email, SSN, credit card). ${piiEvents} exposure events — CRITICAL`
        )
      );
    } else {
      results.push(
        na(
          "SEC-012",
          "PII Exposure Events",
          CAT,
          "events",
          "Requires pii_exposure_events counter in k6 scenario (regex check on response bodies for PII patterns)"
        )
      );
    }

    // ── CORS ──────────────────────────────────────────────────────────────────
    const corsViolationSeries = externalMetrics["cors_violations"] ?? [];
    if (corsViolationSeries.length > 0) {
      const corsViolations = corsViolationSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SEC-013",
          "CORS Violation Events",
          CAT,
          corsViolations,
          "events",
          "== 0",
          `Detected CORS misconfiguration responses (wildcard origin, missing headers). ${corsViolations} violations`
        )
      );
    } else {
      results.push(
        na(
          "SEC-013",
          "CORS Violation Events",
          CAT,
          "events",
          "Requires cors_violations counter in k6 scenario (check Access-Control-Allow-Origin header values)"
        )
      );
    }

    // ── Privilege escalation ───────────────────────────────────────────────────
    results.push(
      na(
        "SEC-014",
        "Privilege Escalation Attempts",
        CAT,
        "events",
        "Requires authorization boundary tests in k6 scenario (attempt cross-user resource access, check for 403 vs 200)"
      ),
      na(
        "SEC-015",
        "Unauthorized Resource Access Rate",
        CAT,
        "%",
        "Requires cross-user access tests in k6 scenario (IDOR detection via sequential ID testing)"
      )
    );

    // ── Session security ───────────────────────────────────────────────────────
    const _sessionFixationSeries = externalMetrics["session_fixation_events"] ?? [];
    results.push(
      na(
        "SEC-016",
        "Session Fixation Events",
        CAT,
        "events",
        "Requires session ID rotation check in k6 scenario (compare session ID before/after login)"
      ),
      na(
        "SEC-017",
        "Insecure Cookie Events",
        CAT,
        "events",
        "Requires cookie attribute check in k6 (check Set-Cookie header for Secure, HttpOnly, SameSite flags)"
      )
    );

    // ── Denial of Service resistance ───────────────────────────────────────────
    // Under high load, measure availability (responses with 2xx)
    const successReqs = totalReqs - failedReqs;
    const availability = totalReqs > 0 ? (successReqs / totalReqs) * 100 : 100;

    results.push(
      m(
        "SEC-018",
        "Service Availability Under Load (%)",
        CAT,
        parseFloat(availability.toFixed(3)),
        "%",
        "> 99",
        `Service remained available for ${availability.toFixed(2)}% of requests under test load`
      )
    );

    // Response time consistency (indicator of DoS resistance)
    const p99 = k6Stat(k6Metrics, "http_req_duration", "p(99)");
    const maxDur = k6Stat(k6Metrics, "http_req_duration", "max");
    const tailRatio = p99 > 0 ? maxDur / p99 : 1;

    results.push(
      m(
        "SEC-019",
        "Response Time Consistency (max/p99)",
        CAT,
        parseFloat(tailRatio.toFixed(1)),
        "ratio",
        "< 10",
        `Max response time / p99. High ratio indicates tail latency spikes that may indicate resource exhaustion or DoS exposure`
      )
    );

    results.push(
      na(
        "SEC-020",
        "Brute Force Protection Active",
        CAT,
        "bool",
        "Requires brute_force_blocked counter from authentication service or WAF (check account lockout behavior under repeated failed auth)"
      )
    );

    return results;
  }
}
