// bin/_shell-guard.js — shell parsing shared by .claude/hooks/guardrails.js and
// bin/agent-bash-guard.js.
//
// Regexes on raw command text are bypassed by quoting and indirection
// (`bash -c "..."`, `V=--flag; cmd $V`, `k""6`). This module splits a command line
// into simple commands and quote-removed words, recursing into `sh|bash|zsh -c`,
// `eval`, `$(...)`, backticks, process substitution and heredocs fed to a shell,
// so callers decide on the words bash would actually execute.
//
// Zero dependencies on purpose: the hooks run before `pnpm install` (fresh clones,
// standalone exports) and a missing module would make them fail open.
//
// Ceiling: this is a guardrail, not a sandbox. It does not follow script files
// (`bash some-script.sh` is analysed as that script's argv, not its contents), and
// it does not see what interpreters such as `node -e` / `python -c` do.

"use strict";

const fs = require("fs");
const path = require("path");

class ShellParseError extends Error {}

/** Placeholder for an expansion inside a word's text. */
const DYN = "\u0000";

/** @typedef {{text: string, dynamic: boolean}} Word */
/** @typedef {{words: Word[], redirects: {op: string, target: Word|null}[], heredocs: string[], piped: boolean}} SimpleCommand */

const RESERVED = new Set(["!", "{", "}", "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "time", "case", "esac", "in"]);

function decodeAnsiC(s) {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|.)/g, (_, e) => {
    if (e[0] === "x" || e[0] === "u") return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v" }[e] ?? e;
  });
}

/**
 * Parse a shell command line into a flat list of simple commands (nested
 * substitutions included). Throws ShellParseError on unbalanced input.
 * @returns {SimpleCommand[]}
 */
function parseShell(src, depth = 0) {
  if (depth > 8) throw new ShellParseError("nesting too deep");
  const s = String(src);
  const out = [];
  let i = 0;

  const newCmd = (piped = false) => ({ words: [], redirects: [], heredocs: [], piped });

  // Reads up to the matching close (")" or "`"), returning the commands found.
  function parseUntil(close) {
    let cmd = newCmd();
    let pendingHeredocs = [];
    let word = null; // {text, dynamic, quoted}
    let redirectOp = null;
    let atWordStart = true;

    const flushWord = () => {
      if (!word) return;
      const w = { text: word.text, dynamic: word.dynamic };
      if (redirectOp) {
        cmd.redirects.push({ op: redirectOp, target: w });
        if (redirectOp === "<<" || redirectOp === "<<-") pendingHeredocs.push({ delim: w.text, strip: redirectOp === "<<-", cmd });
        redirectOp = null;
      } else {
        cmd.words.push(w);
      }
      word = null;
    };
    const endCmd = (pipedNext = false) => {
      flushWord();
      if (redirectOp) throw new ShellParseError(`missing target for ${redirectOp}`);
      if (cmd.words.length || cmd.redirects.length) out.push(cmd);
      else if (pipedNext) throw new ShellParseError("empty pipeline stage");
      cmd = newCmd(pipedNext);
    };
    const w = () => (word ??= { text: "", dynamic: false, quoted: false });
    // Expansions leave a NUL in the text so `K6_$X=1` can never look like a literal name.
    const dyn = () => {
      w().dynamic = true;
      w().text += DYN;
    };

    function readHeredocBodies() {
      for (const h of pendingHeredocs) {
        const lines = [];
        for (;;) {
          if (i >= s.length) throw new ShellParseError(`unterminated heredoc ${h.delim}`);
          let nl = s.indexOf("\n", i);
          if (nl === -1) nl = s.length;
          const line = s.slice(i, nl);
          i = nl + 1;
          if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
          lines.push(line);
        }
        h.cmd.heredocs.push(lines.join("\n"));
      }
      pendingHeredocs = [];
    }

    // $... expansions: returns after consuming them, marks the word dynamic.
    function readDollar() {
      const c = s[i + 1];
      if (c === "(") {
        i += 2;
        parseUntil(")");
        dyn();
      } else if (c === "{") {
        const end = s.indexOf("}", i + 2);
        if (end === -1) throw new ShellParseError("unterminated ${");
        i = end + 1;
        dyn();
      } else if (c !== undefined && /[A-Za-z0-9_@*#?$!-]/.test(c)) {
        i += 2;
        if (/[A-Za-z_]/.test(c)) while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i++;
        dyn();
      } else {
        w().text += "$";
        i++;
      }
    }

    function readBacktick() {
      let j = i + 1;
      let inner = "";
      while (j < s.length && s[j] !== "`") {
        if (s[j] === "\\" && j + 1 < s.length) {
          inner += s[j + 1];
          j += 2;
        } else inner += s[j++];
      }
      if (j >= s.length) throw new ShellParseError("unterminated backtick");
      out.push(...parseShell(inner, depth + 1));
      i = j + 1;
      dyn();
    }

    while (i < s.length) {
      const c = s[i];
      if (c === "\\") {
        if (s[i + 1] === "\n") i += 2;
        else {
          if (i + 1 >= s.length) throw new ShellParseError("trailing backslash");
          w().text += s[i + 1];
          w().quoted = true;
          i += 2;
        }
        atWordStart = false;
        continue;
      }
      if (c === "'") {
        const end = s.indexOf("'", i + 1);
        if (end === -1) throw new ShellParseError("unterminated single quote");
        w().text += s.slice(i + 1, end);
        w().quoted = true;
        i = end + 1;
        atWordStart = false;
        continue;
      }
      if (c === "$" && s[i + 1] === "'") {
        let j = i + 2;
        while (j < s.length && s[j] !== "'") j += s[j] === "\\" ? 2 : 1;
        if (j >= s.length) throw new ShellParseError("unterminated $'");
        w().text += decodeAnsiC(s.slice(i + 2, j));
        w().quoted = true;
        i = j + 1;
        atWordStart = false;
        continue;
      }
      if (c === '"') {
        w().quoted = true;
        i++;
        for (;;) {
          if (i >= s.length) throw new ShellParseError("unterminated double quote");
          const d = s[i];
          if (d === '"') {
            i++;
            break;
          }
          if (d === "\\" && /["\\$`\n]/.test(s[i + 1] ?? "")) {
            if (s[i + 1] !== "\n") w().text += s[i + 1];
            i += 2;
          } else if (d === "$") readDollar();
          else if (d === "`") readBacktick();
          else {
            w().text += d;
            i++;
          }
        }
        atWordStart = false;
        continue;
      }
      if (c === "$") {
        readDollar();
        atWordStart = false;
        continue;
      }
      if (c === "`") {
        readBacktick();
        atWordStart = false;
        continue;
      }
      if (c === "#" && !word && atWordStart) {
        while (i < s.length && s[i] !== "\n") i++;
        continue;
      }
      if (c === " " || c === "\t") {
        flushWord();
        atWordStart = true;
        i++;
        continue;
      }
      if (c === "\n") {
        endCmd();
        i++;
        readHeredocBodies();
        atWordStart = true;
        continue;
      }
      if (c === ";" || c === "&" || c === "|") {
        const two = s.slice(i, i + 2);
        if (c === "&" && s[i + 1] === ">") {
          // &> / &>> redirection
          flushWord();
          redirectOp = s[i + 2] === ">" ? "&>>" : "&>";
          i += redirectOp.length;
          continue;
        }
        const piped = c === "|" && two !== "||";
        endCmd(piped);
        i += two === "&&" || two === "||" || two === ";;" || two === "|&" ? 2 : 1;
        atWordStart = true;
        continue;
      }
      if (c === "(") {
        const plain = word && !word.quoted && !word.dynamic;
        if (plain && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(word.text)) {
          // Array assignment NAME=(...): elements are parsed (and checked) like a command.
          i++;
          parseUntil(")");
          dyn();
          atWordStart = false;
          continue;
        }
        if (plain && /^[A-Za-z_][\w.:-]*$/.test(word.text) && s[i + 1] === ")") {
          // Function definition name() { ...; }: the body is parsed as commands.
          word = null;
          i += 2;
          endCmd();
          atWordStart = true;
          continue;
        }
        if (word) throw new ShellParseError("unexpected (");
        endCmd();
        i++;
        parseUntil(")");
        atWordStart = true;
        continue;
      }
      if (c === ")") {
        if (close !== ")") throw new ShellParseError("unbalanced )");
        endCmd();
        i++;
        return;
      }
      if (c === "<" || c === ">") {
        if ((c === "<" || c === ">") && s[i + 1] === "(") {
          // process substitution <( ) / >( )
          i += 2;
          parseUntil(")");
          dyn();
          atWordStart = false;
          continue;
        }
        const fdOnly = word && !word.quoted && !word.dynamic && /^\d+$/.test(word.text);
        if (fdOnly) word = null;
        else flushWord();
        if (redirectOp) throw new ShellParseError("double redirection");
        const m = /^(<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)/.exec(s.slice(i));
        redirectOp = m[1];
        i += redirectOp.length;
        if ((redirectOp === ">&" || redirectOp === "<&") && /^[\d-]/.test(s[i] ?? "")) {
          let j = i;
          while (j < s.length && /[\d-]/.test(s[j])) j++;
          cmd.redirects.push({ op: redirectOp, target: { text: s.slice(i, j), dynamic: false } });
          redirectOp = null;
          i = j;
        }
        atWordStart = true;
        continue;
      }
      w().text += c;
      atWordStart = false;
      i++;
    }
    if (close) throw new ShellParseError(`missing ${close}`);
    endCmd();
    if (pendingHeredocs.length) readHeredocBodies();
  }

  parseUntil(null);
  return out;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn"]);
const MAX_SCRIPT_BYTES = 256 * 1024;
const MAX_SCRIPT_FILES = 16;
/** The repo's own bin/ (this file's directory): reviewed tooling, not re-parsed. */
const TRUSTED_BIN = path.resolve(__dirname) + path.sep;

function newContext(cwd = process.cwd()) {
  return { cwd, filesRead: 0 };
}

/** Script text, or null when missing, too big, unreadable or over the per-line file budget. */
function readScript(abs, ctx) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_SCRIPT_BYTES || ++ctx.filesRead > MAX_SCRIPT_FILES) return null;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function isShellScript(abs) {
  try {
    const fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(128);
    const n = fs.readSync(fd, buf, 0, 128, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, n).toString("utf8");
    if (head.startsWith("#!")) return /^#!\S*\b(env\s+)?(sh|bash|zsh|dash|ksh|mksh|ash)\b/.test(head.split("\n")[0]);
    return /\.(sh|bash)$/.test(abs) || !head.includes("\0");
  } catch {
    return false;
  }
}

/**
 * `pnpm test`, `pnpm run x`, `npm run x`, `yarn x`, ...: the package.json script text
 * (pre/post hooks included), found from the nearest package.json at or above the dir.
 * @returns {null | {indirect: string} | {scripts: [string, string|null][]}}
 */
function packageScript(words, ctx) {
  const name = path.posix.basename(words[0].text);
  let dir = ctx.cwd;
  let i = 1;
  let workspace = false;
  for (; i < words.length && words[i].text.startsWith("-"); i++) {
    const t = words[i].text;
    const eq = /^--(dir|prefix|cwd)=(.*)$/.exec(t);
    if (eq) dir = path.resolve(ctx.cwd, eq[2]);
    else if (["-C", "--dir", "--prefix", "--cwd"].includes(t)) dir = path.resolve(ctx.cwd, words[++i]?.text ?? "");
    else if (/^(-r|--recursive|-F|--filter|-w|--workspace|--workspaces|-ws)$/.test(t) || /^--(filter|workspace)=/.test(t)) {
      workspace = true;
      if (/^(-F|--filter|-w|--workspace)$/.test(t)) i++;
    }
  }
  const sub = words[i];
  if (!sub) return null;
  let script = null;
  let explicit = true;
  if (sub.text === "run" || sub.text === "run-script") script = words.slice(i + 1).find((w) => !w.text.startsWith("-")) ?? null;
  else if (["test", "t", "tst", "start", "stop", "restart"].includes(sub.text)) script = { ...sub, text: /^t(e?st)?$/.test(sub.text) ? "test" : sub.text };
  else if (name !== "npm") {
    script = sub; // pnpm/yarn run an unknown command as a script
    explicit = false;
  }
  if (!script) return null;
  if (script.dynamic || sub.dynamic) return { indirect: "a package script chosen by a variable" };
  if (workspace) return { indirect: "a workspace-wide package script run (write the script's command instead)" };
  let scripts = null;
  for (let d = dir; ; d = path.dirname(d)) {
    try {
      scripts = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")).scripts || {};
      break;
    } catch {
      if (d === path.dirname(d)) break;
    }
  }
  const body = scripts?.[script.text];
  if (typeof body !== "string") return explicit ? { indirect: `a package script that cannot be resolved (${script.text})` } : null;
  return {
    scripts: ["pre", "", "post"]
      .filter((p) => !p || typeof scripts[p + script.text] === "string")
      .map((p) => [`the package script ${p + script.text}`, scripts[p + script.text]]),
  };
}
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)\+?=(.*)$/s;
const lit = (text) => ({ text, dynamic: false });
const base = (word) => path.posix.basename(word.text);

/**
 * Resolve one simple command to what actually runs: strips leading assignments,
 * reserved words and wrappers (env, command, exec, nohup, time, nice, timeout,
 * stdbuf, sudo, xargs, npx, pnpm/npm exec, node <script>, <shell> <script>) and
 * expands `<shell> -c`, `eval` and `env -S` into nested commands.
 *
 * @returns {{assigns: {name: Word|null, value: Word, raw: Word}[], argv: Word[], nested: SimpleCommand[],
 *   indirect: string|null, viaXargs: boolean, stdinShell: boolean, cmd: SimpleCommand}}
 */
function resolve(cmd, depth = 0, ctx = newContext()) {
  const r = { assigns: [], argv: [], nested: [], indirect: null, viaXargs: false, stdinShell: false, cmd, depth };
  let words = cmd.words.slice();
  const assignFrom = (wd) => {
    const m = ASSIGN_RE.exec(wd.text);
    if (!m) return false;
    r.assigns.push({ name: lit(m[1]), value: { text: m[2], dynamic: wd.dynamic }, raw: wd });
    return true;
  };
  const skipOpts = (withValue = []) => {
    while (words.length && words[0].text.startsWith("-") && words[0].text !== "-" && words[0].text !== "--") {
      const opt = words.shift();
      if (withValue.includes(opt.text)) words.shift();
    }
    if (words[0]?.text === "--") words.shift();
  };
  const nestScript = (script) => {
    if (script.dynamic) r.indirect = "a shell script built from variables or substitutions";
    else r.nested.push(...parseShell(script.text, depth + 1));
  };
  // Script text that comes from a file or package.json: parse it, or refuse it.
  const nestText = (text, label) => {
    if (text === null) {
      r.indirect = `${label} that cannot be inspected`;
      return;
    }
    try {
      r.nested.push(...parseShell(text, depth + 1));
    } catch (e) {
      if (!(e instanceof ShellParseError)) throw e;
      r.indirect = `${label} that cannot be parsed (${e.message})`;
    }
  };
  // `bash file`, `source file`, `./file.sh`: read and parse the file, except the runners
  // and the repo's own bin/ tooling (reviewed code, checked by its arguments instead).
  const nestFile = (w, mustExist) => {
    if (w.dynamic) {
      r.indirect = "a script path built from variables or substitutions";
      return;
    }
    const abs = path.resolve(ctx.cwd, w.text);
    if (RUNNER_RE.test(path.basename(abs)) || abs.startsWith(TRUSTED_BIN)) return;
    // Executed by path: missing = command not found; node/python/binaries are out of scope.
    if (!mustExist && (!fs.existsSync(abs) || !isShellScript(abs))) return;
    nestText(readScript(abs, ctx), `a script (${w.text})`);
  };

  for (let guard = 0; guard < 32 && words.length; guard++) {
    const head = words[0];
    if (!head.dynamic && RESERVED.has(head.text)) {
      words.shift();
      continue;
    }
    if (assignFrom(head)) {
      words.shift();
      continue;
    }
    if (head.dynamic) break;
    const name = base(head);
    if (name === "env") {
      words.shift();
      while (words.length) {
        const t = words[0].text;
        if (t === "-S" || t === "--split-string" || t.startsWith("--split-string=") || /^-[a-zA-Z]*S/.test(t)) {
          words.shift();
          const inline = t.startsWith("--split-string=") ? lit(t.slice(15)) : /^-[a-zA-Z]*S./.test(t) ? lit(t.slice(t.indexOf("S") + 1)) : words.shift();
          if (inline) nestScript({ text: [inline, ...words].map((x) => x.text).join(" "), dynamic: [inline, ...words].some((x) => x.dynamic) });
          words = [];
          break;
        }
        if (t === "-u" || t === "--unset" || t === "-C" || t === "--chdir") {
          words.shift();
          words.shift();
        } else if (t.startsWith("-")) words.shift();
        else if (assignFrom(words[0])) words.shift();
        else {
          if (words[0].dynamic) r.indirect = "`env` with variable arguments";
          break;
        }
      }
      continue;
    }
    if (["command", "builtin", "nohup", "time", "stdbuf", "sudo", "doas", "exec", "nice", "ionice", "chrt", "setsid", "unbuffer"].includes(name)) {
      words.shift();
      skipOpts(["-a", "-n", "-u", "-g", "-o", "-e", "-i", "-c", "-p"]);
      continue;
    }
    if (name === "timeout") {
      words.shift();
      skipOpts(["-s", "--signal", "-k", "--kill-after"]);
      words.shift(); // duration
      continue;
    }
    if (name === "xargs") {
      words.shift();
      skipOpts(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"]);
      r.viaXargs = true;
      continue;
    }
    if (name === "npx" || ((name === "pnpm" || name === "npm" || name === "yarn") && ["exec", "dlx", "x"].includes(words[1]?.text))) {
      words.shift();
      if (name !== "npx") words.shift();
      skipOpts(["-p", "--package", "-c"]);
      continue;
    }
    if (name === "node" && words[1] && !words[1].text.startsWith("-")) {
      words.shift();
      continue;
    }
    if (name === "eval" || name === "watch") {
      words.shift();
      if (name === "watch") skipOpts(["-n", "--interval", "-d", "--differences", "-q", "--equexit"]);
      nestScript({ text: words.map((x) => x.text).join(" "), dynamic: words.some((x) => x.dynamic) });
      words = [];
      break;
    }
    if (name === "find") {
      // -exec/-execdir/-ok/-okdir run a command per match.
      for (let i = 1; i < words.length; i++) {
        if (!/^-(exec|execdir|ok|okdir)$/.test(words[i].text)) continue;
        const sub = [];
        for (i++; i < words.length && words[i].text !== ";" && words[i].text !== "+"; i++) if (words[i].text !== "{}") sub.push(words[i]);
        if (sub.length) r.nested.push({ words: sub, redirects: [], heredocs: [], piped: false });
      }
      break;
    }
    if (name === "source" || name === ".") {
      if (words[1]) nestFile(words[1], true);
      break;
    }
    if (PACKAGE_MANAGERS.has(name)) {
      const run = packageScript(words, ctx);
      if (run?.indirect) r.indirect = run.indirect;
      else if (run) for (const [label, text] of run.scripts) nestText(text, label);
      break;
    }
    if (head.text.includes("/") && !SHELLS.has(name)) {
      nestFile(head, false);
      break;
    }
    if (SHELLS.has(name)) {
      words.shift();
      let script = null;
      let sawC = false;
      while (words.length && /^[-+]/.test(words[0].text) && words[0].text !== "-" && words[0].text !== "--") {
        const opt = words.shift();
        if (/^-[a-zA-Z]*c/.test(opt.text)) sawC = true;
        else if (opt.text === "-o" || opt.text === "+o" || opt.text === "--rcfile" || opt.text === "--init-file") words.shift();
      }
      if (words[0]?.text === "--" || words[0]?.text === "-") words.shift();
      if (sawC) {
        script = words.shift();
        if (!script) throw new ShellParseError("-c without a script");
        nestScript(script);
        words = [];
        break;
      }
      if (!words.length) {
        // Reads its script from stdin: inspect heredocs, refuse pipes/redirects.
        r.stdinShell = true;
        for (const body of cmd.heredocs) r.nested.push(...parseShell(body, depth + 1));
        if (cmd.piped || cmd.redirects.some((x) => x.op === "<" || x.op === "<<<" || x.op === "<&")) {
          r.indirect = "a shell reading its script from a pipe or file redirect";
        }
      }
      // `bash script.sh args`: parse the file, then analyse script.sh + args as the command.
      if (words.length) nestFile(words[0], true);
      break;
    }
    break;
  }
  r.argv = words;
  return r;
}

/** Resolve every command on the line, nested ones included (depth-first). */
function resolveAll(commands, depth = 0, ctx = newContext()) {
  const all = [];
  for (const c of commands) {
    const r = resolve(c, depth, ctx);
    all.push(r);
    if (r.nested.length) {
      if (depth >= 8) throw new ShellParseError("nesting too deep");
      all.push(...resolveAll(r.nested, depth + 1, ctx));
    }
  }
  return all;
}

/** Declaration builtins whose arguments are assignments. */
const DECLARERS = new Set(["export", "declare", "typeset", "readonly", "local"]);

/** Assignments made via `export X=1`, `declare -x X=1`, ... plus dynamic declarations. */
function declarations(r) {
  if (!r.argv.length || r.argv[0].dynamic || !DECLARERS.has(base(r.argv[0]))) return { assigns: [], dynamic: false };
  const assigns = [];
  let dynamic = false;
  for (const a of r.argv.slice(1)) {
    if (a.text.startsWith("-") && !a.dynamic) continue;
    const m = ASSIGN_RE.exec(a.text);
    if (m) assigns.push({ name: lit(m[1]), value: { text: m[2], dynamic: a.dynamic }, raw: a });
    else if (a.dynamic) dynamic = true;
  }
  return { assigns, dynamic };
}

const RUNNER_RE = /^(run-test\.sh|run-distributed\.sh|quick\.sh|run-regression\.sh|find-capacity\.js)$/;
const GUARDED_TEXT_RE = /K6_ALLOW_PROD_LOAD|--unsafe|(^|[^A-Za-z0-9_.-])x?k6(\s|$)|run-test|run-distributed|find-capacity/;

// Variables that make a shell or git run another program.
const EXEC_ENV_RE = /^(BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|PROMPT_COMMAND|PAGER|EDITOR|VISUAL|GIT_(PAGER|EDITOR|SEQUENCE_EDITOR|SSH|SSH_COMMAND|EXTERNAL_DIFF|ASKPASS|CONFIG_.*))$/;
const GIT_EXEC_KEY_RE = /^(core\.(pager|editor|sshcommand|fsmonitor|hookspath|askpass)|alias\.|sequence\.editor|diff\.external|credential\.helper|gpg\.program|pager\.|.*\.(textconv|command|cmd|process|clean|smudge))/i;

function gitRunsCommands(args) {
  const texts = args.map((a) => a.text);
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] === "-c" && GIT_EXEC_KEY_RE.test(texts[i + 1] ?? "")) return true;
    if (texts[i].startsWith("--config-env")) return true;
  }
  const cfg = texts.indexOf("config");
  return cfg !== -1 && texts.slice(cfg + 1).some((t) => GIT_EXEC_KEY_RE.test(t));
}

const isK6 = (w) => !w.dynamic && /^x?k6$/.test(base(w));
const isRunner = (w) => !w.dynamic && RUNNER_RE.test(base(w));

/**
 * Parse and classify a command line for the guards.
 * @returns {{error: string|null, commands: ReturnType<typeof resolve>[], indirect: string|null,
 *   k6Load: boolean, prodLoad: {literalTrue: boolean, any: boolean}, runners: ReturnType<typeof resolve>[], unsafeFlag: boolean}}
 */
function analyze(command, opts = {}) {
  const res = { error: null, commands: [], indirect: null, k6Load: false, prodLoad: { literalTrue: false, any: false }, runners: [], unsafeFlag: false };
  let commands;
  try {
    commands = resolveAll(parseShell(command), 0, newContext(opts.cwd));
  } catch (e) {
    if (!(e instanceof ShellParseError)) throw e;
    res.error = e.message;
    return res;
  }
  res.commands = commands;
  const line = { runs: false, sources: false };
  const flag = (reason) => (res.indirect ??= reason);

  for (const r of commands) {
    if (r.indirect) flag(r.indirect);
    const decl = declarations(r);
    if (decl.dynamic) flag("`export`/`declare` with a variable name");
    for (const a of [...r.assigns, ...decl.assigns]) {
      if (a.name.text === "K6_ALLOW_PROD_LOAD") {
        res.prodLoad.any = true;
        if (a.value.dynamic) flag("K6_ALLOW_PROD_LOAD set from a variable");
        else if (a.value.text === "true") res.prodLoad.literalTrue = true;
      }
      if (GUARDED_TEXT_RE.test(a.value.text)) flag(`a variable holding a guarded value (${a.name.text})`);
      if (EXEC_ENV_RE.test(a.name.text)) flag(`${a.name.text}, which makes programs run another command`);
    }
    const [head, ...args] = r.argv;
    if (!head) continue;
    if (head.dynamic) {
      flag("a command name built from a variable or substitution");
      continue;
    }
    const name = base(head);
    if (head.text !== "[" && head.text !== "[[" && /[[\]?*{}]/.test(head.text)) flag("a command name with glob or brace characters");
    if (name === "helm" && args.some((a) => a.text.startsWith("--post-renderer"))) flag("helm --post-renderer runs another program");
    if (name === "git" && gitRunsCommands(args)) flag("git configured to run another command (pager, editor, alias, ...)");
    if (name === "alias" && args.some((a) => GUARDED_TEXT_RE.test(a.text))) flag("an alias for a guarded command");
    if (name === "source" || name === ".") line.sources = true;
    // `k6" "run x.js` is one word "k6 run": bash would fail to find it, but refuse it anyway.
    const k6Words = /^x?k6\s/.test(head.text) ? [...head.text.split(/\s+/).slice(1).map(lit), ...args] : isK6(head) ? args : null;
    if (k6Words) {
      line.runs = true;
      if (k6Words.some((a) => a.dynamic)) flag("k6 with arguments from variables");
      if (r.viaXargs) flag("k6 driven by xargs");
      if (k6Words.some((a) => a.text === "run" || a.text === "cloud")) res.k6Load = true;
    }
    if (isRunner(head)) {
      line.runs = true;
      res.runners.push(r);
      if (args.some((a) => a.dynamic)) flag(`${name} with arguments from variables`);
      if (r.viaXargs) flag(`${name} driven by xargs`);
      if (args.some((a) => a.text === "--unsafe" || a.text.startsWith("--unsafe="))) res.unsafeFlag = true;
    }
  }
  if (line.runs && line.sources) flag("`source`/`.` on the same line as a test run");
  return res;
}

const INDIRECTION_HINT = "indirection not allowed; write the command literally";

module.exports = { DYN, INDIRECTION_HINT, analyze, parseShell, resolve, resolveAll, declarations, ShellParseError, base };
