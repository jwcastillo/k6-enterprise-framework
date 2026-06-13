import { describe, it, expect } from 'vitest';
import { ValidationHelper } from '../../src/helpers/validation-helper';

// Helper to create a mock SafeResponse
function mockResponse(overrides: {
  status?: number;
  body?: Record<string, unknown>;
  duration?: number;
}) {
  return {
    status: overrides.status ?? 200,
    body: JSON.stringify(overrides.body ?? {}),
    headers: {},
    timings: { duration: overrides.duration ?? 100, waiting: 50, receiving: 30, sending: 20 },
    json: <T = unknown>() => (overrides.body ?? {}) as T,
  };
}

// ── status ──────────────────────────────────────────────────────────────────
describe('ValidationHelper.status', () => {
  it('passes when status matches', () => {
    const result = ValidationHelper.status(mockResponse({ status: 200 }), 200);
    expect(result.passed).toBe(true);
  });

  it('fails when status does not match', () => {
    const result = ValidationHelper.status(mockResponse({ status: 500 }), 200);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Expected status 200, got 500');
  });
});

// ── hasFields ───────────────────────────────────────────────────────────────
describe('ValidationHelper.hasFields', () => {
  it('passes when all fields present', () => {
    const result = ValidationHelper.hasFields(
      mockResponse({ body: { id: 1, name: 'test' } }),
      ['id', 'name']
    );
    expect(result.passed).toBe(true);
  });

  it('fails when fields are missing', () => {
    const result = ValidationHelper.hasFields(
      mockResponse({ body: { id: 1 } }),
      ['id', 'name', 'email']
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('name');
    expect(result.message).toContain('email');
  });

  it('fails when body is not object', () => {
    const resp = {
      status: 200,
      body: 'not json',
      headers: {},
      timings: { duration: 100, waiting: 50, receiving: 30, sending: 20 },
      json: () => null,
    };
    const result = ValidationHelper.hasFields(resp, ['id']);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not a JSON object');
  });
});

// ── responseTime ────────────────────────────────────────────────────────────
describe('ValidationHelper.responseTime', () => {
  it('passes when duration is within threshold', () => {
    const result = ValidationHelper.responseTime(mockResponse({ duration: 200 }), 500);
    expect(result.passed).toBe(true);
  });

  it('fails when duration exceeds threshold', () => {
    const result = ValidationHelper.responseTime(mockResponse({ duration: 600 }), 500);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('exceeds');
  });

  it('passes when duration equals threshold exactly', () => {
    const result = ValidationHelper.responseTime(mockResponse({ duration: 500 }), 500);
    expect(result.passed).toBe(true);
  });
});

// ── isValidEmail ────────────────────────────────────────────────────────────
describe('ValidationHelper.isValidEmail', () => {
  it.each([
    'user@example.com',
    'test.user@domain.co.uk',
    'a+b@c.d',
  ])('accepts valid email: %s', (email) => {
    expect(ValidationHelper.isValidEmail(email)).toBe(true);
  });

  it.each([
    '',
    'no-at-sign',
    '@no-local.com',
    'spaces @here.com',
    'user@',
  ])('rejects invalid email: %s', (email) => {
    expect(ValidationHelper.isValidEmail(email)).toBe(false);
  });
});

// ── isValidUrl ──────────────────────────────────────────────────────────────
describe('ValidationHelper.isValidUrl', () => {
  it.each([
    'http://example.com',
    'https://api.example.com/v1/users',
    'https://localhost:3000',
  ])('accepts valid URL: %s', (url) => {
    expect(ValidationHelper.isValidUrl(url)).toBe(true);
  });

  it.each([
    '',
    'ftp://example.com',
    'example.com',
    'not a url',
  ])('rejects invalid URL: %s', (url) => {
    expect(ValidationHelper.isValidUrl(url)).toBe(false);
  });
});

// ── isValidCreditCard ───────────────────────────────────────────────────────
describe('ValidationHelper.isValidCreditCard', () => {
  it('validates known Luhn-valid numbers', () => {
    expect(ValidationHelper.isValidCreditCard('4111111111111111')).toBe(true);
    expect(ValidationHelper.isValidCreditCard('5500000000000004')).toBe(true);
  });

  it('rejects invalid Luhn numbers', () => {
    expect(ValidationHelper.isValidCreditCard('4111111111111112')).toBe(false);
  });

  it('rejects too short numbers', () => {
    expect(ValidationHelper.isValidCreditCard('411111')).toBe(false);
  });

  it('rejects too long numbers', () => {
    expect(ValidationHelper.isValidCreditCard('41111111111111111111')).toBe(false);
  });

  it('strips non-digit characters', () => {
    expect(ValidationHelper.isValidCreditCard('4111-1111-1111-1111')).toBe(true);
  });
});

// ── isValidUUID ─────────────────────────────────────────────────────────────
describe('ValidationHelper.isValidUUID', () => {
  it('accepts valid UUID v4', () => {
    expect(ValidationHelper.isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects UUID v1 (wrong version digit)', () => {
    expect(ValidationHelper.isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });

  it('rejects invalid format', () => {
    expect(ValidationHelper.isValidUUID('not-a-uuid')).toBe(false);
    expect(ValidationHelper.isValidUUID('')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(ValidationHelper.isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });
});
