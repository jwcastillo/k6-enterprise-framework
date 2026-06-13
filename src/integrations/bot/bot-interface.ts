// T-079: Bot conversacional — interfaz de comandos platform-agnostic
// Nota: La ejecucion real del bot corre en Node.js (bin/bot-server.js), no dentro de k6.
// Este archivo define los tipos e interfaces para el adaptador de bot.

export interface BotCommand {
  type: 'help' | 'run' | 'status';
  profile?: string;
  service?: string;
  env?: string;
  rawText: string;
  channelId: string;
  userId: string;
}

export interface BotResponse {
  text: string;
  blocks?: unknown[];  // Slack Block Kit blocks
}

export interface BotAdapter {
  /** Parse incoming message text into a BotCommand */
  parseCommand(text: string, channelId: string, userId: string): BotCommand | null;
  /** Send a response back to the channel */
  respond(channelId: string, response: BotResponse): Promise<void>;
  /** Start listening for incoming messages */
  start(): Promise<void>;
  /** Stop the bot */
  stop(): Promise<void>;
}

export interface RunStatus {
  running: boolean;
  service?: string;
  profile?: string;
  startedAt?: Date;
  estimatedDurationMs?: number;
}

/** Sanitize bot command parameters against shell injection (CHK-SEC-033) */
export function sanitizeBotParam(value: string): string {
  // Remove shell-dangerous characters: ; | && $() ` > < \n \r
  return value.replace(/[;|&$`><\n\r\\]/g, '').trim().slice(0, 128);
}

/** Parse /perf command from message text */
export function parsePerfCommand(
  text: string,
  channelId: string,
  userId: string
): BotCommand | null {
  const cleaned = text.trim();
  if (!cleaned.startsWith('/perf') && !cleaned.startsWith('perf ')) return null;

  const parts = cleaned.replace(/^\/perf\s*/, '').replace(/^perf\s+/, '').split(/\s+/);
  const subCmd = (parts[0] ?? '').toLowerCase();

  if (subCmd === 'help' || subCmd === '') {
    return { type: 'help', rawText: text, channelId, userId };
  }

  if (subCmd === 'status') {
    const service = parts.find(p => p.startsWith('--service='))?.split('=')[1];
    return { type: 'status', service: service ? sanitizeBotParam(service) : undefined, rawText: text, channelId, userId };
  }

  if (subCmd === 'run') {
    const profile = parts[1] ? sanitizeBotParam(parts[1]) : undefined;
    const service = parts.find(p => p.startsWith('--service='))?.split('=')[1];
    const env = parts.find(p => p.startsWith('--env='))?.split('=')[1];
    return {
      type: 'run',
      profile,
      service: service ? sanitizeBotParam(service) : undefined,
      env: env ? sanitizeBotParam(env) : undefined,
      rawText: text,
      channelId,
      userId,
    };
  }

  return null;
}

export const HELP_TEXT = `
*Performance Bot Commands:*

\`/perf help\` — Show this help message

\`/perf run <profile> --service <name> [--env <env>]\`
  Run a performance test.
  Example: \`/perf run smoke --service payment-api --env staging\`

\`/perf status [--service <name>]\`
  Check status of running test or last result.
  Example: \`/perf status --service payment-api\`

_Profiles: smoke, load, stress, soak, breakpoint_
`;
