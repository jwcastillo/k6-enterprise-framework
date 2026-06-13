// T-077: Sistema de notificaciones multi-canal (Slack, email, webhook)
import * as http from "k6/http";
import { sleep } from "k6";
import { assertWebhookAllowed } from "./webhook-validator";

export interface NotificationPayload {
  service: string;
  environment: string;
  profile: string;
  testName: string;
  verdict: "pass" | "fail";
  metrics: {
    p95Ms: number;
    errorRatePct: number;
    throughputRps: number;
    avgMs: number;
    p99Ms: number;
    durationMs: number;
    checkPassRate?: number;
    iterations?: number;
    vus?: number;
  };
  thresholdViolations: string[];
  comparison?: {
    p95DeltaPct?: number;
    p99DeltaPct?: number;
    errorDeltaPct?: number;
  };
  story?: {
    id?: string;
    title?: string;
    url?: string;
  };
  reportUrl?: string;
  executionId: string;
  timestamp: string;
}

export interface NotificationConfig {
  channels: ("slack" | "email" | "webhook")[];
  slackWebhook?: string;
  emailTo?: string;
  webhookUrl?: string;
  retries?: number; // 1-3, default 2
  conditions?: "always" | "on_failure" | "on_regression";
}

export class NotificationService {
  private config: NotificationConfig;
  private retries: number;

  constructor(config: NotificationConfig) {
    this.config = config;
    this.retries = Math.min(3, Math.max(1, config.retries ?? 2));
  }

  /**
   * CR-02 / WR-02: Guarded accessor for k6 __ENV global.
   * In the k6 goja runtime __ENV is a global object; in Node.js (bin/, Vitest)
   * it may not be declared at all. Accessing an undeclared global throws a
   * ReferenceError in Node.js strict mode, so we read via globalThis to avoid
   * crashing outside the k6 runtime.
   */
  private get _env(): Record<string, string> {
    return (
      ((globalThis as Record<string, unknown>).__ENV as Record<string, string> | undefined) ?? {}
    );
  }

  /**
   * Send notification to all configured channels.
   * Failures in one channel do not block others.
   */
  notify(payload: NotificationPayload): void {
    if (!this.shouldNotify(payload)) return;

    for (const channel of this.config.channels) {
      try {
        this.sendWithRetry(channel, payload);
      } catch (err) {
        // Log error but do not throw — non-blocking (EC-CLI-001)
        console.error(`[NotificationService] Channel "${channel}" failed: ${err}`);
      }
    }
  }

  private shouldNotify(payload: NotificationPayload): boolean {
    const cond = this.config.conditions ?? "always";
    if (cond === "always") return true;
    if (cond === "on_failure") return payload.verdict === "fail";
    if (cond === "on_regression") return payload.verdict === "fail"; // regression check done upstream
    return true;
  }

  /**
   * Resolve the URL for a channel without running any SSRF check.
   * Used by sendWithRetry to validate once before the retry loop (WR-06).
   * For the email channel, both endpoint and emailTo are validated here so
   * the combined error message is preserved for observability.
   */
  private resolveChannelUrl(channel: "slack" | "email" | "webhook"): string {
    const env = this._env;
    switch (channel) {
      case "slack": {
        const url = this.config.slackWebhook ?? env["NOTIFY_SLACK_WEBHOOK"];
        if (!url) throw new Error("NOTIFY_SLACK_WEBHOOK not configured");
        return url;
      }
      case "email": {
        const emailTo = this.config.emailTo ?? env["NOTIFY_EMAIL_TO"];
        const url = env["NOTIFY_EMAIL_ENDPOINT"];
        if (!emailTo || !url) {
          throw new Error("NOTIFY_EMAIL_TO or NOTIFY_EMAIL_ENDPOINT not configured");
        }
        return url;
      }
      case "webhook": {
        const url = this.config.webhookUrl ?? env["NOTIFY_WEBHOOK_URL"];
        if (!url) throw new Error("NOTIFY_WEBHOOK_URL not configured");
        return url;
      }
    }
  }

  private sendWithRetry(
    channel: "slack" | "email" | "webhook",
    payload: NotificationPayload
  ): void {
    // WR-06: validate the URL once before entering the retry loop.
    // assertWebhookAllowed throws on policy denial; the URL is static so retrying
    // after a denial would always fail and produce misleading "transient failure" logs.
    const url = this.resolveChannelUrl(channel);
    assertWebhookAllowed(url);

    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        this.sendToChannelUrl(channel, url, payload);
        return; // success
      } catch (err) {
        lastErr = err as Error;
        if (attempt < this.retries) {
          sleep(attempt * 2); // exponential backoff: 2s, 4s
        }
      }
    }
    throw lastErr;
  }

  /** Send to a channel using an already-resolved and validated URL (WR-06). */
  private sendToChannelUrl(
    channel: "slack" | "email" | "webhook",
    url: string,
    payload: NotificationPayload
  ): void {
    switch (channel) {
      case "slack":
        this.sendSlack(url, payload);
        break;
      case "email":
        this.sendEmail(url, payload);
        break;
      case "webhook":
        this.sendWebhook(url, payload);
        break;
    }
  }

  private sendSlack(webhookUrl: string, payload: NotificationPayload): void {
    const body = SlackFormatter.format(payload);
    // WR-01: redirects: 0 prevents redirect-chain SSRF bypass — a 3xx from the
    // initial (validated) target would otherwise silently follow to an internal IP.
    const res = http.post(webhookUrl, JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      timeout: "10s",
      redirects: 0,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `Slack webhook returned unexpected redirect ${res.status} — redirect following disabled for SSRF safety`
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Slack webhook returned HTTP ${res.status}`);
    }
  }

  private sendEmail(emailEndpoint: string, payload: NotificationPayload): void {
    // Email via webhook relay (SendGrid / SES endpoint configured by user)
    // resolveChannelUrl already validated that emailTo is non-empty before
    // sendEmail is called; re-resolving here would create a dual-resolution
    // point that could diverge if _env changes between calls (WR-01).
    const emailTo = this.config.emailTo ?? this._env["NOTIFY_EMAIL_TO"] ?? "";
    const body = EmailFormatter.format(payload, emailTo);
    // WR-01: redirects: 0 prevents redirect-chain SSRF bypass.
    const res = http.post(emailEndpoint, JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      timeout: "10s",
      redirects: 0,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `Email endpoint returned unexpected redirect ${res.status} — redirect following disabled for SSRF safety`
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Email endpoint returned HTTP ${res.status}`);
    }
  }

  private sendWebhook(url: string, payload: NotificationPayload): void {
    const body = WebhookFormatter.format(payload);
    // WR-01: redirects: 0 prevents redirect-chain SSRF bypass.
    const res = http.post(url, JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      timeout: "10s",
      redirects: 0,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `Webhook returned unexpected redirect ${res.status} — redirect following disabled for SSRF safety`
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Webhook returned HTTP ${res.status}`);
    }
  }

  /** Build NotificationPayload from k6 summary data */
  static buildPayload(
    summary: Record<string, unknown>,
    opts: {
      service: string;
      environment: string;
      profile: string;
      testName: string;
      executionId: string;
      reportUrl?: string;
    }
  ): NotificationPayload {
    const metrics = (summary["metrics"] as Record<string, Record<string, number>>) ?? {};
    const dur = metrics["http_req_duration"] ?? {};
    const errRate = metrics["http_req_failed"] ?? {};

    const thresholds = (summary["thresholds"] as Record<string, { ok: boolean }>) ?? {};
    const violations = Object.entries(thresholds)
      .filter(([, v]) => !v.ok)
      .map(([k]) => k);

    return {
      service: opts.service,
      environment: opts.environment,
      profile: opts.profile,
      testName: opts.testName,
      verdict: violations.length === 0 ? "pass" : "fail",
      metrics: {
        p95Ms: dur["p(95)"] ?? 0,
        p99Ms: dur["p(99)"] ?? 0,
        avgMs: dur["avg"] ?? 0,
        errorRatePct: (errRate["rate"] ?? 0) * 100,
        throughputRps: metrics["http_reqs"]?.["rate"] ?? 0,
        durationMs: (summary["state"] as Record<string, number>)?.["testRunDurationMs"] ?? 0,
      },
      thresholdViolations: violations,
      reportUrl: opts.reportUrl,
      executionId: opts.executionId,
      timestamp: new Date().toISOString(),
    };
  }
}

// T-078: Formatters

/** Slack Block Kit formatter */
export class SlackFormatter {
  static format(p: NotificationPayload): Record<string, unknown> {
    const emoji = p.verdict === "pass" ? "✅" : "❌";
    const color = p.verdict === "pass" ? "#36a64f" : "#e01e5a";
    const m = p.metrics;

    // Format delta suffix for comparison metrics
    const delta = (pct: number | undefined): string => {
      if (pct === undefined) return "";
      const sign = pct >= 0 ? "+" : "";
      return ` (${sign}${pct.toFixed(1)}%)`;
    };

    const fields = [
      { type: "mrkdwn", text: `*p95*\n${m.p95Ms.toFixed(0)}ms${delta(p.comparison?.p95DeltaPct)}` },
      { type: "mrkdwn", text: `*p99*\n${m.p99Ms.toFixed(0)}ms${delta(p.comparison?.p99DeltaPct)}` },
      {
        type: "mrkdwn",
        text: `*Error rate*\n${m.errorRatePct.toFixed(2)}%${delta(p.comparison?.errorDeltaPct)}`,
      },
      { type: "mrkdwn", text: `*Throughput*\n${m.throughputRps.toFixed(0)} req/s` },
    ];

    // Second row: avg, check rate, duration, iterations
    const fields2 = [
      { type: "mrkdwn", text: `*Avg*\n${m.avgMs.toFixed(0)}ms` },
      {
        type: "mrkdwn",
        text: `*Checks*\n${m.checkPassRate !== undefined ? `${m.checkPassRate.toFixed(1)}%` : "—"}`,
      },
      { type: "mrkdwn", text: `*Duration*\n${(m.durationMs / 1000).toFixed(1)}s` },
      { type: "mrkdwn", text: `*VUs / Iters*\n${m.vus ?? "—"} / ${m.iterations ?? "—"}` },
    ];

    const blocks: unknown[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} Perf Test: ${p.service} — ${p.verdict.toUpperCase()}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Service*\n${p.service}` },
          { type: "mrkdwn", text: `*Environment*\n${p.environment}` },
          { type: "mrkdwn", text: `*Profile*\n${p.profile}` },
          { type: "mrkdwn", text: `*Test*\n${p.testName}` },
        ],
      },
    ];

    // Story link (if present)
    if (p.story?.id || p.story?.title) {
      const storyText = p.story.url
        ? `<${p.story.url}|${p.story.id ?? p.story.title}>`
        : (p.story.id ?? p.story.title);
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `🎫 Story: ${storyText}${p.story.title && p.story.id ? ` — ${p.story.title}` : ""}`,
          },
        ],
      });
    }

    blocks.push({ type: "divider" });
    blocks.push({ type: "section", fields });
    blocks.push({ type: "section", fields: fields2 });

    if (p.thresholdViolations.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Threshold Violations:*\n${p.thresholdViolations.map((v) => `• ${v}`).join("\n")}`,
        },
      });
    }

    if (p.reportUrl) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "📊 View Report" },
            url: p.reportUrl,
            style: "primary",
          },
        ],
      });
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Execution ID: ${p.executionId} • ${p.timestamp}` }],
    });

    return {
      attachments: [{ color, blocks }],
    };
  }
}

/**
 * Escape a string for safe interpolation into an HTML context (WR-04).
 * Prevents stored XSS from threshold metric names, executionId, or reportUrl
 * that originate from external input (k6 summary, CI/CD environment, etc.).
 */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Email formatter — JSON payload for email relay */
export class EmailFormatter {
  static format(p: NotificationPayload, to: string): Record<string, unknown> {
    const subject = `[${p.verdict.toUpperCase()}] Perf Test: ${p.service} (${p.environment}) — ${p.profile}`;
    const m = p.metrics;

    // WR-04: all user-derived string values are HTML-escaped before interpolation.
    // reportUrl is also validated to start with https:// before use in an href.
    const safeReportUrl = p.reportUrl && /^https:\/\//i.test(p.reportUrl) ? p.reportUrl : null;

    const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto">
<h2 style="color:${p.verdict === "pass" ? "#36a64f" : "#e01e5a"}">${p.verdict === "pass" ? "✅" : "❌"} ${escHtml(subject)}</h2>
<table style="width:100%;border-collapse:collapse">
  <tr><th align="left" style="padding:6px;background:#f5f5f5">Metric</th><th align="left" style="padding:6px;background:#f5f5f5">Value</th></tr>
  <tr><td style="padding:6px;border-bottom:1px solid #eee">p95 Response Time</td><td style="padding:6px;border-bottom:1px solid #eee">${m.p95Ms.toFixed(0)}ms</td></tr>
  <tr><td style="padding:6px;border-bottom:1px solid #eee">p99 Response Time</td><td style="padding:6px;border-bottom:1px solid #eee">${m.p99Ms.toFixed(0)}ms</td></tr>
  <tr><td style="padding:6px;border-bottom:1px solid #eee">Avg Response Time</td><td style="padding:6px;border-bottom:1px solid #eee">${m.avgMs.toFixed(0)}ms</td></tr>
  <tr><td style="padding:6px;border-bottom:1px solid #eee">Error Rate</td><td style="padding:6px;border-bottom:1px solid #eee">${m.errorRatePct.toFixed(2)}%</td></tr>
  <tr><td style="padding:6px">Throughput</td><td style="padding:6px">${m.throughputRps.toFixed(0)} req/s</td></tr>
</table>
${p.thresholdViolations.length > 0 ? `<h3 style="color:#e01e5a">Threshold Violations</h3><ul>${p.thresholdViolations.map((v) => `<li>${escHtml(v)}</li>`).join("")}</ul>` : ""}
${safeReportUrl ? `<p><a href="${safeReportUrl}" style="background:#4a90d9;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none">View Report</a></p>` : ""}
<hr><p style="color:#999;font-size:12px">Execution ID: ${escHtml(p.executionId)} • ${escHtml(p.timestamp)}</p>
</body></html>`;

    return {
      to,
      subject,
      html,
      text: `${subject}\n\np95: ${m.p95Ms.toFixed(0)}ms | Error: ${m.errorRatePct.toFixed(2)}% | RPS: ${m.throughputRps.toFixed(0)}\n\nExecution ID: ${p.executionId}`,
    };
  }
}

/** Generic webhook formatter — versioned JSON */
export class WebhookFormatter {
  static format(p: NotificationPayload): Record<string, unknown> {
    return {
      version: "1.0",
      event: "perf_test_complete",
      ...p,
    };
  }
}
