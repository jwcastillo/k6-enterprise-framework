/**
 * T-141: Bot engine platform-agnostic para ejecucion de tests
 *
 * Motor generico que expone una interfaz platform-agnostic para recibir
 * comandos de performance test y devolver resultados.
 *
 * Caracteristicas:
 * - Parser de comandos: /perf run --client=X --test=Y --profile=smoke
 * - Validacion de identidad y permisos via RBAC antes de ejecucion
 * - Ack en <3 segundos garantizado
 * - Cola de concurrencia (un test por client/test a la vez)
 * - /perf status para tests en ejecucion
 * - /perf help para discovery de comandos
 *
 * Node.js context only — NOT for use inside k6 scripts.
 *
 * CHK-API-008 a CHK-API-014
 */

import { parsePerfCommand, HELP_TEXT } from "./bot-interface.js";
import type { BotCommand, BotResponse, BotAdapter } from "./bot-interface.js";
import { authorizeBotCommand } from "../../core/cli-auth.js";
import { checkProfilePermission } from "../../core/rbac.js";
import type { ClientContext } from "../../types/client.d.js";

const path = require("path") as typeof import("path");
const { spawn } = require("child_process") as typeof import("child_process");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunningTest {
  client: string;
  test: string;
  profile: string;
  userId: string;
  startedAt: Date;
  estimatedDurationMs?: number;
  channelId: string;
}

export interface BotEngineOptions {
  /** Absolute path to the framework root (default: cwd) */
  rootDir?: string;
  /** Path to run-test.sh (default: <rootDir>/bin/run-test.sh) */
  runTestScript?: string;
  /** Max concurrent tests per client (default: 1) */
  maxConcurrentPerClient?: number;
  /** Slack/Teams signing secret for HMAC verification */
  signingSecret?: string;
}

// ── BotEngine ─────────────────────────────────────────────────────────────────

/**
 * Platform-agnostic bot engine.
 * Adapters (Slack, Teams, etc.) call handleCommand() and implement BotAdapter.
 */
export class BotEngine {
  private rootDir: string;
  private runTestScript: string;
  private maxConcurrentPerClient: number;
  private signingSecret?: string;

  // key: "<client>/<test>"
  private runningTests: Map<string, RunningTest> = new Map();
  // key: "<client>/<test>" — queued commands
  private queue: Map<string, BotCommand[]> = new Map();

  constructor(opts: BotEngineOptions = {}) {
    this.rootDir = opts.rootDir ?? process.cwd();
    this.runTestScript = opts.runTestScript ?? path.join(this.rootDir, "bin", "run-test.sh");
    this.maxConcurrentPerClient = opts.maxConcurrentPerClient ?? 1;
    this.signingSecret = opts.signingSecret;
  }

  // ── Entry point ─────────────────────────────────────────────────────────────

  /**
   * Handle an incoming bot command from any platform adapter.
   *
   * Returns an ack response in <3 seconds — long-running tests fire-and-forget.
   *
   * @param rawText    The message text (e.g. "/perf run --client=X --test=Y")
   * @param channelId  Platform channel identifier
   * @param userId     Platform user identifier
   * @param adapter    Platform adapter for sending follow-up messages
   * @param authCtx    Optional HMAC fields for request verification
   */
  async handleCommand(
    rawText: string,
    channelId: string,
    userId: string,
    adapter: BotAdapter,
    authCtx?: {
      timestamp?: number;
      signature?: string;
      rawBody?: string;
    }
  ): Promise<BotResponse> {
    // 1. Authenticate the request (HMAC + replay guard)
    const authResult = authorizeBotCommand({
      userId,
      command: rawText,
      signingSecret: this.signingSecret,
      timestamp: authCtx?.timestamp,
      signature: authCtx?.signature,
      rawBody: authCtx?.rawBody,
    });

    if (!authResult.authorized) {
      return {
        text: `Authentication required. ${authResult.reason ?? "Use /perf auth to configure."}`,
      };
    }

    // 2. Parse the command
    const cmd = parsePerfCommand(rawText, channelId, authResult.userId);
    if (!cmd) {
      return {
        text: "Unknown command. Try `/perf help` for a list of available commands.",
      };
    }

    // 3. Route to handler
    switch (cmd.type) {
      case "help":
        return this.handleHelp();
      case "status":
        return this.handleStatus(cmd);
      case "run":
        return this.handleRun(cmd, adapter);
      default:
        return { text: "Unknown command. Try `/perf help`." };
    }
  }

  // ── /perf help ──────────────────────────────────────────────────────────────

  private handleHelp(): BotResponse {
    return { text: HELP_TEXT };
  }

  // ── /perf status ────────────────────────────────────────────────────────────

  private handleStatus(cmd: BotCommand): BotResponse {
    const running = [...this.runningTests.values()];

    if (running.length === 0) {
      return { text: "No tests currently running." };
    }

    const filtered = cmd.service
      ? running.filter((r) => r.client === cmd.service || r.test === cmd.service)
      : running;

    if (filtered.length === 0) {
      return { text: `No test currently running for *${cmd.service}*.` };
    }

    const lines = filtered.map((r) => {
      const elapsed = Math.round((Date.now() - r.startedAt.getTime()) / 1000);
      const progress = r.estimatedDurationMs
        ? Math.min(99, Math.round(((elapsed * 1000) / r.estimatedDurationMs) * 100))
        : null;
      return [
        `*${r.client}/${r.test}* — profile: \`${r.profile}\``,
        `Started by: ${r.userId} | Elapsed: ${elapsed}s${progress !== null ? ` (${progress}% est.)` : ""}`,
      ].join("\n");
    });

    return { text: lines.join("\n\n") };
  }

  // ── /perf run ───────────────────────────────────────────────────────────────

  private handleRun(cmd: BotCommand, adapter: BotAdapter): BotResponse {
    const client = cmd.service;
    const test = cmd.rawText
      .match(/--test=([^\s]+)/)?.[1]
      ?.replace(/[;|&$`><\n\r\\]/g, "")
      .slice(0, 128);
    const profile = cmd.profile ?? "smoke";

    if (!client) {
      return {
        text: "Missing `--client`. Example: `/perf run --client=miEquipo --test=smoke-users --profile=smoke`",
      };
    }
    if (!test) {
      return {
        text: "Missing `--test`. Example: `/perf run --client=miEquipo --test=smoke-users --profile=smoke`",
      };
    }

    // RBAC check
    const clientRoot = path.join(this.rootDir, "clients", client);
    const clientCtx: ClientContext = {
      clientId: client,
      rootDir: clientRoot,
      configDir: path.join(clientRoot, "config"),
      dataDir: path.join(clientRoot, "data"),
      libDir: path.join(clientRoot, "lib"),
      scenariosDir: path.join(clientRoot, "scenarios"),
      reportsDir: path.join(clientRoot, "reports"),
      envFile: path.join(this.rootDir, "envs", `${client}.env`),
      mocksDir: path.join(clientRoot, "mocks"),
      brandingDir: path.join(clientRoot, "branding"),
      isSubmodule: false,
      isSymlink: false,
    };

    const permission = checkProfilePermission(cmd.userId, profile, clientCtx);
    if (!permission.allowed) {
      return {
        text: [
          `Permission denied. Your role: \`${permission.role}\`.`,
          `${permission.reason ?? `Profile '${profile}' requires a higher role.`}`,
          "Contact your admin to request elevated permissions.",
        ].join("\n"),
      };
    }

    // Concurrency check
    const runKey = `${client}/${test}`;
    if (this.runningTests.has(runKey)) {
      // Queue the command
      if (!this.queue.has(runKey)) this.queue.set(runKey, []);
      this.queue.get(runKey)!.push(cmd);
      return {
        text: `Test already running for *${client}/${test}*. Use \`/perf status\` for progress. Your request has been queued.`,
      };
    }

    // Mark as running (synchronous — ensures ack < 3s)
    const runStatus: RunningTest = {
      client,
      test,
      profile,
      userId: cmd.userId,
      startedAt: new Date(),
      channelId: cmd.channelId,
    };
    this.runningTests.set(runKey, runStatus);

    // Fire-and-forget execution
    this.executeTest(runKey, client, test, profile, cmd, adapter).catch((err) => {
      console.error(`[bot-engine] Execution error for ${runKey}: ${err.message}`);
    });

    return {
      text: `Test started: *${client}/${test}* — profile: \`${profile}\`. I'll report back when it's done.`,
    };
  }

  // ── Test execution ──────────────────────────────────────────────────────────

  private async executeTest(
    runKey: string,
    client: string,
    test: string,
    profile: string,
    cmd: BotCommand,
    adapter: BotAdapter
  ): Promise<void> {
    let exitCode = 0;
    let _output = "";

    try {
      exitCode = await this.spawnTest(client, test, profile, (line) => {
        _output += line + "\n";
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.runningTests.delete(runKey);
      await adapter
        .respond(cmd.channelId, {
          text: `Test failed: *${client}/${test}* — ${message}`,
        })
        .catch(console.error);
      this.processQueue(runKey, adapter);
      return;
    }

    this.runningTests.delete(runKey);

    const status =
      exitCode === 0
        ? `Test complete: *${client}/${test}* — profile \`${profile}\` passed.`
        : exitCode === 99
          ? `Threshold failure: *${client}/${test}* — one or more thresholds exceeded.`
          : `Test finished with exit code ${exitCode}: *${client}/${test}*.`;

    await adapter.respond(cmd.channelId, { text: status }).catch(console.error);
    this.processQueue(runKey, adapter);
  }

  private spawnTest(
    client: string,
    test: string,
    profile: string,
    onLine: (line: string) => void
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [`--client=${client}`, `--scenario=${test}`, `--profile=${profile}`];

      const child = spawn("bash", [this.runTestScript, ...args], {
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (d: Buffer) => {
        d.toString().split("\n").filter(Boolean).forEach(onLine);
      });
      child.stderr?.on("data", (d: Buffer) => {
        d.toString().split("\n").filter(Boolean).forEach(onLine);
      });

      child.on("error", reject);
      child.on("close", (code: number | null) => resolve(code ?? 1));
    });
  }

  private processQueue(runKey: string, adapter: BotAdapter): void {
    const pending = this.queue.get(runKey);
    if (!pending || pending.length === 0) return;
    const next = pending.shift()!;
    if (pending.length === 0) this.queue.delete(runKey);
    // Re-enter handleRun for the next queued command
    const [client, test] = runKey.split("/");
    const profile = next.profile ?? "smoke";
    const runStatus: RunningTest = {
      client,
      test,
      profile,
      userId: next.userId,
      startedAt: new Date(),
      channelId: next.channelId,
    };
    this.runningTests.set(runKey, runStatus);
    this.executeTest(runKey, client, test, profile, next, adapter).catch(console.error);
  }

  // ── Introspection ───────────────────────────────────────────────────────────

  /** Returns list of currently running tests (for health checks / monitoring) */
  getRunningTests(): RunningTest[] {
    return [...this.runningTests.values()];
  }

  /** Returns queue depth per run key */
  getQueueDepths(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, cmds] of this.queue) {
      result[key] = cmds.length;
    }
    return result;
  }
}
