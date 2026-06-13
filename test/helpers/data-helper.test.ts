import { describe, it, expect } from 'vitest';
import {
  randomString,
  randomEmail,
  randomCreditCard,
  randomUser,
  randomPrice,
  uuid,
  randomInt,
  randomItem,
  shuffle,
  randomBoolean,
  randomPhone,
  randomPassword,
  clone,
  merge,
  weightedSwitch,
  formatNumber,
  toQueryString,
  randomName,
  randomDate,
  DataHelper,
} from '../../src/helpers/data-helper';

// ── randomString ────────────────────────────────────────────────────────────
describe('randomString', () => {
  it('generates string of correct length', () => {
    expect(randomString(10)).toHaveLength(10);
  });

  it('generates empty string for length 0', () => {
    expect(randomString(0)).toBe('');
  });

  it('uses only characters from default charset', () => {
    const result = randomString(200);
    expect(result).toMatch(/^[a-z0-9]+$/);
  });

  it('uses only characters from custom charset', () => {
    const result = randomString(100, 'abc');
    expect(result).toMatch(/^[abc]+$/);
  });

  it('generates different values across calls', () => {
    const results = new Set(Array.from({ length: 20 }, () => randomString(12)));
    expect(results.size).toBeGreaterThan(1);
  });
});

// ── randomEmail ─────────────────────────────────────────────────────────────
describe('randomEmail', () => {
  it('generates a valid email format', () => {
    const email = randomEmail();
    expect(email).toMatch(/^[a-z]+\d+@test\.example\.com$/);
  });

  it('uses custom domain', () => {
    const email = randomEmail('acme.io');
    expect(email).toContain('@acme.io');
  });

  it('generates unique emails', () => {
    const emails = new Set(Array.from({ length: 10 }, () => randomEmail()));
    expect(emails.size).toBeGreaterThan(1);
  });
});

// ── randomCreditCard ────────────────────────────────────────────────────────
describe('randomCreditCard', () => {
  it('generates a 16-digit number', () => {
    expect(randomCreditCard()).toMatch(/^\d{16}$/);
  });

  it('starts with Visa test prefix 4111', () => {
    expect(randomCreditCard()).toMatch(/^4111/);
  });

  it('passes Luhn validation', () => {
    for (let i = 0; i < 20; i++) {
      const card = randomCreditCard();
      const digits = card.split('').map(Number);
      let sum = 0;
      let isEven = false;
      for (let j = digits.length - 1; j >= 0; j--) {
        let d = digits[j];
        if (isEven) {
          d *= 2;
          if (d > 9) d -= 9;
        }
        sum += d;
        isEven = !isEven;
      }
      expect(sum % 10).toBe(0);
    }
  });
});

// ── uuid ────────────────────────────────────────────────────────────────────
describe('uuid', () => {
  it('generates valid UUID v4 format', () => {
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 50 }, () => uuid()));
    expect(ids.size).toBe(50);
  });
});

// ── randomUser ──────────────────────────────────────────────────────────────
describe('randomUser', () => {
  it('returns all required fields', () => {
    const user = randomUser();
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('firstName');
    expect(user).toHaveProperty('lastName');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('username');
  });

  it('generates valid email for user', () => {
    const user = randomUser();
    expect(user.email).toContain('@test.example.com');
  });

  it('id is 8-char hex string', () => {
    const user = randomUser();
    expect(user.id).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ── randomPrice ─────────────────────────────────────────────────────────────
describe('randomPrice', () => {
  it('returns number within default range', () => {
    const price = randomPrice();
    expect(price).toBeGreaterThanOrEqual(0.01);
    expect(price).toBeLessThanOrEqual(999.99);
  });

  it('respects custom range', () => {
    const price = randomPrice(10, 20);
    expect(price).toBeGreaterThanOrEqual(10);
    expect(price).toBeLessThanOrEqual(20);
  });

  it('respects decimal precision', () => {
    const price = randomPrice(1, 100, 3);
    const decimals = price.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });
});

// ── randomInt ───────────────────────────────────────────────────────────────
describe('randomInt', () => {
  it('returns integer within range (inclusive)', () => {
    for (let i = 0; i < 100; i++) {
      const val = randomInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('works when min equals max', () => {
    expect(randomInt(7, 7)).toBe(7);
  });
});

// ── randomItem ──────────────────────────────────────────────────────────────
describe('randomItem', () => {
  it('returns an element from the array', () => {
    const arr = ['a', 'b', 'c'];
    expect(arr).toContain(randomItem(arr));
  });

  it('throws on empty array', () => {
    expect(() => randomItem([])).toThrow('Cannot pick random item from empty array');
  });
});

// ── shuffle ─────────────────────────────────────────────────────────────────
describe('shuffle', () => {
  it('returns array of same length', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toHaveLength(5);
  });

  it('does not mutate original array', () => {
    const arr = [1, 2, 3];
    shuffle(arr);
    expect(arr).toEqual([1, 2, 3]);
  });

  it('contains same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

// ── randomBoolean ───────────────────────────────────────────────────────────
describe('randomBoolean', () => {
  it('returns a boolean', () => {
    expect(typeof randomBoolean()).toBe('boolean');
  });

  it('produces both true and false over many calls', () => {
    const results = new Set(Array.from({ length: 100 }, () => randomBoolean()));
    expect(results.size).toBe(2);
  });
});

// ── randomPhone ─────────────────────────────────────────────────────────────
describe('randomPhone', () => {
  it('starts with country code', () => {
    expect(randomPhone()).toMatch(/^\+1/);
  });

  it('uses custom country code', () => {
    expect(randomPhone('+56')).toMatch(/^\+56/);
  });
});

// ── randomPassword ──────────────────────────────────────────────────────────
describe('randomPassword', () => {
  it('generates string of default length', () => {
    expect(randomPassword()).toHaveLength(12);
  });

  it('generates string of custom length', () => {
    expect(randomPassword(20)).toHaveLength(20);
  });
});

// ── clone ───────────────────────────────────────────────────────────────────
describe('clone', () => {
  it('creates a deep copy', () => {
    const obj = { a: { b: 1 } };
    const copy = clone(obj);
    copy.a.b = 99;
    expect(obj.a.b).toBe(1);
  });
});

// ── merge ───────────────────────────────────────────────────────────────────
describe('merge', () => {
  it('merges flat objects', () => {
    expect(merge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('deep merges nested objects', () => {
    const target = { config: { timeout: 30, retries: 3 } };
    const source = { config: { timeout: 60 } };
    const result = merge(target, source);
    expect(result.config.timeout).toBe(60);
    expect(result.config.retries).toBe(3);
  });

  it('does not mutate target', () => {
    const target = { a: 1 };
    merge(target, { a: 2 });
    expect(target.a).toBe(1);
  });

  it('overwrites arrays (not merge)', () => {
    const target = { items: [1, 2] };
    const source = { items: [3] };
    expect(merge(target, source).items).toEqual([3]);
  });
});

// ── weightedSwitch ──────────────────────────────────────────────────────────
describe('weightedSwitch', () => {
  it('returns a function from the weighted list', () => {
    const fn1 = () => 'a';
    const fn2 = () => 'b';
    const result = weightedSwitch([[0.5, fn1], [0.5, fn2]]);
    expect([fn1, fn2]).toContain(result);
  });

  it('throws when weights do not sum to 1.0', () => {
    const fn1 = () => 'a';
    expect(() => weightedSwitch([[0.3, fn1], [0.3, fn1]])).toThrow('Weights must sum to 1.0');
  });
});

// ── formatNumber ────────────────────────────────────────────────────────────
describe('formatNumber', () => {
  it('adds thousand separators', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('uses custom separator', () => {
    expect(formatNumber(1234567, '.')).toBe('1.234.567');
  });

  it('handles numbers under 1000', () => {
    expect(formatNumber(999)).toBe('999');
  });
});

// ── toQueryString ───────────────────────────────────────────────────────────
describe('toQueryString', () => {
  it('converts object to query string', () => {
    expect(toQueryString({ a: '1', b: '2' })).toBe('a=1&b=2');
  });

  it('filters null/undefined values', () => {
    expect(toQueryString({ a: '1', b: null, c: undefined })).toBe('a=1');
  });

  it('encodes special characters', () => {
    expect(toQueryString({ q: 'hello world' })).toBe('q=hello%20world');
  });
});

// ── randomName ──────────────────────────────────────────────────────────────
describe('randomName', () => {
  it('returns first, last, and full name', () => {
    const name = randomName();
    expect(name).toHaveProperty('first');
    expect(name).toHaveProperty('last');
    expect(name.full).toBe(`${name.first} ${name.last}`);
  });
});

// ── randomDate ──────────────────────────────────────────────────────────────
describe('randomDate', () => {
  it('returns date within range', () => {
    const start = new Date('2020-01-01');
    const end = new Date('2025-01-01');
    const d = randomDate(start, end);
    expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(d.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});

// ── DataHelper static facade ────────────────────────────────────────────────
describe('DataHelper', () => {
  it('exposes all functions as static methods', () => {
    expect(DataHelper.randomString).toBe(randomString);
    expect(DataHelper.uuid).toBe(uuid);
    expect(DataHelper.clone).toBe(clone);
    expect(DataHelper.merge).toBe(merge);
    expect(DataHelper.toQueryString).toBe(toQueryString);
  });
});
