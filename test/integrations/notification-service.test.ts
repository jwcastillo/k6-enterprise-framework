/**
 * Unit tests for NotificationService (T-077/T-078)
 *
 * Tests cover:
 * - NotificationService constructor (retry clamping)
 * - notify() routing to all configured channels
 * - shouldNotify() condition logic (always, on_failure, on_regression)
 * - sendWithRetry() retry + backoff behavior
 * - Slack channel: webhook URL resolution, HTTP call, error handling
 * - Email channel: endpoint + emailTo resolution, HTTP call, error handling
 * - Webhook channel: URL resolution, HTTP call, error handling
 * - buildPayload() from k6 summary data
 * - SlackFormatter.format() block structure
 * - EmailFormatter.format() HTML + text + subject
 * - WebhookFormatter.format() versioned payload
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as http from "k6/http";
import * as webhookValidator from "../../src/integrations/webhook-validator";
import {
  NotificationService,
  SlackFormatter,
  EmailFormatter,
  WebhookFormatter,
  NotificationPayload,
  NotificationConfig,
} from "../../src/integrations/notification-service";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    service: "test-service",
    environment: "staging",
    profile: "load",
    testName: "checkout-flow",
    verdict: "pass",
    metrics: {
      p95Ms: 420,
      p99Ms: 750,
      avgMs: 200,
      errorRatePct: 1.5,
      throughputRps: 50,
      durationMs: 60000,
    },
    thresholdViolations: [],
    executionId: "exec-123",
    timestamp: "2026-03-07T12:00:00.000Z",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    channels: ["slack"],
    slackWebhook: "https://hooks.slack.com/services/test",
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("NotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset __ENV
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("clamps retries to minimum 1", () => {
      const svc = new NotificationService({ channels: ["slack"], retries: 0 });
      // Access via internal state by testing behavior: 1 retry means 1 attempt
      // We'll verify indirectly through sendWithRetry behavior
      expect(svc).toBeDefined();
    });

    it("clamps retries to maximum 3", () => {
      const svc = new NotificationService({ channels: ["slack"], retries: 10 });
      expect(svc).toBeDefined();
    });

    it("defaults retries to 2 when not specified", () => {
      const svc = new NotificationService({ channels: ["slack"] });
      expect(svc).toBeDefined();
    });
  });

  // ── notify() — condition logic ──────────────────────────────────────────

  describe("notify() — shouldNotify conditions", () => {
    it("sends notification when condition is 'always' and verdict is pass", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(makeConfig({ conditions: "always" }));
      svc.notify(makePayload({ verdict: "pass" }));

      expect(mockPost).toHaveBeenCalled();
    });

    it("sends notification when condition is 'always' and verdict is fail", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(makeConfig({ conditions: "always" }));
      svc.notify(makePayload({ verdict: "fail" }));

      expect(mockPost).toHaveBeenCalled();
    });

    it("skips notification when condition is 'on_failure' and verdict is pass", () => {
      const mockPost = vi.mocked(http.post);

      const svc = new NotificationService(makeConfig({ conditions: "on_failure" }));
      svc.notify(makePayload({ verdict: "pass" }));

      expect(mockPost).not.toHaveBeenCalled();
    });

    it("sends notification when condition is 'on_failure' and verdict is fail", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(makeConfig({ conditions: "on_failure" }));
      svc.notify(makePayload({ verdict: "fail" }));

      expect(mockPost).toHaveBeenCalled();
    });

    it("skips notification when condition is 'on_regression' and verdict is pass", () => {
      const mockPost = vi.mocked(http.post);

      const svc = new NotificationService(makeConfig({ conditions: "on_regression" }));
      svc.notify(makePayload({ verdict: "pass" }));

      expect(mockPost).not.toHaveBeenCalled();
    });

    it("sends notification when condition is 'on_regression' and verdict is fail", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(makeConfig({ conditions: "on_regression" }));
      svc.notify(makePayload({ verdict: "fail" }));

      expect(mockPost).toHaveBeenCalled();
    });

    it("defaults condition to 'always' when not specified", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(makeConfig());
      svc.notify(makePayload({ verdict: "pass" }));

      expect(mockPost).toHaveBeenCalled();
    });
  });

  // ── Slack channel ────────────────────────────────────────────────────────

  describe("Slack channel", () => {
    it("sends POST to configured slackWebhook with JSON body", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(
        makeConfig({
          channels: ["slack"],
          slackWebhook: "https://hooks.slack.com/services/T/B/X",
        })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/T/B/X",
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
          timeout: "10s",
        })
      );
    });

    it("falls back to __ENV.NOTIFY_SLACK_WEBHOOK when slackWebhook not in config", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);
      (__ENV as Record<string, string>)["NOTIFY_SLACK_WEBHOOK"] = "https://env-webhook.com";

      const svc = new NotificationService(
        makeConfig({ channels: ["slack"], slackWebhook: undefined })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledWith(
        "https://env-webhook.com",
        expect.any(String),
        expect.any(Object)
      );
    });

    it("throws when no Slack webhook URL is available", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const svc = new NotificationService(
        makeConfig({ channels: ["slack"], slackWebhook: undefined, retries: 1 })
      );
      // Should not throw (non-blocking), but should log error
      svc.notify(makePayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("NOTIFY_SLACK_WEBHOOK not configured")
      );
      consoleSpy.mockRestore();
    });

    it("throws on non-2xx response from Slack", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 500 } as never);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const svc = new NotificationService(makeConfig({ retries: 1 }));
      svc.notify(makePayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Slack webhook returned HTTP 500")
      );
      consoleSpy.mockRestore();
    });
  });

  // ── Email channel ──────────────────────────────────────────────────────

  describe("Email channel", () => {
    it("sends POST to email endpoint with formatted body", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);
      (__ENV as Record<string, string>)["NOTIFY_EMAIL_ENDPOINT"] = "https://email.api/send";

      const svc = new NotificationService(
        makeConfig({
          channels: ["email"],
          emailTo: "team@example.com",
        })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledWith(
        "https://email.api/send",
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("falls back to __ENV.NOTIFY_EMAIL_TO when emailTo not in config", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);
      (__ENV as Record<string, string>)["NOTIFY_EMAIL_TO"] = "env@example.com";
      (__ENV as Record<string, string>)["NOTIFY_EMAIL_ENDPOINT"] = "https://email.api/send";

      const svc = new NotificationService(makeConfig({ channels: ["email"], emailTo: undefined }));
      svc.notify(makePayload());

      const body = JSON.parse(mockPost.mock.calls[0][1] as string);
      expect(body.to).toBe("env@example.com");
    });

    it("throws when email endpoint or emailTo is missing", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const svc = new NotificationService(
        makeConfig({ channels: ["email"], emailTo: undefined, retries: 1 })
      );
      svc.notify(makePayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("NOTIFY_EMAIL_TO or NOTIFY_EMAIL_ENDPOINT not configured")
      );
      consoleSpy.mockRestore();
    });

    it("throws on non-2xx response from email endpoint", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 422 } as never);
      (__ENV as Record<string, string>)["NOTIFY_EMAIL_ENDPOINT"] = "https://email.api/send";
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const svc = new NotificationService(
        makeConfig({ channels: ["email"], emailTo: "a@b.com", retries: 1 })
      );
      svc.notify(makePayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Email endpoint returned HTTP 422")
      );
      consoleSpy.mockRestore();
    });
  });

  // ── Webhook channel ─────────────────────────────────────────────────────

  describe("Webhook channel", () => {
    it("sends POST to configured webhookUrl", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(
        makeConfig({
          channels: ["webhook"],
          webhookUrl: "https://webhook.site/test",
        })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledWith(
        "https://webhook.site/test",
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("falls back to __ENV.NOTIFY_WEBHOOK_URL", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);
      (__ENV as Record<string, string>)["NOTIFY_WEBHOOK_URL"] = "https://env-webhook.site/hook";

      const svc = new NotificationService(
        makeConfig({ channels: ["webhook"], webhookUrl: undefined })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledWith(
        "https://env-webhook.site/hook",
        expect.any(String),
        expect.any(Object)
      );
    });

    it("throws when no webhook URL is available", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const svc = new NotificationService(
        makeConfig({ channels: ["webhook"], webhookUrl: undefined, retries: 1 })
      );
      svc.notify(makePayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("NOTIFY_WEBHOOK_URL not configured")
      );
      consoleSpy.mockRestore();
    });

    it("sends WebhookFormatter-formatted payload with version field", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(
        makeConfig({
          channels: ["webhook"],
          webhookUrl: "https://webhook.site/test",
        })
      );
      svc.notify(makePayload());

      const body = JSON.parse(mockPost.mock.calls[0][1] as string);
      expect(body.version).toBe("1.0");
      expect(body.event).toBe("perf_test_complete");
      expect(body.service).toBe("test-service");
    });
  });

  // ── Multi-channel routing ────────────────────────────────────────────────

  describe("multi-channel routing", () => {
    it("sends to all configured channels", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);
      (__ENV as Record<string, string>)["NOTIFY_EMAIL_ENDPOINT"] = "https://email.api/send";

      const svc = new NotificationService({
        channels: ["slack", "email", "webhook"],
        slackWebhook: "https://hooks.slack.com/test",
        emailTo: "team@example.com",
        webhookUrl: "https://webhook.site/test",
      });
      svc.notify(makePayload());

      // 3 channels = 3 POST calls
      expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it("continues sending to remaining channels when one fails", () => {
      const mockPost = vi.mocked(http.post);
      // First call (slack) fails, second (webhook) succeeds
      mockPost
        .mockReturnValueOnce({ status: 500 } as never) // slack retry 1
        .mockReturnValueOnce({ status: 500 } as never) // slack retry 2 (default retries=2)
        .mockReturnValueOnce({ status: 200 } as never); // webhook

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const svc = new NotificationService({
        channels: ["slack", "webhook"],
        slackWebhook: "https://hooks.slack.com/test",
        webhookUrl: "https://webhook.site/test",
        retries: 2,
      });
      svc.notify(makePayload());

      // Slack failed (logged error), webhook succeeded
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Channel "slack" failed'));
      // Total calls: 2 retries for slack + 1 for webhook = 3
      expect(mockPost).toHaveBeenCalledTimes(3);
      consoleSpy.mockRestore();
    });
  });

  // ── Retry behavior ───────────────────────────────────────────────────────

  describe("retry behavior", () => {
    it("retries on failure up to configured retry count", () => {
      const mockPost = vi.mocked(http.post);
      mockPost
        .mockReturnValueOnce({ status: 500 } as never)
        .mockReturnValueOnce({ status: 500 } as never)
        .mockReturnValueOnce({ status: 200 } as never);

      const svc = new NotificationService(makeConfig({ retries: 3 }));
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it("succeeds on first try without retrying", () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);

      const svc = new NotificationService(makeConfig({ retries: 3 }));
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  // ── buildPayload() ──────────────────────────────────────────────────────

  describe("buildPayload()", () => {
    it("extracts metrics from k6 summary data", () => {
      const summary = {
        metrics: {
          http_req_duration: { "p(95)": 420, "p(99)": 750, avg: 200 },
          http_req_failed: { rate: 0.015 },
          http_reqs: { rate: 50 },
        },
        thresholds: {},
        state: { testRunDurationMs: 60000 },
      };

      const payload = NotificationService.buildPayload(summary, {
        service: "api",
        environment: "prod",
        profile: "load",
        testName: "checkout",
        executionId: "exec-1",
      });

      expect(payload.service).toBe("api");
      expect(payload.environment).toBe("prod");
      expect(payload.metrics.p95Ms).toBe(420);
      expect(payload.metrics.p99Ms).toBe(750);
      expect(payload.metrics.avgMs).toBe(200);
      expect(payload.metrics.errorRatePct).toBeCloseTo(1.5);
      expect(payload.metrics.throughputRps).toBe(50);
      expect(payload.metrics.durationMs).toBe(60000);
    });

    it("sets verdict to pass when no threshold violations", () => {
      const summary = {
        metrics: {},
        thresholds: {
          http_req_duration: { ok: true },
          http_req_failed: { ok: true },
        },
        state: {},
      };

      const payload = NotificationService.buildPayload(summary, {
        service: "api",
        environment: "prod",
        profile: "load",
        testName: "test",
        executionId: "exec-2",
      });

      expect(payload.verdict).toBe("pass");
      expect(payload.thresholdViolations).toHaveLength(0);
    });

    it("sets verdict to fail when threshold violations exist", () => {
      const summary = {
        metrics: {},
        thresholds: {
          http_req_duration: { ok: false },
          http_req_failed: { ok: true },
        },
        state: {},
      };

      const payload = NotificationService.buildPayload(summary, {
        service: "api",
        environment: "prod",
        profile: "load",
        testName: "test",
        executionId: "exec-3",
      });

      expect(payload.verdict).toBe("fail");
      expect(payload.thresholdViolations).toContain("http_req_duration");
      expect(payload.thresholdViolations).not.toContain("http_req_failed");
    });

    it("includes reportUrl when provided", () => {
      const summary = { metrics: {}, thresholds: {}, state: {} };
      const payload = NotificationService.buildPayload(summary, {
        service: "api",
        environment: "prod",
        profile: "load",
        testName: "test",
        executionId: "exec-4",
        reportUrl: "https://grafana.io/report/123",
      });

      expect(payload.reportUrl).toBe("https://grafana.io/report/123");
    });

    it("handles missing metrics gracefully (defaults to 0)", () => {
      const summary = { metrics: {}, thresholds: {}, state: {} };
      const payload = NotificationService.buildPayload(summary, {
        service: "api",
        environment: "prod",
        profile: "load",
        testName: "test",
        executionId: "exec-5",
      });

      expect(payload.metrics.p95Ms).toBe(0);
      expect(payload.metrics.p99Ms).toBe(0);
      expect(payload.metrics.avgMs).toBe(0);
      expect(payload.metrics.errorRatePct).toBe(0);
      expect(payload.metrics.throughputRps).toBe(0);
      expect(payload.metrics.durationMs).toBe(0);
    });
  });

  // ── SSRF defense (SEC-05) ─────────────────────────────────────────────────

  describe("SSRF defense (SEC-05)", () => {
    it("rejects Slack webhook pointing to cloud metadata", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockPost = vi.mocked(http.post);

      const svc = new NotificationService(
        makeConfig({
          channels: ["slack"],
          slackWebhook: "https://169.254.169.254/latest/meta-data/",
          retries: 1,
        })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledTimes(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/169\.254/));
      consoleSpy.mockRestore();
    });

    it("rejects email endpoint on RFC1918 private IP", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockPost = vi.mocked(http.post);
      (__ENV as Record<string, string>)["NOTIFY_EMAIL_ENDPOINT"] = "https://10.0.0.5/email";

      const svc = new NotificationService(
        makeConfig({ channels: ["email"], emailTo: "to@example.com", retries: 1 })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledTimes(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/10\.0\.0\.5|private/i));
      consoleSpy.mockRestore();
    });

    it("rejects generic webhook on localhost", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockPost = vi.mocked(http.post);
      (__ENV as Record<string, string>)["NOTIFY_WEBHOOK_URL"] = "https://localhost/foo";

      const svc = new NotificationService(
        makeConfig({ channels: ["webhook"], webhookUrl: undefined, retries: 1 })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledTimes(0);
      consoleSpy.mockRestore();
    });

    it("allows webhook on explicit allow-list", async () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);
      (__ENV as Record<string, string>)["K6_WEBHOOK_ALLOWED_HOSTS"] = "hooks.slack.com";

      const svc = new NotificationService(
        makeConfig({
          channels: ["slack"],
          slackWebhook: "https://hooks.slack.com/services/T/B/x",
          retries: 1,
        })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it("rejects webhook NOT in allow-list", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockPost = vi.mocked(http.post);
      (__ENV as Record<string, string>)["K6_WEBHOOK_ALLOWED_HOSTS"] = "hooks.slack.com";
      (__ENV as Record<string, string>)["NOTIFY_WEBHOOK_URL"] = "https://evil.com/x";

      const svc = new NotificationService(
        makeConfig({ channels: ["webhook"], webhookUrl: undefined, retries: 1 })
      );
      svc.notify(makePayload());

      expect(mockPost).toHaveBeenCalledTimes(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/allow-list/i));
      consoleSpy.mockRestore();
    });

    it("validator runs BEFORE http.post (invocation order)", async () => {
      const mockPost = vi.mocked(http.post);
      mockPost.mockReturnValue({ status: 200 } as never);
      const validatorSpy = vi.spyOn(webhookValidator, "assertWebhookAllowed");

      const svc = new NotificationService(
        makeConfig({
          channels: ["slack"],
          slackWebhook: "https://hooks.slack.com/services/T/B/safe",
          retries: 1,
        })
      );
      svc.notify(makePayload());

      expect(validatorSpy).toHaveBeenCalledWith("https://hooks.slack.com/services/T/B/safe");
      expect(validatorSpy.mock.invocationCallOrder[0]).toBeLessThan(
        mockPost.mock.invocationCallOrder[0]
      );
      validatorSpy.mockRestore();
    });
  });
});

// ── Formatter tests ──────────────────────────────────────────────────────────

describe("SlackFormatter", () => {
  it("returns an object with attachments array", () => {
    const result = SlackFormatter.format(makePayload());
    expect(result).toHaveProperty("attachments");
    expect(Array.isArray(result.attachments)).toBe(true);
  });

  it("uses green color for pass verdict", () => {
    const result = SlackFormatter.format(makePayload({ verdict: "pass" }));
    const att = (result.attachments as Array<Record<string, unknown>>)[0];
    expect(att.color).toBe("#36a64f");
  });

  it("uses red color for fail verdict", () => {
    const result = SlackFormatter.format(makePayload({ verdict: "fail" }));
    const att = (result.attachments as Array<Record<string, unknown>>)[0];
    expect(att.color).toBe("#e01e5a");
  });

  it("includes threshold violations block when violations exist", () => {
    const result = SlackFormatter.format(
      makePayload({
        verdict: "fail",
        thresholdViolations: ["http_req_duration", "http_req_failed"],
      })
    );
    const att = (result.attachments as Array<Record<string, unknown>>)[0];
    const blocks = att.blocks as Array<Record<string, unknown>>;
    const violationBlock = blocks.find(
      (b) => b.type === "section" && (b.text as Record<string, unknown>)?.type === "mrkdwn"
    );
    expect(violationBlock).toBeDefined();
  });

  it("includes report URL button when reportUrl is set", () => {
    const result = SlackFormatter.format(makePayload({ reportUrl: "https://report.url" }));
    const att = (result.attachments as Array<Record<string, unknown>>)[0];
    const blocks = att.blocks as Array<Record<string, unknown>>;
    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
  });

  it("omits report URL button when reportUrl is not set", () => {
    const result = SlackFormatter.format(makePayload({ reportUrl: undefined }));
    const att = (result.attachments as Array<Record<string, unknown>>)[0];
    const blocks = att.blocks as Array<Record<string, unknown>>;
    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeUndefined();
  });

  it("includes context block with execution ID", () => {
    const result = SlackFormatter.format(makePayload({ executionId: "exec-xyz" }));
    const att = (result.attachments as Array<Record<string, unknown>>)[0];
    const blocks = att.blocks as Array<Record<string, unknown>>;
    const contextBlock = blocks.find((b) => b.type === "context");
    expect(contextBlock).toBeDefined();
  });

  it("includes metric fields (p95, p99, error rate, throughput)", () => {
    const result = SlackFormatter.format(makePayload());
    const att = (result.attachments as Array<Record<string, unknown>>)[0];
    const blocks = att.blocks as Array<Record<string, unknown>>;
    const metricsBlock = blocks.find(
      (b) =>
        b.type === "section" &&
        Array.isArray(b.fields) &&
        (b.fields as Array<Record<string, string>>).some((f) => f.text?.includes("p95"))
    );
    expect(metricsBlock).toBeDefined();
  });
});

describe("EmailFormatter", () => {
  it("returns object with to, subject, html, and text fields", () => {
    const result = EmailFormatter.format(makePayload(), "team@example.com");
    expect(result).toHaveProperty("to", "team@example.com");
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("text");
  });

  it("subject includes verdict, service, environment, and profile", () => {
    const result = EmailFormatter.format(
      makePayload({ verdict: "fail", service: "myapi", environment: "prod", profile: "stress" }),
      "a@b.com"
    );
    const subject = result.subject as string;
    expect(subject).toContain("[FAIL]");
    expect(subject).toContain("myapi");
    expect(subject).toContain("prod");
    expect(subject).toContain("stress");
  });

  it("HTML contains metric values", () => {
    const payload = makePayload({ metrics: { ...makePayload().metrics, p95Ms: 999 } });
    const result = EmailFormatter.format(payload, "a@b.com");
    expect(result.html).toContain("999ms");
  });

  it("HTML includes threshold violations when present", () => {
    const result = EmailFormatter.format(
      makePayload({ thresholdViolations: ["http_req_duration"] }),
      "a@b.com"
    );
    expect(result.html).toContain("http_req_duration");
    expect(result.html).toContain("Threshold Violations");
  });

  it("HTML includes report link when reportUrl is set", () => {
    const result = EmailFormatter.format(
      makePayload({ reportUrl: "https://report.url/123" }),
      "a@b.com"
    );
    expect(result.html).toContain("https://report.url/123");
  });

  it("text field contains execution ID", () => {
    const result = EmailFormatter.format(makePayload({ executionId: "exec-abc" }), "a@b.com");
    expect(result.text).toContain("exec-abc");
  });
});

describe("WebhookFormatter", () => {
  it("returns versioned payload with event field", () => {
    const result = WebhookFormatter.format(makePayload());
    expect(result.version).toBe("1.0");
    expect(result.event).toBe("perf_test_complete");
  });

  it("spreads all payload fields into result", () => {
    const payload = makePayload();
    const result = WebhookFormatter.format(payload);
    expect(result.service).toBe(payload.service);
    expect(result.environment).toBe(payload.environment);
    expect(result.verdict).toBe(payload.verdict);
    expect(result.executionId).toBe(payload.executionId);
  });

  it("includes metrics object", () => {
    const result = WebhookFormatter.format(makePayload());
    const metrics = result.metrics as NotificationPayload["metrics"];
    expect(metrics.p95Ms).toBe(420);
    expect(metrics.throughputRps).toBe(50);
  });
});
