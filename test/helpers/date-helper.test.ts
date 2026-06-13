import { describe, it, expect } from 'vitest';
import { DateHelper } from '../../src/helpers/date-helper';

// ── format ──────────────────────────────────────────────────────────────────
describe('DateHelper.format', () => {
  const date = new Date('2025-03-15T10:30:00.000Z');

  it('formats as ISO', () => {
    expect(DateHelper.format(date, 'ISO')).toBe('2025-03-15T10:30:00.000Z');
  });

  it('formats as YYYY-MM-DD', () => {
    expect(DateHelper.format(date, 'YYYY-MM-DD')).toBe('2025-03-15');
  });

  it('formats as DD/MM/YYYY', () => {
    expect(DateHelper.format(date, 'DD/MM/YYYY')).toBe('15/03/2025');
  });

  it('formats as MM/DD/YYYY', () => {
    expect(DateHelper.format(date, 'MM/DD/YYYY')).toBe('03/15/2025');
  });

  it('formats as timestamp', () => {
    expect(DateHelper.format(date, 'timestamp')).toBe(date.getTime().toString());
  });

  it('defaults to ISO when no format specified', () => {
    expect(DateHelper.format(date)).toBe('2025-03-15T10:30:00.000Z');
  });

  it('throws on unknown format', () => {
    expect(() => DateHelper.format(date, 'INVALID' as any)).toThrow("unknown format");
  });
});

// ── range ───────────────────────────────────────────────────────────────────
describe('DateHelper.range', () => {
  it('generates range with positive offset', () => {
    const { start, end } = DateHelper.range(1, 7);
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000);
  });

  it('generates range with negative offset (past dates)', () => {
    const { start, end } = DateHelper.range(-30, 7);
    expect(start.getTime()).toBeLessThan(Date.now());
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000);
  });

  it('generates zero-duration range', () => {
    const { start, end } = DateHelper.range(0, 0);
    expect(start.getTime()).toBe(end.getTime());
  });

  it('throws on negative duration', () => {
    expect(() => DateHelper.range(0, -5)).toThrow('durationDays must be non-negative');
  });
});

// ── addDays ─────────────────────────────────────────────────────────────────
describe('DateHelper.addDays', () => {
  it('adds positive days', () => {
    const d = new Date('2025-01-01T00:00:00Z');
    const result = DateHelper.addDays(d, 10);
    expect(result.toISOString()).toBe('2025-01-11T00:00:00.000Z');
  });

  it('subtracts with negative days', () => {
    const d = new Date('2025-01-11T00:00:00Z');
    const result = DateHelper.addDays(d, -10);
    expect(result.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });
});

// ── addHours ────────────────────────────────────────────────────────────────
describe('DateHelper.addHours', () => {
  it('adds hours', () => {
    const d = new Date('2025-01-01T00:00:00Z');
    const result = DateHelper.addHours(d, 5);
    expect(result.toISOString()).toBe('2025-01-01T05:00:00.000Z');
  });
});

// ── addMinutes ──────────────────────────────────────────────────────────────
describe('DateHelper.addMinutes', () => {
  it('adds minutes', () => {
    const d = new Date('2025-01-01T00:00:00Z');
    const result = DateHelper.addMinutes(d, 90);
    expect(result.toISOString()).toBe('2025-01-01T01:30:00.000Z');
  });
});

// ── toUnixTimestamp ─────────────────────────────────────────────────────────
describe('DateHelper.toUnixTimestamp', () => {
  it('converts to seconds', () => {
    const d = new Date('2025-01-01T00:00:00Z');
    expect(DateHelper.toUnixTimestamp(d)).toBe(Math.floor(d.getTime() / 1000));
  });
});

// ── fromISO ─────────────────────────────────────────────────────────────────
describe('DateHelper.fromISO', () => {
  it('parses valid ISO string', () => {
    const d = DateHelper.fromISO('2025-06-15T12:00:00Z');
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(5); // 0-indexed
  });

  it('throws on invalid string', () => {
    expect(() => DateHelper.fromISO('not-a-date')).toThrow('invalid ISO string');
  });
});

// ── isPast ──────────────────────────────────────────────────────────────────
describe('DateHelper.isPast', () => {
  it('returns true for past date', () => {
    expect(DateHelper.isPast(new Date('2020-01-01'))).toBe(true);
  });

  it('returns false for future date', () => {
    expect(DateHelper.isPast(new Date('2099-01-01'))).toBe(false);
  });
});

// ── random ──────────────────────────────────────────────────────────────────
describe('DateHelper.random', () => {
  it('returns date within range', () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-12-31');
    const d = DateHelper.random(start, end);
    expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(d.getTime()).toBeLessThanOrEqual(end.getTime());
  });

  it('throws when end is before start', () => {
    expect(() => DateHelper.random(new Date('2025-12-31'), new Date('2025-01-01'))).toThrow(
      'end must be after start'
    );
  });
});

// ── now ─────────────────────────────────────────────────────────────────────
describe('DateHelper.now', () => {
  it('returns a valid ISO string', () => {
    const now = DateHelper.now();
    expect(() => new Date(now)).not.toThrow();
    expect(new Date(now).toISOString()).toBe(now);
  });
});
