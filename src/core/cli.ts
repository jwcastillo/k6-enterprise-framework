/**
 * CLI argument parser — Phase 2 implementation
 * Runs in Node.js context (bin/run-test.sh calls this via node src/core/cli.js)
 * All supported flags per spec FR-050 to FR-069
 */

export interface CLIArgs {
  // Execution
  client: string;
  scenario: string;
  profile: string;
  env: string;
  config: string;

  // Output & reporting
  output: string;
  reportsDir: string;
  summaryExport: string;

  // Behavior
  dryRun: boolean;
  watch: boolean;
  parallel: boolean;

  // Debugging
  debug: boolean;
  structuredLogs: boolean;
  verbose: boolean;

  // Info
  help: boolean;
  version: boolean;
  listProfiles: boolean;
  listExtensions: boolean;

  // Pass-through
  extraArgs: string[];
}

const DEFAULTS: CLIArgs = {
  client: "_reference",
  scenario: "",
  profile: "smoke",
  env: "default",
  config: "",
  output: "",
  reportsDir: "./reports",
  summaryExport: "",
  dryRun: false,
  watch: false,
  parallel: false,
  debug: false,
  structuredLogs: false,
  verbose: false,
  help: false,
  version: false,
  listProfiles: false,
  listExtensions: false,
  extraArgs: [],
};

/**
 * Parse CLI arguments into a structured CLIArgs object.
 * Follows the spec FR-050 to FR-069 flags.
 */
export function parseCLIArgs(args: string[]): CLIArgs {
  const result = { ...DEFAULTS };
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      // Execution
      case "--client":
        result.client = args[++i] ?? result.client;
        break;
      case "--scenario":
      case "--test":
        result.scenario = args[++i] ?? result.scenario;
        break;
      case "--profile":
        result.profile = args[++i] ?? result.profile;
        break;
      case "--env":
        result.env = args[++i] ?? result.env;
        break;
      case "--config":
        result.config = args[++i] ?? result.config;
        break;

      // Output
      case "--output":
        result.output = args[++i] ?? result.output;
        break;
      case "--reports-dir":
        result.reportsDir = args[++i] ?? result.reportsDir;
        break;
      case "--summary-export":
        result.summaryExport = args[++i] ?? result.summaryExport;
        break;

      // Behavior
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--watch":
        result.watch = true;
        break;
      case "--parallel":
        result.parallel = true;
        break;

      // Debugging
      case "--debug":
        result.debug = true;
        break;
      case "--structured-logs":
        result.structuredLogs = true;
        break;
      case "--verbose":
        result.verbose = true;
        break;

      // Info
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--version":
      case "-v":
        result.version = true;
        break;
      case "--list-profiles":
        result.listProfiles = true;
        break;
      case "--list-extensions":
        result.listExtensions = true;
        break;

      // Pass-through separator
      case "--":
        result.extraArgs = args.slice(i + 1);
        i = args.length;
        break;

      default:
        if (arg.startsWith("--")) {
          console.warn(`CLI: unknown option '${arg}' — ignoring`);
        } else {
          result.extraArgs.push(arg);
        }
    }

    i++;
  }

  // Apply env var fallbacks (env vars take lower priority than explicit flags)
  if (!result.client && __ENV["K6_CLIENT"]) result.client = __ENV["K6_CLIENT"];
  if (!result.scenario && __ENV["K6_SCENARIO"])
    result.scenario = __ENV["K6_SCENARIO"];
  if (result.profile === DEFAULTS.profile && __ENV["K6_PROFILE"])
    result.profile = __ENV["K6_PROFILE"];
  if (result.env === DEFAULTS.env && __ENV["K6_ENV"])
    result.env = __ENV["K6_ENV"];

  return result;
}

/** Validate parsed CLI args, returning list of errors */
export function validateCLIArgs(args: CLIArgs): string[] {
  const errors: string[] = [];

  const VALID_PROFILES = [
    "smoke",
    "quick",
    "load",
    "rampup",
    "capacity",
    "stress",
    "spike",
    "breakpoint",
    "soak",
  ];
  if (!VALID_PROFILES.includes(args.profile)) {
    errors.push(
      `Invalid profile '${args.profile}'. Valid: ${VALID_PROFILES.join(", ")}`,
    );
  }

  if (
    !args.help &&
    !args.version &&
    !args.listProfiles &&
    !args.listExtensions
  ) {
    if (!args.scenario) {
      errors.push("--scenario (or --test) is required");
    }
  }

  return errors;
}
