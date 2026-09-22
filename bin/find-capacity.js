#!/usr/bin/env node
// bin/find-capacity.js — search for the highest arrival rate a target sustains.
//
// Runs one scenario repeatedly at fixed rates: exponential ramp until a rate fails,
// binary search between the last passing and first failing rate, then confirmation runs
// at the winner. Each step is a normal run-test.sh execution with an arrival-rate profile
// whose rate is overridden through K6_ARRIVAL_RATE.
//
// Usage:
//   node bin/find-capacity.js --client=examples --scenario=api/checkout \
//     --start-rps=10 --max-rps=200 --step-duration=30
//
// A capacity search pushes the target until it breaks, so a non-local target is refused
// unless you pass --i-own-this-target.
//
// Exit codes: 0 = a sustainable rate was found, 1 = nothing passed, 2 = usage error or
// the search aborted (broken script or environment, not a capacity limit).

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { collectBaseUrls, resolveConfigPath } = require("./target-guard.js");

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * Evaluate one finished step.
 * @returns {string[]} reasons the step failed (empty = passed)
 */
function evaluateSummary(summary, { rps, durationSeconds, minAchievedRatio, exitCode }) {
  const reasons = [];
  const metrics = summary.metrics || {};

  // In --summary-export a threshold value of true means FAILED
  for (const [metric, data] of Object.entries(metrics)) {
    for (const [expr, failed] of Object.entries((data && data.thresholds) || {})) {
      const crossed = failed && typeof failed === "object" ? failed.ok === false : failed === true;
      if (crossed) reasons.push(`threshold crossed: ${metric} ${expr}`);
    }
  }
  if (exitCode === 99 && reasons.length === 0) {
    reasons.push("run exited 99 (thresholds or gate failed)");
  }

  const dropped = (metrics.dropped_iterations && metrics.dropped_iterations.count) || 0;
  if (dropped > 0) {
    reasons.push(`${dropped} dropped iterations (the generator could not start them)`);
  }

  // count / step duration, because the exported "rate" is diluted by setup and graceful stop
  const achieved = ((metrics.iterations && metrics.iterations.count) || 0) / durationSeconds;
  if (achieved < rps * minAchievedRatio) {
    reasons.push(
      `achieved ${achieved.toFixed(1)}/s is below ${minAchievedRatio * 100}% of requested ${rps}/s`
    );
  }
  return reasons;
}

/**
 * Search for the highest sustainable rate.
 * `runStep` must throw when the script or environment is broken — that aborts the search
 * instead of recording a false capacity limit.
 */
async function search({
  runStep,
  startRps,
  maxRps,
  resolutionRps,
  confirmRuns = 2,
  retries = 1,
  wait = async () => {},
  onStep = () => {},
}) {
  const steps = [];

  /** Run one rate, retrying up to `retries` times. True when any attempt passed. */
  const attempt = async (rps, phase) => {
    for (let i = 0; i <= retries; i++) {
      if (steps.length > 0) await wait();
      const step = { rps, phase, ...(await runStep(rps)) };
      steps.push(step);
      onStep(step);
      if (step.passed) return true;
    }
    return false;
  };

  // 1. Exponential phase
  let low = 0;
  let high = null;
  for (let rps = startRps; high === null; rps = Math.min(rps * 2, maxRps)) {
    if (!(await attempt(rps, "ramp"))) high = rps;
    else {
      low = rps;
      if (rps >= maxRps) break;
    }
  }

  // 2. Binary phase
  while (low > 0 && high !== null && high - low > resolutionRps) {
    const mid = Math.floor((low + high) / 2);
    if (await attempt(mid, "binary")) low = mid;
    else high = mid;
  }

  // 3. Confirmation, stepping down by the resolution on failure
  while (low > 0) {
    let ok = true;
    for (let i = 0; i < confirmRuns && ok; i++) ok = await attempt(low, "confirm");
    if (ok) break;
    high = low;
    low = low > startRps ? Math.max(startRps, low - resolutionRps) : 0;
  }

  return { highestSustainableRps: low, firstFailingRps: high, confirmed: low > 0 && confirmRuns > 0, steps };
}

/**
 * A capacity search only means something when the scenario takes its rate from the profile:
 * a scenario with a hardcoded `options` object runs at the same load on every step, and the
 * search would report a "capacity" that is really just the last step that happened to pass.
 */
function usesProfileOptions(source) {
  return /\b(buildOptions|buildK6Options|profileToOptions)\s*\(/.test(source);
}

/** Resolve a scenario path the way run-test.sh does: clients/<client>/scenarios/<scenario>. */
function scenarioSourcePath(client, scenario) {
  const withExt = /\.[tj]s$/.test(scenario) ? scenario : `${scenario}.ts`;
  return path.join(ROOT_DIR, "clients", client, "scenarios", withExt);
}

/** Every baseUrl the client config points at, for the local-target check. */
function resolveTargets(client, envName) {
  const configPath = resolveConfigPath(ROOT_DIR, client, envName);
  if (!configPath) return [];
  return collectBaseUrls(JSON.parse(fs.readFileSync(configPath, "utf8"))).map((t) => t.raw);
}

/** Newest summary-*.json in the artifacts directory of this client + scenario. */
function newestSummary(artifactsDir, exclude) {
  if (!fs.existsSync(artifactsDir)) return null;
  const found = fs
    .readdirSync(artifactsDir)
    .filter((f) => /^summary-.*\.json$/.test(f) && !exclude.has(f))
    .sort();
  return found.length > 0 ? path.join(artifactsDir, found[found.length - 1]) : null;
}

/** Build the step runner: one run-test.sh execution per rate. */
function createRunStep(opts, artifactsDir) {
  let built = false;

  return (rps) =>
    new Promise((resolve, reject) => {
      const before = new Set(
        fs.existsSync(artifactsDir) ? fs.readdirSync(artifactsDir) : []
      );
      const args = [
        path.join(ROOT_DIR, "bin", "run-test.sh"),
        `--client=${opts.client}`,
        `--scenario=${opts.scenario}`,
        `--env=${opts.env}`,
        `--profile=${opts.profile}`,
      ];
      // The bundle only has to be built once for the whole search
      if (built) args.push("--skip-build");

      console.log(`[capacity] Running ${rps} rps for ${opts.stepDuration}s...`);
      const child = spawn("bash", args, {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          K6_ARRIVAL_RATE: String(rps),
          K6_STEP_DURATION: `${opts.stepDuration}s`,
        },
      });

      let output = "";
      child.stdout.on("data", (d) => (output += d.toString()));
      child.stderr.on("data", (d) => (output += d.toString()));
      child.on("error", (err) => reject(new Error(`Failed to start run-test.sh: ${err.message}`)));

      child.on("close", (code) => {
        try {
          built = true;
          // 0 = clean, 99 = thresholds or gate failed (a capacity signal). Anything else is
          // a broken script or environment and must not be read as a capacity limit.
          if (code !== 0 && code !== 99) {
            throw new Error(
              `run-test.sh exited ${code} at ${rps} rps — broken script or environment, not a capacity limit.\n${output.slice(-1500)}`
            );
          }
          const summaryPath = newestSummary(artifactsDir, before);
          if (!summaryPath) throw new Error(`No summary-*.json was written to ${artifactsDir} at ${rps} rps`);

          const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
          const reasons = evaluateSummary(summary, {
            rps,
            durationSeconds: opts.stepDuration,
            minAchievedRatio: opts.minAchievedRatio,
            exitCode: code,
          });
          resolve({ passed: reasons.length === 0, reasons, summaryPath });
        } catch (err) {
          reject(err);
        }
      });
    });
}

/** Between steps: fixed cooldown, or poll the health URL until it answers 2xx. */
async function waitBetweenSteps(opts) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!opts.healthUrl) return sleep(opts.cooldown * 1000);

  const deadline = Date.now() + opts.healthTimeout * 1000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(opts.healthUrl)).ok) return undefined;
    } catch {
      // target still recovering
    }
    await sleep(2000);
  }
  throw new Error(`Health check ${opts.healthUrl} did not answer 2xx within ${opts.healthTimeout}s`);
}

module.exports = { evaluateSummary, search, resolveTargets, usesProfileOptions, scenarioSourcePath };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const num = (name, fallback) => Number(getArg(name, fallback));

  const opts = {
    client: getArg("client"),
    scenario: getArg("scenario"),
    env: getArg("env", "default"),
    profile: getArg("profile", "throughput-medium"),
    startRps: num("start-rps", 10),
    maxRps: num("max-rps", 1000),
    resolutionRps: num("resolution-rps", 5),
    stepDuration: num("step-duration", 30),
    confirmRuns: num("confirm-runs", 2),
    retries: num("retries", 1),
    cooldown: num("cooldown", 10),
    healthUrl: getArg("health-url"),
    healthTimeout: num("health-timeout", 120),
    minAchievedRatio: num("min-achieved-ratio", 0.95),
  };

  const usage = () => {
    console.error("[capacity] Usage: node bin/find-capacity.js --client=<client> --scenario=<path> [--env=default]");
    console.error("    [--profile=throughput-medium] [--start-rps=10] [--max-rps=1000] [--resolution-rps=5]");
    console.error("    [--step-duration=30] [--confirm-runs=2] [--retries=1] [--cooldown=10]");
    console.error("    [--health-url=<url>] [--health-timeout=120] [--min-achieved-ratio=0.95] [--i-own-this-target]");
    console.error("  Rates, resolution and step duration must be positive integers.");
  };

  const main = async () => {
    const positiveInts = [opts.startRps, opts.maxRps, opts.resolutionRps, opts.stepDuration];
    if (
      !opts.client ||
      !opts.scenario ||
      positiveInts.some((n) => !Number.isInteger(n) || n < 1) ||
      opts.startRps > opts.maxRps
    ) {
      usage();
      return 2;
    }

    const sourcePath = scenarioSourcePath(opts.client, opts.scenario);
    if (!fs.existsSync(sourcePath)) {
      console.error(`[capacity] Scenario not found: ${sourcePath}`);
      return 2;
    }
    if (!usesProfileOptions(fs.readFileSync(sourcePath, "utf8"))) {
      console.error(`[capacity] ${opts.scenario} declares its own k6 options instead of building them`);
      console.error("  from the profile, so every step would run at the same load and the result would be");
      console.error("  meaningless. Build its options with buildOptions() from @core/config-loader.");
      return 2;
    }

    const targets = resolveTargets(opts.client, opts.env);
    const remote = targets.filter((raw) => {
      try {
        return !LOCAL_HOSTS.includes(new URL(raw).hostname);
      } catch {
        return true;
      }
    });
    if (remote.length > 0 && !argv.includes("--i-own-this-target")) {
      const hosts = remote.map((raw) => {
        try {
          return new URL(raw).hostname;
        } catch {
          return "<invalid url>";
        }
      });
      console.error(`[capacity] Refusing to run: target ${hosts.join(", ")} is not local.`);
      console.error("  A capacity search pushes the target until it fails. Pass --i-own-this-target if you may do that.");
      return 2;
    }

    const artifactsDir = path.join(
      process.env["K6_REPORTS_DIR"] || path.join(ROOT_DIR, "reports"),
      opts.client,
      opts.scenario.replace(/\//g, "_")
    );
    console.log(
      `[capacity] ${opts.scenario} (${opts.client}/${opts.env}) — ${opts.startRps}-${opts.maxRps} rps, ${opts.stepDuration}s steps, profile ${opts.profile}`
    );

    const result = await search({
      ...opts,
      runStep: createRunStep(opts, artifactsDir),
      wait: () => waitBetweenSteps(opts),
      onStep: (s) =>
        console.log(`[capacity] ${s.passed ? "PASS" : "FAIL"} ${s.phase} ${s.rps} rps${s.passed ? "" : ` — ${s.reasons.join("; ")}`}`),
    });

    console.log("");
    console.table(
      result.steps.map((s) => ({ phase: s.phase, rps: s.rps, passed: s.passed, reasons: s.reasons.join("; ") }))
    );
    console.log(`Highest sustainable: ${result.highestSustainableRps} rps (confirmed: ${result.confirmed})`);
    console.log(`First failing:       ${result.firstFailingRps === null ? `none up to ${opts.maxRps}` : result.firstFailingRps} rps`);

    fs.mkdirSync(artifactsDir, { recursive: true });
    const resultPath = path.join(artifactsDir, "capacity-result.json");
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`Result written to:   ${resultPath}`);

    return result.highestSustainableRps > 0 ? 0 : 1;
  };

  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[capacity] Search aborted: ${err.message}`);
      process.exit(2);
    });
}
