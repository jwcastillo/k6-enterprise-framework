import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const GENERATOR = path.join(ROOT, 'bin/generate-report.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SUMMARY_FILE = path.join(FIXTURES_DIR, 'summary.json');
const PREV_FILE = path.join(FIXTURES_DIR, 'summary-prev.json');
const OUTPUT_FILE = path.join(FIXTURES_DIR, 'test-report.html');

// ── Test fixtures ───────────────────────────────────────────────────────────

const summaryFixture = {
  metrics: {
    http_req_duration: {
      avg: 245.3,
      med: 180.2,
      min: 12.5,
      max: 3200.0,
      'p(90)': 450.0,
      'p(95)': 680.0,
      'p(99)': 1500.0,
    },
    http_reqs: { count: 5000, rate: 83.3 },
    http_req_failed: { value: 0.005 },
    checks: { passes: 4950, fails: 50 },
    iterations: { count: 5000, rate: 83.3 },
    vus_max: { max: 50 },
  },
};

const prevSummaryFixture = {
  metrics: {
    http_req_duration: {
      avg: 300.0,
      med: 220.0,
      min: 15.0,
      max: 4000.0,
      'p(90)': 550.0,
      'p(95)': 800.0,
      'p(99)': 2000.0,
    },
    http_reqs: { count: 4000, rate: 66.7 },
    http_req_failed: { value: 0.02 },
    checks: { passes: 3800, fails: 200 },
    iterations: { count: 4000, rate: 66.7 },
    vus_max: { max: 50 },
  },
};

beforeAll(() => {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summaryFixture));
  fs.writeFileSync(PREV_FILE, JSON.stringify(prevSummaryFixture));
});

afterAll(() => {
  for (const f of [SUMMARY_FILE, PREV_FILE, OUTPUT_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  if (fs.existsSync(FIXTURES_DIR)) {
    try { fs.rmdirSync(FIXTURES_DIR); } catch { /* not empty is ok */ }
  }
});

function run(args: string): string {
  return execSync(`node "${GENERATOR}" ${args}`, {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 10_000,
  });
}

// ── CLI behavior ────────────────────────────────────────────────────────────
describe('generate-report.js CLI', () => {
  it('shows help with --help', () => {
    const output = run('--help');
    expect(output).toContain('generate-report.js');
    expect(output).toContain('--input');
  });

  it('fails without --input', () => {
    expect(() => run('')).toThrow();
  });

  it('fails with nonexistent input', () => {
    expect(() => run('--input=/tmp/nonexistent.json')).toThrow();
  });
});

// ── Report generation ───────────────────────────────────────────────────────
describe('generate-report.js output', () => {
  it('generates HTML report from summary JSON', () => {
    run(`--input="${SUMMARY_FILE}" --output="${OUTPUT_FILE}"`);
    expect(fs.existsSync(OUTPUT_FILE)).toBe(true);
    const html = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('k6 Performance Report');
  });

  it('includes KPI metrics in the report', () => {
    run(`--input="${SUMMARY_FILE}" --output="${OUTPUT_FILE}"`);
    const html = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    // Should contain the actual metric values somewhere in the HTML
    expect(html).toContain('245'); // avg ms
    expect(html).toContain('680'); // p95 ms
  });

  it('supports custom org name', () => {
    run(`--input="${SUMMARY_FILE}" --output="${OUTPUT_FILE}" --org-name="Acme Corp"`);
    const html = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    expect(html).toContain('Acme Corp');
  });

  it('supports custom brand color', () => {
    run(`--input="${SUMMARY_FILE}" --output="${OUTPUT_FILE}" --color="#e63946"`);
    const html = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    expect(html).toContain('#e63946');
  });

  it('includes SLA compliance section', () => {
    run(`--input="${SUMMARY_FILE}" --output="${OUTPUT_FILE}"`);
    const html = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    expect(html).toContain('SLA');
  });

  it('includes APDEX score', () => {
    run(`--input="${SUMMARY_FILE}" --output="${OUTPUT_FILE}"`);
    const html = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    expect(html).toContain('APDEX');
  });

  it('generates comparison when --compare is provided', () => {
    run(`--input="${SUMMARY_FILE}" --compare="${PREV_FILE}" --output="${OUTPUT_FILE}"`);
    const html = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    // Comparison section should show deltas
    expect(html).toContain('ompar'); // "Comparison" or "compared"
  });
});
