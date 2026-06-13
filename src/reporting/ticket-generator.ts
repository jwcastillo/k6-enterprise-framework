/**
 * Ticket & Comment Generator — produces Jira and GitHub-formatted outputs
 *
 * Generates two artifacts from load test results:
 *   1. **User Story / Ticket** — the request to perform a load test
 *   2. **Resolution Comment** — the results that close/resolve the ticket
 *
 * Template resolution order:
 *   1. Client-specific: clients/<client>/templates/ticket-story.md / ticket-comment.md
 *   2. Framework default: built-in templates below
 *
 * Supports both Jira wiki markup and GitHub Flavored Markdown.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type TicketPlatform = "jira" | "github";

export interface StoryContext {
  /** Jira key or GitHub issue number (e.g. "PROJ-1234", "#42") */
  storyId?: string;
  /** Story title / summary */
  storyTitle?: string;
  /** Story URL */
  storyUrl?: string;
}

export interface TicketPayload {
  /** Target platform for markdown format */
  platform: TicketPlatform;
  /** Client name */
  client: string;
  /** Service under test */
  service: string;
  /** Environment (staging, prod, etc.) */
  environment: string;
  /** Load profile used (smoke, load, stress, etc.) */
  profile: string;
  /** Test/scenario name */
  testName: string;
  /** Overall verdict */
  verdict: "pass" | "fail";
  /** Key metrics */
  metrics: {
    p95Ms: number;
    p99Ms: number;
    avgMs: number;
    errorRatePct: number;
    throughputRps: number;
    durationMs: number;
    iterations: number;
    vus: number;
    checkPassRate: number;
  };
  /** Threshold violations (empty = all passed) */
  thresholdViolations: string[];
  /** Comparison with baseline */
  comparison?: {
    baselineRunId?: string;
    deltas: Array<{
      metric: string;
      current: number;
      baseline: number;
      unit: string;
      improved: boolean;
    }>;
  };
  /** APDEX score (0–1) */
  apdex?: number;
  /** Link to the full HTML report */
  reportUrl?: string;
  /** Execution ID */
  executionId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Linked user story / ticket */
  story?: StoryContext;
  /** Custom tags from test execution */
  tags?: Record<string, string>;
}

// ── Template loading ─────────────────────────────────────────────────────────

/**
 * Try to load a client-specific template file via k6 open().
 * Falls back to null if not found (k6 open() throws on missing files).
 */
function loadClientTemplate(client: string, templateName: string): string | null {
  try {
    // k6 open() reads from the working directory at init time
    return open(`clients/${client}/templates/${templateName}`);
  } catch {
    return null;
  }
}

// ── APDEX calculation ────────────────────────────────────────────────────────

export function calculateApdex(
  avgMs: number,
  p95Ms: number,
  satisfiedThresholdMs = 500,
  toleratingThresholdMs = 2000
): number {
  // Simplified APDEX: use avg for satisfied zone, p95 for tolerating zone
  const satisfied = avgMs <= satisfiedThresholdMs ? 1 : 0;
  const tolerating =
    avgMs > satisfiedThresholdMs && p95Ms <= toleratingThresholdMs ? 1 : 0;
  return (satisfied + tolerating / 2) / 1;
}

export function apdexRating(score: number): string {
  if (score >= 0.94) return "Excellent";
  if (score >= 0.85) return "Good";
  if (score >= 0.7) return "Fair";
  if (score >= 0.5) return "Poor";
  return "Unacceptable";
}

// ── Formatters ───────────────────────────────────────────────────────────────

function bold(text: string, platform: TicketPlatform): string {
  return platform === "jira" ? `*${text}*` : `**${text}**`;
}

function code(text: string, platform: TicketPlatform): string {
  return platform === "jira" ? `{{${text}}}` : `\`${text}\``;
}

function link(label: string, url: string, platform: TicketPlatform): string {
  return platform === "jira" ? `[${label}|${url}]` : `[${label}](${url})`;
}

function heading(level: number, text: string, platform: TicketPlatform): string {
  if (platform === "jira") return `h${level}. ${text}`;
  return `${"#".repeat(level)} ${text}`;
}

function tableRow(cells: string[], platform: TicketPlatform): string {
  if (platform === "jira") return `| ${cells.join(" | ")} |`;
  return `| ${cells.join(" | ")} |`;
}

function tableHeader(headers: string[], platform: TicketPlatform): string {
  const headerRow = tableRow(headers, platform);
  if (platform === "jira") return `|| ${headers.join(" || ")} ||`;
  return `${headerRow}\n|${headers.map(() => "---").join("|")}|`;
}

function divider(platform: TicketPlatform): string {
  return platform === "jira" ? "----" : "---";
}

function verdictEmoji(verdict: "pass" | "fail", platform: TicketPlatform): string {
  if (platform === "jira") return verdict === "pass" ? "(/) PASS" : "(x) FAIL";
  return verdict === "pass" ? ":white_check_mark: PASS" : ":x: FAIL";
}

function fmtMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

function fmtPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

function fmtDelta(current: number, baseline: number, unit: string): string {
  if (baseline === 0) return "—";
  const delta = current - baseline;
  const pct = ((delta / baseline) * 100).toFixed(1);
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta)}${unit} (${sign}${pct}%)`;
}

// ── Story Generator ──────────────────────────────────────────────────────────

function applyTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

const DEFAULT_STORY_TEMPLATE = `{{heading_2_story}}

{{bold_as_a}} performance engineer,
{{bold_i_want}} to execute a {{profile}} load test on {{bold_service}} in the {{environment}} environment,
{{bold_so_that}} we can validate that the service meets its performance SLAs before release.

{{heading_3_ac}}

- [ ] p95 response time < defined threshold
- [ ] p99 response time < defined threshold
- [ ] Error rate < 1%
- [ ] Check pass rate >= 95%
- [ ] No threshold violations

{{heading_3_details}}

{{table}}

{{heading_3_notes}}

- Test scenario: {{code_test_name}}
- Profile: {{code_profile}} (defines VU ramp, duration, and thresholds)
- Data source: client-specific test data in {{code_data_path}}
{{story_link}}`;

const DEFAULT_COMMENT_TEMPLATE = `{{heading_2_results}}

{{verdict_line}}

{{heading_3_metrics}}

{{metrics_table}}

{{comparison_section}}
{{violations_section}}
{{apdex_section}}
{{divider}}

{{bold_execution_id}}: {{code_exec_id}}
{{bold_timestamp}}: {{timestamp}}
{{bold_duration}}: {{duration}}
{{bold_profile}}: {{code_profile}} | {{bold_vus}}: {{vus}} | {{bold_iterations}}: {{iterations}}
{{report_link}}
{{story_link}}`;

// ── Public API ───────────────────────────────────────────────────────────────

export class TicketGenerator {
  /**
   * Generate a user story / ticket body for requesting a load test.
   */
  static generateStory(p: TicketPayload): string {
    const pl = p.platform;

    // Try client template first
    const clientTmpl = loadClientTemplate(p.client, "ticket-story.md");
    if (clientTmpl) {
      return applyTemplate(clientTmpl, TicketGenerator._buildStoryVars(p));
    }

    // Default template with platform-aware formatting
    const vars: Record<string, string> = {
      heading_2_story: heading(2, "Load Test Request", pl),
      bold_as_a: bold("As a", pl),
      bold_i_want: bold("I want to", pl),
      bold_so_that: bold("So that", pl),
      profile: p.profile,
      bold_service: bold(p.service, pl),
      environment: p.environment,
      heading_3_ac: heading(3, "Acceptance Criteria", pl),
      heading_3_details: heading(3, "Test Details", pl),
      table: [
        tableHeader(["Field", "Value"], pl),
        tableRow(["Client", p.client], pl),
        tableRow(["Service", p.service], pl),
        tableRow(["Environment", p.environment], pl),
        tableRow(["Profile", code(p.profile, pl)], pl),
        tableRow(["Scenario", code(p.testName, pl)], pl),
      ].join("\n"),
      heading_3_notes: heading(3, "Notes", pl),
      code_test_name: code(p.testName, pl),
      code_profile: code(p.profile, pl),
      code_data_path: code(`clients/${p.client}/data/`, pl),
      story_link: p.story?.storyUrl
        ? `- Linked story: ${link(p.story.storyId ?? p.story.storyTitle ?? "link", p.story.storyUrl, pl)}`
        : "",
    };

    return applyTemplate(DEFAULT_STORY_TEMPLATE, vars);
  }

  /**
   * Generate a resolution comment with test results.
   * This is the text you paste into the ticket to resolve it.
   */
  static generateComment(p: TicketPayload): string {
    const pl = p.platform;

    // Try client template first
    const clientTmpl = loadClientTemplate(p.client, "ticket-comment.md");
    if (clientTmpl) {
      return applyTemplate(clientTmpl, TicketGenerator._buildCommentVars(p));
    }

    const m = p.metrics;

    // Metrics table
    const metricsRows = [
      tableHeader(["Metric", "Value", "Status"], pl),
      tableRow(["p95 Response", fmtMs(m.p95Ms), m.p95Ms < 2000 ? verdictEmoji("pass", pl) : verdictEmoji("fail", pl)], pl),
      tableRow(["p99 Response", fmtMs(m.p99Ms), m.p99Ms < 5000 ? verdictEmoji("pass", pl) : verdictEmoji("fail", pl)], pl),
      tableRow(["Avg Response", fmtMs(m.avgMs), m.avgMs < 1000 ? verdictEmoji("pass", pl) : verdictEmoji("fail", pl)], pl),
      tableRow(["Error Rate", fmtPct(m.errorRatePct), m.errorRatePct < 1 ? verdictEmoji("pass", pl) : verdictEmoji("fail", pl)], pl),
      tableRow(["Throughput", `${m.throughputRps.toFixed(1)} req/s`, "—"], pl),
      tableRow(["Check Pass Rate", fmtPct(m.checkPassRate), m.checkPassRate >= 95 ? verdictEmoji("pass", pl) : verdictEmoji("fail", pl)], pl),
    ];

    // Comparison section
    let comparisonSection = "";
    if (p.comparison && p.comparison.deltas.length > 0) {
      const compRows = [
        tableHeader(["Metric", "Current", "Baseline", "Delta"], pl),
        ...p.comparison.deltas.map((d) =>
          tableRow(
            [
              d.metric,
              `${Math.round(d.current)}${d.unit}`,
              `${Math.round(d.baseline)}${d.unit}`,
              fmtDelta(d.current, d.baseline, d.unit),
            ],
            pl
          )
        ),
      ];
      comparisonSection = [
        heading(3, "Comparison vs Baseline", pl),
        "",
        compRows.join("\n"),
        p.comparison.baselineRunId
          ? `\n${bold("Baseline", pl)}: ${code(p.comparison.baselineRunId, pl)}`
          : "",
      ].join("\n");
    }

    // Violations section
    let violationsSection = "";
    if (p.thresholdViolations.length > 0) {
      const items = p.thresholdViolations
        .map((v) => `- ${pl === "jira" ? `(x) ${v}` : `:x: ${v}`}`)
        .join("\n");
      violationsSection = [heading(3, "Threshold Violations", pl), "", items].join("\n");
    }

    // APDEX section
    let apdexSection = "";
    if (p.apdex !== undefined) {
      const rating = apdexRating(p.apdex);
      apdexSection = `${bold("APDEX", pl)}: ${p.apdex.toFixed(2)} (${rating})`;
    }

    const vars: Record<string, string> = {
      heading_2_results: heading(
        2,
        `Load Test Results — ${p.verdict.toUpperCase()}`,
        pl
      ),
      verdict_line: `${verdictEmoji(p.verdict, pl)} ${bold(p.service, pl)} | ${code(p.profile, pl)} | ${p.environment}`,
      heading_3_metrics: heading(3, "Key Metrics", pl),
      metrics_table: metricsRows.join("\n"),
      comparison_section: comparisonSection,
      violations_section: violationsSection,
      apdex_section: apdexSection,
      divider: divider(pl),
      bold_execution_id: bold("Execution ID", pl),
      code_exec_id: code(p.executionId, pl),
      bold_timestamp: bold("Timestamp", pl),
      timestamp: p.timestamp,
      bold_duration: bold("Duration", pl),
      duration: `${(m.durationMs / 1000).toFixed(1)}s`,
      bold_profile: bold("Profile", pl),
      code_profile: code(p.profile, pl),
      bold_vus: bold("VUs", pl),
      vus: String(m.vus),
      bold_iterations: bold("Iterations", pl),
      iterations: String(m.iterations),
      report_link: p.reportUrl
        ? `${bold("Full Report", pl)}: ${link("View Report", p.reportUrl, pl)}`
        : "",
      story_link: p.story?.storyUrl
        ? `${bold("Story", pl)}: ${link(p.story.storyId ?? "link", p.story.storyUrl, pl)}${p.story.storyTitle ? ` — ${p.story.storyTitle}` : ""}`
        : "",
    };

    return applyTemplate(DEFAULT_COMMENT_TEMPLATE, vars);
  }

  /**
   * Generate both story and comment as a pair.
   * Returns { story, comment } strings ready to paste.
   */
  static generate(p: TicketPayload): { story: string; comment: string } {
    return {
      story: TicketGenerator.generateStory(p),
      comment: TicketGenerator.generateComment(p),
    };
  }

  /**
   * Build TicketPayload from a k6 execution summary + notification payload.
   * Convenience factory for use in handleSummary().
   */
  static buildPayload(
    summary: {
      testName: string;
      client: string;
      environment: string;
      profile: string;
      httpDuration: { avg: number; p95: number; p99: number };
      httpRequests: number;
      httpRequestsFailed: number;
      iterations: number;
      vus: number;
      checks: Array<{ passRate: number }>;
      thresholds: Array<{ metric: string; condition: string; passed: boolean }>;
      passed: boolean;
      durationMs: number;
      tags: Record<string, string>;
    },
    opts: {
      platform: TicketPlatform;
      executionId: string;
      service?: string;
      reportUrl?: string;
      story?: StoryContext;
      comparison?: TicketPayload["comparison"];
    }
  ): TicketPayload {
    const violations = summary.thresholds
      .filter((t) => !t.passed)
      .map((t) => `${t.metric}: ${t.condition}`);

    const errorRatePct =
      summary.httpRequests > 0
        ? (summary.httpRequestsFailed / summary.httpRequests) * 100
        : 0;

    const checkPassRate =
      summary.checks.length > 0 ? summary.checks[0].passRate * 100 : 100;

    const apdex = calculateApdex(
      summary.httpDuration.avg,
      summary.httpDuration.p95
    );

    return {
      platform: opts.platform,
      client: summary.client,
      service: opts.service ?? summary.tags["service"] ?? summary.client,
      environment: summary.environment,
      profile: summary.profile,
      testName: summary.testName,
      verdict: summary.passed ? "pass" : "fail",
      metrics: {
        p95Ms: summary.httpDuration.p95,
        p99Ms: summary.httpDuration.p99,
        avgMs: summary.httpDuration.avg,
        errorRatePct,
        throughputRps: 0, // calculated from data if available
        durationMs: summary.durationMs,
        iterations: summary.iterations,
        vus: summary.vus,
        checkPassRate,
      },
      thresholdViolations: violations,
      comparison: opts.comparison,
      apdex,
      reportUrl: opts.reportUrl,
      executionId: opts.executionId,
      timestamp: new Date().toISOString(),
      story: opts.story,
      tags: summary.tags,
    };
  }

  // ── Private: template variable builders ──────────────────────────────────

  private static _buildStoryVars(p: TicketPayload): Record<string, string> {
    return {
      platform: p.platform,
      client: p.client,
      service: p.service,
      environment: p.environment,
      profile: p.profile,
      test_name: p.testName,
      story_id: p.story?.storyId ?? "",
      story_title: p.story?.storyTitle ?? "",
      story_url: p.story?.storyUrl ?? "",
      execution_id: p.executionId,
    };
  }

  private static _buildCommentVars(p: TicketPayload): Record<string, string> {
    const m = p.metrics;
    return {
      platform: p.platform,
      verdict: p.verdict,
      verdict_upper: p.verdict.toUpperCase(),
      client: p.client,
      service: p.service,
      environment: p.environment,
      profile: p.profile,
      test_name: p.testName,
      p95_ms: fmtMs(m.p95Ms),
      p99_ms: fmtMs(m.p99Ms),
      avg_ms: fmtMs(m.avgMs),
      error_rate: fmtPct(m.errorRatePct),
      throughput_rps: `${m.throughputRps.toFixed(1)} req/s`,
      check_pass_rate: fmtPct(m.checkPassRate),
      duration: `${(m.durationMs / 1000).toFixed(1)}s`,
      iterations: String(m.iterations),
      vus: String(m.vus),
      execution_id: p.executionId,
      timestamp: p.timestamp,
      report_url: p.reportUrl ?? "",
      story_id: p.story?.storyId ?? "",
      story_title: p.story?.storyTitle ?? "",
      story_url: p.story?.storyUrl ?? "",
      apdex: p.apdex?.toFixed(2) ?? "",
      apdex_rating: p.apdex !== undefined ? apdexRating(p.apdex) : "",
      threshold_violations: p.thresholdViolations.join(", "),
      threshold_count: String(p.thresholdViolations.length),
    };
  }
}
