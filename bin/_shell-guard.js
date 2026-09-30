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
const os = require("os");
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
    let caseDepth = 0; // open `case ... in` blocks
    let casePattern = false; // reading a `pat|pat)` list

    const flushWord = () => {
      if (!word) return;
      const w = { text: word.text, dynamic: word.dynamic };
      if (redirectOp) {
        cmd.redirects.push({ op: redirectOp, target: w });
        if (redirectOp === "<<" || redirectOp === "<<-") pendingHeredocs.push({ delim: w.text, strip: redirectOp === "<<-", cmd });
        redirectOp = null;
      } else {
        cmd.words.push(w);
        const plain = !word.quoted && !word.dynamic;
        // case WORD in  pat) ... ;;  esac — the header and the patterns are not commands.
        if (plain && cmd.words.length === 3 && cmd.words[0].text === "case" && w.text === "in") {
          caseDepth++;
          casePattern = true;
          cmd.words = [];
        } else if (plain && caseDepth > 0 && cmd.words.length === 1 && w.text === "esac") {
          caseDepth--;
          casePattern = false;
          cmd.words = [];
        }
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
        if (casePattern && c === "|" && two !== "||") {
          flushWord(); // `a|b)` alternatives
          i++;
          continue;
        }
        if (caseDepth > 0 && (two === ";;" || two === ";&")) {
          endCmd();
          casePattern = true;
          i += two === ";;" && s[i + 2] === "&" ? 3 : 2;
          atWordStart = true;
          continue;
        }
        const piped = c === "|" && two !== "||";
        endCmd(piped);
        i += two === "&&" || two === "||" || two === ";;" || two === "|&" ? 2 : 1;
        atWordStart = true;
        continue;
      }
      if (c === "(" && casePattern && !word) {
        i++; // optional `(pat)` form
        continue;
      }
      if (c === ")" && casePattern) {
        flushWord();
        cmd.words = []; // the patterns; expansions in them were already parsed
        casePattern = false;
        i++;
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
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const MAX_SCRIPT_BYTES = 256 * 1024;
const MAX_SCRIPT_FILES = 16;
/** The repo's own bin/ (this file's directory): reviewed tooling, not re-parsed. */
const TRUSTED_BIN = path.resolve(__dirname) + path.sep;

/**
 * Per-line state. `dirs` holds every directory the line may be in: a `cd` adds its
 * target without dropping the old one (the cd may sit in a subshell or fail), and a
 * target that cannot be known sets `cwdUnknown`. `writes`/`execs` are absolute paths
 * the line writes and runs as scripts ("*" = some unknown write).
 */
function newContext(cwd = process.cwd()) {
  return { dirs: [path.resolve(cwd)], cwdUnknown: false, filesRead: 0, writes: [], prefixWrites: [], execs: [], trustedExecs: [] };
}

/** Absolute candidates for a path word, or null when the cwd cannot be known. */
function candidates(text, ctx) {
  if (text === "~" || text.startsWith("~/")) return [path.join(os.homedir(), text.slice(1))];
  if (text.startsWith("~")) return null; // ~user
  if (path.isAbsolute(text)) return [path.resolve(text)];
  if (ctx.cwdUnknown) return null;
  return [...new Set(ctx.dirs.map((d) => path.resolve(d, text)))];
}

/** `cd`/`pushd` (and `env -C`): widen the set of possible working directories. */
function changeDir(target, ctx) {
  if (!target) {
    ctx.dirs.push(os.homedir());
    return;
  }
  const c = target.dynamic || target.text === "-" || /[*?[\]{}]/.test(target.text) ? null : candidates(target.text, ctx);
  if (!c) ctx.cwdUnknown = true;
  else ctx.dirs = [...new Set([...ctx.dirs, ...c])];
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
  let dirWord = null;
  let i = 1;
  let workspace = false;
  for (; i < words.length && words[i].text.startsWith("-"); i++) {
    const t = words[i].text;
    const eq = /^--(dir|prefix|cwd)=(.*)$/.exec(t);
    if (eq) dirWord = { text: eq[2], dynamic: words[i].dynamic };
    else if (["-C", "--dir", "--prefix", "--cwd"].includes(t)) dirWord = words[++i] ?? lit("");
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
  else if (name !== "bun" && ["test", "t", "tst", "start", "stop", "restart"].includes(sub.text)) {
    script = { ...sub, text: /^t(e?st)?$/.test(sub.text) ? "test" : sub.text };
  } else if (name !== "npm") {
    script = sub; // pnpm/yarn/bun run an unknown command as a script
    explicit = false;
  }
  if (!script) return null;
  if (script.dynamic || sub.dynamic || dirWord?.dynamic) return { indirect: "a package script chosen by a variable" };
  if (workspace) return { indirect: "a workspace-wide package script run (write the script's command instead)" };
  const dirs = dirWord ? candidates(dirWord.text, ctx) : ctx.cwdUnknown ? null : ctx.dirs;
  if (!dirs) return { indirect: "a package script in a directory that cannot be determined" };
  // Nearest package.json from every directory the line may be in.
  const found = [];
  for (const start of dirs) {
    for (let d = start; ; d = path.dirname(d)) {
      const file = path.join(d, "package.json");
      let scripts = null;
      try {
        scripts = JSON.parse(fs.readFileSync(file, "utf8")).scripts || {};
      } catch {
        if (d === path.dirname(d)) break;
        continue;
      }
      ctx.execs.push(file);
      if (typeof scripts[script.text] === "string") found.push(scripts);
      break;
    }
  }
  if (!found.length) return explicit ? { indirect: `a package script that cannot be resolved (${script.text})` } : null;
  return {
    scripts: found.flatMap((scripts) =>
      ["pre", "", "post"]
        .filter((p) => typeof scripts[p + script.text] === "string")
        .map((p) => [`the package script ${p + script.text}`, scripts[p + script.text]])
    ),
  };
}

const MAKE_FILES = {
  make: ["GNUmakefile", "makefile", "Makefile"],
  just: ["justfile", "Justfile", ".justfile", "JUSTFILE"],
  task: ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml", "Taskfile.dist.yml"],
};
const MAKE_GUARDED_RE = /(^|[^\w.-])x?k6\b|run-test|run-distributed|run-regression|quick\.sh|find-capacity|--unsafe|K6_ALLOW_PROD_LOAD/;

/**
 * make/just/task: recipes are not parsed. The task file is read and refused when it
 * mentions k6, the runners or the unsafe/prod-load switches, or when it cannot be read.
 * @returns {string|null} indirect reason
 */
function taskRunner(words, ctx) {
  const tool = { gmake: "make", make: "make", just: "just", task: "task" }[path.posix.basename(words[0].text)];
  if (words.some((w) => w.dynamic)) return `${tool} with arguments from variables`;
  let file = null;
  let dir = null;
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text;
    const eq = /^--(file|makefile|justfile|taskfile|directory|dir|working-directory)=(.*)$/.exec(t);
    if (eq) /file$/.test(eq[1]) ? (file = eq[2]) : (dir = eq[2]);
    else if (["-f", "--file", "--makefile", "--justfile", "-t", "--taskfile"].includes(t)) file = words[++i]?.text ?? "";
    else if (["-C", "--directory", "-d", "--dir", "--working-directory"].includes(t)) dir = words[++i]?.text ?? "";
  }
  const bases = dir === null ? (ctx.cwdUnknown ? null : ctx.dirs) : candidates(dir, ctx);
  if (!bases) return `${tool} in a directory that cannot be determined`;
  const files = bases.flatMap((b) => (file !== null ? [path.resolve(b, file)] : MAKE_FILES[tool].map((n) => path.join(b, n))));
  const existing = files.filter((f) => fs.existsSync(f));
  if (!existing.length) return `a ${tool} file that cannot be read`;
  for (const f of existing) {
    ctx.execs.push(f);
    const text = readScript(f, ctx);
    if (text === null) return `a ${tool} file that cannot be read (${path.basename(f)})`;
    if (MAKE_GUARDED_RE.test(text)) return `a ${tool} file that mentions k6 or the runners (${path.basename(f)}); run the command directly`;
  }
  return null;
}

const OUT_REDIRECTS = new Set([">", ">>", "&>", "&>>", ">|", "<>", ">&"]);
const COPY_WRITERS = new Set(["tee", "sponge", "cp", "mv", "install", "ln", "rsync", "truncate", "dd", "sed", "perl"]);
const OPAQUE_WRITERS = new Set([
  "curl", "wget", "patch", "tar", "unzip", "gunzip", "bunzip2", "xz", "unxz", "7z", "scp", "sftp", "awk", "gawk", "mawk",
  "uudecode", "gpg", "age",
]);
// split/csplit write <prefix><suffix> files: value-taking flags, default prefix.
const SPLITTERS = {
  split: { values: ["-a", "-b", "-C", "-l", "-n", "-t", "--additional-suffix", "--filter"], prefix: "x", prefixFlag: null },
  csplit: { values: ["-b", "-f", "-n"], prefix: "xx", prefixFlag: "-f" },
};
const GIT_WRITING = new Set(["checkout", "restore", "switch", "reset", "apply", "am", "pull", "merge", "rebase", "cherry-pick", "revert", "stash", "clone", "worktree", "mv", "rm"]);
const INTERPRETERS = new Set(["node", "python", "python3", "perl", "ruby", "deno", "bun", "php", "lua"]);

/** Record what a command writes (for the write-then-run check). */
function recordWrites(cmd, argv, ctx) {
  const add = (w, prefix = false) => {
    const c = w.dynamic ? null : candidates(w.text, ctx);
    if (!c) ctx.writes.push("*");
    else (prefix ? ctx.prefixWrites : ctx.writes).push(...c.filter((p) => !p.startsWith("/dev/")));
  };
  for (const x of cmd.redirects) {
    if (!OUT_REDIRECTS.has(x.op) || !x.target || /^(\d+|-)$/.test(x.target.text)) continue; // >&2, >&- are fd dups
    add(x.target);
  }
  if (!argv.length) return;
  const name = path.posix.basename(argv[0].text);
  const args = argv.slice(1);
  const typed = cmd.words.map((w) => w.text);
  if (name === "openssl") {
    for (let i = 0; i < args.length; i++) {
      const eq = /^-{1,2}(out|o)=(.*)$/.exec(args[i].text);
      if (eq) add({ ...args[i], text: eq[2] });
      else if (/^-{1,2}(out|o)$/.test(args[i].text) && args[i + 1]) add(args[++i]);
    }
  }
  const sp = SPLITTERS[name];
  if (sp) {
    const pos = [];
    let prefix = null;
    for (let i = 0; i < args.length; i++) {
      const t = args[i].text;
      if (sp.prefixFlag && t === sp.prefixFlag) prefix = args[++i] ?? lit("");
      else if (/^--prefix=/.test(t)) prefix = { ...args[i], text: t.slice(9) };
      else if (sp.values.includes(t)) i++;
      else if (!t.startsWith("-") || t === "-") pos.push(args[i]);
    }
    // split: [input [prefix]]; csplit: input pattern... (prefix only via -f)
    add(prefix || (name === "split" && pos[1]) || lit(sp.prefix), true);
  }
  if (INTERPRETERS.has(path.posix.basename(typed[0] ?? "")) && typed.some((t) => /^(-e|-c|-p|-i\S*|--eval|--print|-E)$/.test(t))) ctx.writes.push("*");
  if (name === "dd") for (const a of args) if (a.text.startsWith("of=")) add({ ...a, text: a.text.slice(3) });
  if (COPY_WRITERS.has(name) && name !== "dd") {
    if ((name === "sed" || name === "perl") && !args.some((a) => /^(-i|--in-place)/.test(a.text))) return;
    for (const a of args) if (!a.text.startsWith("-")) add(a);
  }
  if (OPAQUE_WRITERS.has(name)) ctx.writes.push("*");
  if (name === "git" && args.some((a) => GIT_WRITING.has(a.text))) ctx.writes.push("*");
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
    r.guarded = true;
    if (w.dynamic) {
      r.indirect = "a script path built from variables or substitutions";
      return;
    }
    const cands = candidates(w.text, ctx);
    if (!cands) {
      r.indirect = `a script (${w.text}) in a directory that cannot be determined`;
      return;
    }
    // Runners and repo bin/ are never content-inspected, so only a write to that exact
    // path taints them; anything else counts against any write on the line.
    const isTrusted = (abs) => RUNNER_RE.test(path.basename(abs)) || abs.startsWith(TRUSTED_BIN);
    ctx.execs.push(...cands.filter((abs) => !isTrusted(abs)));
    ctx.trustedExecs.push(...cands.filter(isTrusted));
    const label = `a script (${w.text})`;
    const existing = cands.filter((abs) => fs.existsSync(abs));
    if (mustExist && !existing.length) return nestText(null, label);
    for (const abs of existing) {
      if (RUNNER_RE.test(path.basename(abs)) || abs.startsWith(TRUSTED_BIN)) continue;
      // Executed by path: node/python/binaries are out of scope.
      if (!mustExist && !isShellScript(abs)) continue;
      nestText(readScript(abs, ctx), label);
    }
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
          const v = words.shift();
          if (t === "-C" || t === "--chdir") changeDir(v, ctx);
        } else if (t.startsWith("-")) words.shift();
        else if (assignFrom(words[0])) words.shift();
        else {
          if (words[0].dynamic) r.indirect = "`env` with variable arguments";
          break;
        }
      }
      continue;
    }
    if (["command", "builtin", "nohup", "time", "stdbuf", "sudo", "doas", "exec", "nice", "ionice", "chrt", "setsid", "unbuffer", "corepack"].includes(name)) {
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
    if (name === "npx" || name === "bunx" || (PACKAGE_MANAGERS.has(name) && ["exec", "dlx", "x"].includes(words[1]?.text))) {
      words.shift();
      if (name !== "npx" && name !== "bunx") words.shift();
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
    if (name === "cd" || name === "pushd") {
      changeDir(words.slice(1).find((w) => !/^-[LPe@]+$/.test(w.text)), ctx);
      break;
    }
    if (name in { make: 1, gmake: 1, just: 1, task: 1 }) {
      r.guarded = true;
      const why = taskRunner(words, ctx);
      if (why) r.indirect = why;
      break;
    }
    if (PACKAGE_MANAGERS.has(name)) {
      const run = packageScript(words, ctx);
      r.guarded = !!run; // a package script ran (or could not be resolved)
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
  recordWrites(cmd, words, ctx);
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

// Env names that cannot change what runs; allowed before a guarded command. K6_* is
// allowed except the prod-load switch and the ones the runners use to pick a binary,
// image, extension, report CLI or secret source, or to skip checks.
const INERT_ENV_RE = /^(NODE_ENV|CI|DEBUG|TZ|LANG|LC_\w+|FORCE_COLOR|NO_COLOR|TERM|COLUMNS|K6_\w+)$/;
const K6_EXEC_ENV_RE = /^K6_(ALLOW_PROD_LOAD|BINARY\w*|CMD|EXEC|EXTENSIONS|IMAGE|REGISTRY|REPORT_CLI|SECRET\w*|SKIP_\w+|CACHE_DIR|REPORTS_DIR)$/;
const isInertEnv = (name) => INERT_ENV_RE.test(name) && !K6_EXEC_ENV_RE.test(name);

// A k6 token, a runner name or a guarded switch inside another program's arguments
// (docker run, ssh, kubectl run, interpreters' -c/-e code, vim -c, awk system()...).
const ARG_GUARDED_RE =
  /(^|[\s;&|(){}'"`=:,!/[])x?k6(?=$|[\s;&|(){}'"`,:@\]])|(run-test|run-distributed|quick|run-regression)\.sh|find-capacity\.js|--unsafe\b|K6_ALLOW_PROD_LOAD/;
// Commands whose arguments are data (patterns, messages, paths to look at), not code.
const DATA_TOOLS = new Set([
  "echo", "printf", "grep", "egrep", "fgrep", "rg", "ag", "sed", "git", "gh", "cat", "ls", "head", "tail", "wc",
  "jq", "yq", "sort", "uniq", "cut", "tr", "diff", "cmp", "test", "[", "[[", "true", "false", "find", "stat", "file",
  "realpath", "readlink", "dirname", "basename", "which", "type", "whereis", "shellcheck", "shfmt", "cp", "mv", "ln",
  "rm", "mkdir", "chmod", "touch", "md5sum", "sha256sum", "sha1sum", "cd", "pushd", "popd", "export", "declare",
  "local", "readonly", "typeset", "alias", "unset", "tee", "column", "fold", "nl", "comm", "join", "paste", "od", "xxd",
]);

// Container CLIs and package managers whose subcommand only looks at images, containers
// or packages: `docker pull grafana/k6`, `pacman -Qo /usr/bin/k6` run nothing. The
// subcommand must be the first argument (a global flag could hide the real one).
const CONTAINER_CLIS = new Set(["docker", "podman", "nerdctl"]);
const CONTAINER_DATA_CMDS = new Set(["pull", "push", "images", "inspect", "ps", "rmi", "tag", "history", "logs", "version", "info", "search", "stop", "kill", "rm"]);
const CONTAINER_DATA_SUBCMDS = new Map([
  ["image", new Set(["ls", "list", "inspect", "rm", "remove", "pull", "push", "prune", "history", "tag"])],
  ["container", new Set(["ls", "list", "inspect", "logs", "rm", "remove", "stop", "kill"])],
]);
const PKG_QUERY_RE = /^(-Q\w*|-F\w*|-S[si]+|--query|--files)$/;
function nonExecuting(name, args) {
  const [a, b] = args.map((w) => (w.dynamic ? null : w.text));
  if (CONTAINER_CLIS.has(name)) return CONTAINER_DATA_CMDS.has(a) || Boolean(CONTAINER_DATA_SUBCMDS.get(a)?.has(b));
  if (name === "pacman" || name === "yay" || name === "paru") return a != null && PKG_QUERY_RE.test(a);
  return false;
}

// Variables that make a shell or git run another program.
const EXEC_ENV_RE = /^(BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|PROMPT_COMMAND|PAGER|EDITOR|VISUAL|GIT_(PAGER|EDITOR|SEQUENCE_EDITOR|SSH|SSH_COMMAND|EXTERNAL_DIFF|ASKPASS|CONFIG_.*))$/;
const GIT_EXEC_KEY_RE = /^(core\.(pager|editor|sshcommand|fsmonitor|hookspath|askpass)|alias\.|sequence\.editor|diff\.external|credential\.helper|gpg\.program|pager\.|.*\.(textconv|command|cmd|process|clean|smudge))/i;

function gitRunsCommands(args) {
  const texts = args.map((a) => a.text);
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] === "-c" && GIT_EXEC_KEY_RE.test(texts[i + 1] ?? "")) return true;
    if (texts[i].startsWith("--config-env") || texts[i].startsWith("--exec-path=")) return true;
  }
  const cfg = texts.indexOf("config");
  return cfg !== -1 && texts.slice(cfg + 1).some((t) => GIT_EXEC_KEY_RE.test(t));
}

const isK6 = (w) => !w.dynamic && /^x?k6$/.test(base(w));
// The human-only approval tool (bin/approve-run.sh) and its backend (bin/_run-approval.js).
const APPROVAL_RE = /(^|[^\w.-])(approve-run(\.sh)?|_run-approval(\.js)?)(?![\w-])/;
const APPROVAL_HINT = "approvals are human-only: ask the user to run bin/approve-run.sh in their own terminal";
const isRunner = (w) => !w.dynamic && RUNNER_RE.test(base(w));

/**
 * Parse and classify a command line for the guards.
 * @returns {{error: string|null, commands: ReturnType<typeof resolve>[], indirect: string|null,
 *   approval: boolean, k6Load: boolean, prodLoad: {literalTrue: boolean, any: boolean}, runners: ReturnType<typeof resolve>[], unsafeFlag: boolean}}
 */
function analyze(command, opts = {}) {
  const res = { error: null, commands: [], indirect: null, approval: false, k6Load: false, prodLoad: { literalTrue: false, any: false }, runners: [], unsafeFlag: false };
  let commands;
  const ctx = newContext(opts.cwd);
  try {
    commands = resolveAll(parseShell(command), 0, ctx);
  } catch (e) {
    if (!(e instanceof ShellParseError)) throw e;
    res.error = e.message;
    return res;
  }
  res.commands = commands;
  const line = { runs: false, sources: false };
  const flag = (reason) => (res.indirect ??= reason);
  // Any env assignment (PATH=..., export X=..., env X=...) earlier on the line can change
  // what a guarded command runs, so it is refused before one.
  let assigned = false;
  const envAssign = (list) => list.some((a) => a.name.text !== "K6_ALLOW_PROD_LOAD" && !isInertEnv(a.name.text));

  for (const r of commands) {
    if (r.indirect) flag(r.indirect);
    const decl = declarations(r);
    if (envAssign(r.assigns)) assigned = true;
    const guardedHead = r.argv[0] && !r.argv[0].dynamic && (isK6(r.argv[0]) || isRunner(r.argv[0]) || /^x?k6\s/.test(r.argv[0].text));
    if (assigned && (r.guarded || guardedHead)) flag("an environment assignment before a test run, script or package script (it can change what runs)");
    if (envAssign(decl.assigns)) assigned = true;
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
    // Running the approval tool in any form (directly, via a shell, source, node, a pty
    // wrapper such as script/expect/unbuffer, find -exec, interpreter code). Data tools
    // that only read or mention it (cat, grep, git, gh, ...) are fine.
    const dataOnly = !head.dynamic && DATA_TOOLS.has(base(head)) && !(base(head) === "find" && args.some((a) => /^-(exec|execdir|ok|okdir)$/.test(a.text)));
    if (!dataOnly && r.argv.some((w) => APPROVAL_RE.test(w.text))) res.approval = true;
    if (head.dynamic) {
      flag("a command name built from a variable or substitution");
      continue;
    }
    const name = base(head);
    if (head.text !== "[" && head.text !== "[[" && /[[\]?*{}]/.test(head.text)) flag("a command name with glob or brace characters");
    const launcher = !DATA_TOOLS.has(name) && name !== "helm" && !isK6(head) && !isRunner(head) && !/^x?k6\s/.test(head.text) && !nonExecuting(name, args);
    // kubectl: resource and release names like "k6" are data; the container command
    // (after --) and --image are not.
    const scanned = name === "kubectl" ? [...args.slice(args.findIndex((a) => a.text === "--") + 1 || args.length), ...args.filter((a) => a.text.startsWith("--image"))] : args;
    if (launcher && scanned.some((a) => ARG_GUARDED_RE.test(a.text))) {
      flag(`k6 or a runner referenced inside the arguments of ${name} (container, remote shell, interpreter code, ...); run tests with ./bin/run-test.sh`);
    }
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
  // Write-then-run: the hook reads files before the line executes, so a file written on
  // the same line may not be what runs.
  const unknownWrite = ctx.writes.includes("*");
  const written = (e) => ctx.writes.some((w) => e === w || e.startsWith(w + path.sep)) || ctx.prefixWrites.some((p) => e.startsWith(p));
  const hit = ctx.execs.find((e) => unknownWrite || written(e)) ?? ctx.trustedExecs.find(written);
  if (hit) flag(`a command line that writes files and runs ${path.basename(hit)}; write the file in one command and run it in another`);
  return res;
}

const INDIRECTION_HINT = "indirection not allowed; write the command literally";

module.exports = { DYN, INDIRECTION_HINT, APPROVAL_HINT, APPROVAL_RE, analyze, parseShell, resolve, resolveAll, declarations, ShellParseError, base };
