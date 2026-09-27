/**
 * bin/_shell-guard.js — the shell parser behind the Claude hook and the agent Bash guard.
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";

const { parseShell, analyze, ShellParseError } = require(path.resolve(__dirname, "../../bin/_shell-guard.js"));

type Cmd = { words: { text: string }[]; heredocs: string[] };
const words = (src: string) => parseShell(src).map((c: Cmd) => c.words.map((w) => w.text));

describe("parseShell", () => {
  it("removes quotes and joins adjacent pieces like bash", () => {
    expect(words(`k6" "run app.js`)).toEqual([["k6 run", "app.js"]]);
    expect(words(`k""6 'run' x`)).toEqual([["k6", "run", "x"]]);
    expect(words(`k\\6 run`)).toEqual([["k6", "run"]]);
    expect(words(`$'\\x6b6' run`)).toEqual([["k6", "run"]]);
  });

  it("splits on operators and newlines, keeping fd redirections out of argv", () => {
    expect(words("a 1; b && c || d | e\nf 2>&1 >/dev/null")).toEqual([["a", "1"], ["b"], ["c"], ["d"], ["e"], ["f"]]);
  });

  it("parses command substitutions and backticks as commands", () => {
    expect(words("echo $(k6 run x) `k6 cloud y`").map((w: string[]) => w.slice(0, 2))).toEqual([
      ["k6", "run"],
      ["k6", "cloud"],
      ["echo", "\u0000"],
    ]);
  });

  it("keeps heredoc bodies as data", () => {
    const [cmd] = parseShell("cat <<'EOF'\nk6 run x\ndon't\nEOF");
    expect(cmd.words.map((w: { text: string }) => w.text)).toEqual(["cat"]);
    expect(cmd.heredocs).toEqual(["k6 run x\ndon't"]);
  });

  it("throws ShellParseError on unbalanced input", () => {
    for (const bad of [`echo "x`, "echo 'x", "echo $(ls", "echo `ls", "cat <<EOF\nno end"]) {
      expect(() => parseShell(bad), bad).toThrow(ShellParseError);
    }
  });
});

describe("analyze", () => {
  it("finds k6 load through shells, eval, env -S and wrappers", () => {
    for (const cmd of [
      `bash -c "k6 run app.js"`,
      `sh -c 'k6 run app.js'`,
      `zsh -lc "cd dist && k6 cloud x.js"`,
      `eval "k6 run x.js"`,
      `env -S "k6 run x.js"`,
      `nohup timeout 60 k6 run x.js`,
      `bash <<EOF\nk6 run x.js\nEOF`,
      `(cd dist && k6 run x.js)`,
      `k6" "run app.js`,
    ]) {
      expect(analyze(cmd).k6Load, cmd).toBe(true);
    }
  });

  it("flags indirection", () => {
    for (const cmd of [
      "V=--unsafe; ./bin/run-test.sh --scenario=x $V",
      "K6_ALLOW_PROD_LOAD=$V ./bin/run-test.sh --scenario=x",
      `V=K6_ALLOW_PROD_LOAD; export "$V=true"; ./bin/run-test.sh --profile=smoke`,
      `export "$V=true"`,
      "$CMD run x.js",
      "$(echo k6) run x.js",
      "k6 $SUB x.js",
      "cat cmd.txt | bash",
      "ls | xargs ./bin/run-test.sh",
      "source env.sh; ./bin/run-test.sh --scenario=x",
      `bash -c "$SCRIPT"`,
      "alias r='k6 run'",
    ]) {
      expect(analyze(cmd).indirect, cmd).toBeTruthy();
    }
  });

  it("does not flag everyday commands", () => {
    for (const cmd of [
      "ls -la && git status",
      "pnpm test 2>&1 | tail -5",
      "git commit -F msg.txt",
      `echo "$HOME"`,
      "for f in a b; do echo $f; done",
      "k6 inspect dist/x.js && k6 version",
      `echo "k6 run is documented"`,
    ]) {
      const a = analyze(cmd);
      expect(a.error, cmd).toBeNull();
      expect(a.indirect, cmd).toBeNull();
      expect(a.k6Load, cmd).toBe(false);
    }
  });

  it("sees --unsafe and K6_ALLOW_PROD_LOAD=true behind quoting, wrappers and bash <script>", () => {
    expect(analyze(`./bin/run-test.sh --scenario=x "--unsafe"`).unsafeFlag).toBe(true);
    expect(analyze("bash bin/run-test.sh --scenario=x --unsafe").unsafeFlag).toBe(true);
    expect(analyze(`env "K6_ALLOW_PROD_LOAD=true" ./bin/run-test.sh`).prodLoad.literalTrue).toBe(true);
    expect(analyze("export K6_ALLOW_PROD_LOAD=true; ./bin/run-test.sh").prodLoad.literalTrue).toBe(true);
  });

  it("stays fast on large input", () => {
    const t0 = Date.now();
    analyze("echo 'x' && ".repeat(5000) + "true");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
