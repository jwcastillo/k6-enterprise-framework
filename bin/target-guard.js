#!/usr/bin/env node
// bin/target-guard.js — refuses to fire load at a target the config does not allow.
//
// Runs before k6 starts. Three checks:
//   1. Embedded credentials  — baseUrl contains user:pass@
//   2. Host allow-list       — allowedHosts is set and a baseUrl host is not in it
//   3. Production load       — --env matches /^prod/i and the profile is not smoke/quick
//
// Error messages only ever name the endpoint key and the hostname, never the full
// baseUrl (it may carry credentials or tokens).
//
// Usage:
//   node bin/target-guard.js --client=examples --env=production --profile=load
//   node bin/target-guard.js --config=clients/examples/config/production.json --env=production
//
// Override check 3 with K6_ALLOW_PROD_LOAD=true.

"use strict";

const fs = require("fs");
const path = require("path");

/** Every baseUrl declared in a client config, as { name, raw }. */
function collectBaseUrls(config) {
  const found = [];
  if (typeof config.baseUrl === "string") found.push({ name: "baseUrl", raw: config.baseUrl });
  for (const group of ["endpoints", "services"]) {
    const entries = config[group];
    if (!entries || typeof entries !== "object") continue;
    for (const [name, def] of Object.entries(entries)) {
      if (def && typeof def.baseUrl === "string") {
        found.push({ name: `${group}.${name}`, raw: def.baseUrl });
      }
    }
  }
  return found;
}

/**
 * Decide whether the runner may fire load at the resolved target.
 * Pure: never prints, never returns a full baseUrl.
 * @returns {string[]} reasons to refuse the run (empty = allowed)
 */
function checkTarget(config, envName, profile, allowProdLoad) {
  const errors = [];
  const targets = collectBaseUrls(config);
  const allowed = Array.isArray(config.allowedHosts)
    ? config.allowedHosts.map((h) => String(h).toLowerCase())
    : null;

  for (const { name, raw } of targets) {
    let url = null;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }

    if (url && (url.username || url.password)) {
      errors.push(
        `${name} embeds credentials (user:pass@) for host '${url.hostname}'. Move them to the auth config or environment variables.`
      );
    }

    if (allowed) {
      if (!url) {
        errors.push(`${name} is not a valid URL, cannot check it against allowedHosts.`);
      } else if (!allowed.includes(url.hostname.toLowerCase())) {
        errors.push(`Host '${url.hostname}' (${name}) is not in allowedHosts [${allowed.join(", ")}].`);
      }
    }
  }

  if (allowed && targets.length === 0) {
    errors.push("allowedHosts is set but the config declares no baseUrl to check.");
  }

  const lightProfile = profile === "smoke" || profile === "quick";
  if (/^prod/i.test(String(envName)) && !lightProfile && !allowProdLoad) {
    errors.push(
      `Environment '${envName}' looks like production and profile '${profile || "none"}' is not smoke/quick. Set K6_ALLOW_PROD_LOAD=true to run it anyway.`
    );
  }

  return errors;
}

/**
 * Locate the config file for a client + env, in the order the runner resolves them.
 * ponytail: JSON only — YAML client configs would need the yaml-parser from src/, which
 * is not built yet at this point in run-test.sh. Add if a client ships config in YAML.
 */
function resolveConfigPath(rootDir, client, envName) {
  const candidates = [
    path.join(rootDir, "clients", client, "config", `${envName}.json`),
    path.join(rootDir, "clients", client, "config", "default.json"),
    path.join(rootDir, "clients", client, "config.json"),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

module.exports = { checkTarget, collectBaseUrls, resolveConfigPath };

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const rootDir = path.resolve(__dirname, "..");
  const envName = getArg("env") || process.env.K6_ENV || "default";
  const profile = getArg("profile") || process.env.K6_PROFILE;
  const client = getArg("client") || process.env.K6_CLIENT;
  const configPath = getArg("config") || (client ? resolveConfigPath(rootDir, client, envName) : null);

  let config = {};
  if (configPath && fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      console.error(`[target-guard] Config is not valid JSON: ${configPath} (${err.message})`);
      process.exit(1);
    }
  }
  // No config file: the prod-load check still applies, the URL checks have nothing to read.

  const errors = checkTarget(config, envName, profile, process.env.K6_ALLOW_PROD_LOAD === "true");

  if (errors.length > 0) {
    console.error("[target-guard] Refusing to start k6:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  if (process.env.K6_VERBOSE === "true") {
    console.log(`[target-guard] Target allowed (env=${envName}, profile=${profile || "none"})`);
  }
}
