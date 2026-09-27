#!/usr/bin/env node
// bin/_run-approval.js — human approval records for guarded runs.
//
// A guarded run (unlocked scenario gate, production load, non-listed environment or a
// heavy profile; see bin/_run-guard.sh) only starts when a human approved exactly that
// client/scenario/profile/env with bin/approve-run.sh. Approvals are single use.
//
//   node bin/_run-approval.js approve --client=<c> --scenario=<s> --profile=<p> --env=<e> [--ttl=4h] [--reason=...] --root=<repo>
//       Interactive only (TTY on stdin and stdout; the confirmation code is read from
//       /dev/tty). Called by bin/approve-run.sh.
//   node bin/_run-approval.js check   --client= --scenario= --profile= --env= --root=<repo>
//   node bin/_run-approval.js consume --client= --scenario= --profile= --env= --root=<repo>
//       Used by the runners. check: exit 0 when a valid approval exists. consume: marks it
//       used (atomic rename to consumed/) and prints the record (no hmac/nonce) as JSON.
//
// Store: ${XDG_STATE_HOME:-$HOME/.local/state}/k6-framework/approvals/ (0700), records
// 0600, HMAC-SHA256 over the canonical fields with a per-user secret (.secret, 0600).
// Refused: stores inside the repository, group/world-writable files or dirs, files owned
// by another user, symlinks, bad HMAC, expired or mismatched records.
//
// Exit codes: 0 ok, 1 no valid approval / refused, 2 usage error or no interactive terminal.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const FIELDS = [
  "v",
  "id",
  "client",
  "scenario",
  "profile",
  "env",
  "gates",
  "user",
  "host",
  "created",
  "expires",
  "reason",
  "nonce",
];
const MAX_TTL_MS = 24 * 3600 * 1000;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_SCENARIO = /^[A-Za-z0-9._/-]{1,200}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function approvalsDir(env = process.env) {
  const base = env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), ".local", "state");
  return path.join(base, "k6-framework", "approvals");
}

function parseTtl(s) {
  const m = /^(\d{1,4})([mhd])$/.exec(String(s || "4h"));
  if (!m) throw new Error(`invalid --ttl '${s}' (use e.g. 30m, 4h, 1d)`);
  const ms = Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
  if (ms <= 0 || ms > MAX_TTL_MS) throw new Error(`--ttl must be between 1m and 24h`);
  return ms;
}

function canonical(rec) {
  return JSON.stringify(FIELDS.map((f) => [f, rec[f] ?? null]));
}

function sign(rec, secret) {
  return crypto.createHmac("sha256", secret).update(canonical(rec)).digest("hex");
}

/** Owned by us, not a symlink, not group/world-writable (strict: no group/world access at all). */
function assertSafe(p, { dir = false, strict = false } = {}) {
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) throw new Error(`${p} is a symlink`);
  if (dir ? !st.isDirectory() : !st.isFile())
    throw new Error(`${p} is not a ${dir ? "directory" : "file"}`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid())
    throw new Error(`${p} is owned by another user`);
  if (st.mode & (strict ? 0o077 : 0o022))
    throw new Error(`${p} has unsafe permissions ${(st.mode & 0o777).toString(8)}`);
}

/** Open (and on create, initialise) the store. Refuses a store inside the repository. */
function openStore({ dir = approvalsDir(), root, create = false } = {}) {
  const abs = path.resolve(dir);
  if (root) {
    const r = path.resolve(root);
    const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
    for (const p of [abs, real]) {
      if (p === r || p.startsWith(r + path.sep))
        throw new Error(`approval store ${abs} is inside the repository`);
    }
  }
  if (create) fs.mkdirSync(path.join(abs, "consumed"), { recursive: true, mode: 0o700 });
  assertSafe(abs, { dir: true, strict: true });
  const secretFile = path.join(abs, ".secret");
  if (create && !fs.existsSync(secretFile)) {
    fs.writeFileSync(secretFile, crypto.randomBytes(32).toString("hex") + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  assertSafe(secretFile, { strict: true });
  const secret = fs.readFileSync(secretFile, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error(`${secretFile} is malformed`);
  return { dir: abs, secret };
}

function createRecord(req, store, now = Date.now()) {
  const rec = {
    v: 1,
    id: crypto.randomBytes(8).toString("hex"),
    client: req.client,
    scenario: req.scenario,
    profile: req.profile,
    env: req.env,
    gates: req.gates || "none",
    user: os.userInfo().username,
    host: os.hostname(),
    created: new Date(now).toISOString(),
    expires: new Date(now + parseTtl(req.ttl)).toISOString(),
    reason: String(req.reason || "").slice(0, 500),
    nonce: crypto.randomBytes(16).toString("hex"),
  };
  rec.hmac = sign(rec, store.secret);
  const file = path.join(store.dir, `${rec.id}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return { rec, file };
}

/** Why a record does not authorise this run, or null when it does. */
function rejectReason(rec, req, secret, now) {
  const expected = sign(rec, secret);
  const got = String(rec.hmac || "");
  if (
    got.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  )
    return "bad HMAC";
  for (const k of ["client", "scenario", "profile", "env"]) {
    if (rec[k] !== req[k]) return `${k} mismatch (${rec[k]} != ${req[k]})`;
  }
  const exp = Date.parse(rec.expires);
  const created = Date.parse(rec.created);
  if (!(exp > now)) return "expired";
  if (!(created <= now + 60e3) || exp - created > MAX_TTL_MS) return "invalid validity window";
  return null;
}

/** Find a valid approval for req. consume=true atomically moves it to consumed/. */
function findApproval(req, store, { consume = false, now = Date.now() } = {}) {
  const notes = [];
  const files = fs
    .readdirSync(store.dir)
    .filter((f) => /^[0-9a-f]{16}\.json$/.test(f))
    .sort();
  for (const f of files) {
    const file = path.join(store.dir, f);
    let rec;
    try {
      assertSafe(file);
      rec = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      notes.push(`${f}: ${e.message}`);
      continue;
    }
    const why =
      rec.id + ".json" === f
        ? rejectReason(rec, req, store.secret, now)
        : "id does not match file name";
    if (why) {
      notes.push(`${f}: ${why}`);
      continue;
    }
    if (consume) {
      try {
        fs.renameSync(file, path.join(store.dir, "consumed", f));
      } catch (e) {
        notes.push(`${f}: already consumed (${e.code || e.message})`);
        continue;
      }
    }
    const { hmac, nonce, ...pub } = rec; // eslint-disable-line no-unused-vars
    return { record: pub, notes };
  }
  return { record: null, notes };
}

/** Scenario gate marker kind, or "none". Mirrors the runners' marker match. */
function gateKind(root, client, scenario) {
  const candidates = [
    path.join(root, "clients", client, "scenarios", `${scenario}.ts`),
    path.join(root, "scenarios", `${scenario}.ts`),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) return null;
  const m = /export const gate = "(quarantined|experimental|unsafe)"/.exec(
    fs.readFileSync(file, "utf8")
  );
  return m ? m[1] : "none";
}

function readTtyLine() {
  const fd = fs.openSync("/dev/tty", "r");
  try {
    const buf = Buffer.alloc(1);
    let line = "";
    while (fs.readSync(fd, buf, 0, 1, null) === 1 && buf[0] !== 10)
      line += String.fromCharCode(buf[0]);
    return line.trim();
  } finally {
    fs.closeSync(fd);
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/s.exec(a);
    if (m) out[m[1]] = m[2];
    else out._.push(a);
  }
  return out;
}

function validateReq(a) {
  if (!SAFE_NAME.test(a.client || ""))
    throw new Error("--client is required (letters, digits, . _ -)");
  if (!SAFE_SCENARIO.test(a.scenario || "") || a.scenario.includes(".."))
    throw new Error("--scenario is required (bucket/path)");
  if (!SAFE_NAME.test(a.profile || "")) throw new Error("--profile is required");
  if (!SAFE_NAME.test(a.env || "")) throw new Error("--env is required");
  if (!a.root) throw new Error("--root is required");
  return { client: a.client, scenario: a.scenario, profile: a.profile, env: a.env };
}

function approve(a) {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    process.stderr.write(
      "approve-run: refusing — needs an interactive terminal on stdin and stdout. A human must run it.\n"
    );
    return 2;
  }
  const req = validateReq(a);
  const gates = gateKind(a.root, req.client, req.scenario);
  if (!gates) throw new Error(`scenario '${req.scenario}' not found for client '${req.client}'`);
  const ttlMs = parseTtl(a.ttl);
  const store = openStore({ root: a.root, create: true });
  const expires = new Date(Date.now() + ttlMs).toISOString();
  process.stdout.write(
    [
      "",
      "You are approving ONE run of:",
      `  client     ${req.client}`,
      `  scenario   ${req.scenario}`,
      `  profile    ${req.profile}`,
      `  env        ${req.env}`,
      `  gate       ${gates}`,
      `  reason     ${a.reason || "(none)"}`,
      `  by         ${os.userInfo().username}@${os.hostname()}`,
      `  expires    ${expires} (single use)`,
      "",
    ].join("\n") + "\n"
  );
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  process.stdout.write(`Type ${code} to approve (anything else cancels): `);
  if (readTtyLine().toUpperCase() !== code) {
    process.stderr.write("approve-run: code did not match — nothing approved.\n");
    return 1;
  }
  const { rec, file } = createRecord({ ...req, gates, ttl: a.ttl, reason: a.reason }, store);
  process.stdout.write(`Approved: id ${rec.id} → ${file}\n`);
  return 0;
}

function main(argv) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  try {
    if (cmd === "approve") return approve(a);
    if (cmd === "check" || cmd === "consume") {
      const req = validateReq(a);
      let store;
      try {
        store = openStore({ root: a.root });
      } catch (e) {
        if (e.code === "ENOENT") return 1;
        process.stderr.write(`[approval] store refused: ${e.message}\n`);
        return 1;
      }
      const { record, notes } = findApproval(req, store, { consume: cmd === "consume" });
      if (!record) {
        for (const n of notes) process.stderr.write(`[approval] ignored ${n}\n`);
        return 1;
      }
      process.stdout.write(JSON.stringify(record) + "\n");
      return 0;
    }
    process.stderr.write(
      "usage: _run-approval.js approve|check|consume --client= --scenario= --profile= --env= --root=\n"
    );
    return 2;
  } catch (e) {
    process.stderr.write(`[approval] ${e.message}\n`);
    return 2;
  }
}

module.exports = {
  approvalsDir,
  parseTtl,
  canonical,
  sign,
  openStore,
  createRecord,
  findApproval,
  gateKind,
  main,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
