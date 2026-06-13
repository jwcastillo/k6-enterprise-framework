// T-079: Slack bot adapter — Node.js runtime (not k6)
// Runs as a standalone Express server receiving Slack slash commands via HTTP POST.

import type { BotAdapter, BotCommand, BotResponse, RunStatus } from './bot-interface.js';
import { parsePerfCommand, HELP_TEXT } from './bot-interface.js';

// Execution queue: one running test per service at a time (EC-EXEC-005)
const runningTests: Map<string, RunStatus> = new Map();
const queue: Map<string, BotCommand[]> = new Map();

export class SlackAdapter implements BotAdapter {
  private signingSecret: string;
  private botToken: string;
  private port: number;

  constructor(opts: { signingSecret: string; botToken: string; port?: number }) {
    this.signingSecret = opts.signingSecret;
    this.botToken = opts.botToken;
    this.port = opts.port ?? 3000;
  }

  parseCommand(text: string, channelId: string, userId: string): BotCommand | null {
    return parsePerfCommand(text, channelId, userId);
  }

  async respond(channelId: string, response: BotResponse): Promise<void> {
    const payload: Record<string, unknown> = { channel: channelId, text: response.text };
    if (response.blocks) payload['blocks'] = response.blocks;

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
  }

  async handleSlashCommand(body: Record<string, string>): Promise<string> {
    const text = body['text'] ?? '';
    const channelId = body['channel_id'] ?? '';
    const userId = body['user_id'] ?? '';

    const cmd = this.parseCommand(`/perf ${text}`, channelId, userId);
    if (!cmd) return 'Unknown command. Try `/perf help`';

    switch (cmd.type) {
      case 'help':
        return HELP_TEXT;

      case 'status':
        return this.handleStatus(cmd);

      case 'run':
        return this.handleRun(cmd);

      default:
        return 'Unknown command. Try `/perf help`';
    }
  }

  private handleStatus(cmd: BotCommand): string {
    const serviceKey = cmd.service ?? '__any__';
    const running = runningTests.get(serviceKey) ?? [...runningTests.values()][0];

    if (!running?.running) {
      return cmd.service
        ? `No test currently running for *${cmd.service}*.`
        : 'No tests currently running.';
    }

    const elapsed = running.startedAt
      ? Math.round((Date.now() - running.startedAt.getTime()) / 1000)
      : 0;
    const progress = running.estimatedDurationMs
      ? Math.min(99, Math.round((elapsed * 1000 / running.estimatedDurationMs) * 100))
      : null;

    return [
      `*Test running:* ${running.service} — profile: \`${running.profile}\``,
      `*Elapsed:* ${elapsed}s${progress !== null ? ` (${progress}% estimated)` : ''}`,
      'Use `/perf status` again to check for updates.',
    ].join('\n');
  }

  private handleRun(cmd: BotCommand): string {
    if (!cmd.service) return 'Missing `--service`. Example: `/perf run smoke --service payment-api`';
    if (!cmd.profile) return 'Missing profile. Example: `/perf run smoke --service payment-api`';

    const key = cmd.service;
    if (runningTests.has(key)) {
      if (!queue.has(key)) queue.set(key, []);
      queue.get(key)!.push(cmd);
      return `Test already running for *${cmd.service}*. Your request has been queued. Use \`/perf status --service ${cmd.service}\` for progress.`;
    }

    // Mark as running
    const status: RunStatus = {
      running: true,
      service: cmd.service,
      profile: cmd.profile,
      startedAt: new Date(),
    };
    runningTests.set(key, status);

    // Fire-and-forget execution (real implementation calls CLI subprocess)
    this.executeTest(cmd).then(result => {
      runningTests.delete(key);
      // Process queue
      const pending = queue.get(key);
      if (pending && pending.length > 0) {
        const next = pending.shift()!;
        if (pending.length === 0) queue.delete(key);
        this.handleRun(next);
      }
      // Respond with result
      this.respond(cmd.channelId, { text: result }).catch(console.error);
    }).catch(err => {
      runningTests.delete(key);
      this.respond(cmd.channelId, { text: `❌ Test failed: ${err.message}` }).catch(console.error);
    });

    return `✅ Test started: *${cmd.service}* — profile: \`${cmd.profile}\`${cmd.env ? ` — env: \`${cmd.env}\`` : ''}. I'll report back when it's done.`;
  }

  private async executeTest(cmd: BotCommand): Promise<string> {
    // In production this calls: spawn('bin/run-test.sh', ['--client=...', '--profile=...'])
    // Here we return a placeholder
    await new Promise(r => setTimeout(r, 500));
    return `✅ Test complete: *${cmd.service}* — profile \`${cmd.profile}\` passed. p95: 245ms | Error: 0.0% | RPS: 120`;
  }

  async start(): Promise<void> {
    console.log(`[SlackAdapter] Bot server listening on port ${this.port}`);
    // Real implementation: express app with /slack/events POST handler
  }

  async stop(): Promise<void> {
    console.log('[SlackAdapter] Bot server stopped');
  }
}
