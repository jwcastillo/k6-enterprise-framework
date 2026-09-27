/**
 * bin/_shell-guard.js — the shell parser behind the Claude hook and the agent Bash guard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
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

  // Adversarial review: package scripts, script files and a few wrappers were invisible.
  describe("resolves package scripts", () => {
    const at = { cwd: ROOT };
    it.each(["pnpm test:reference", "pnpm run test:reference", "npm run test:reference", "yarn test:reference", "pnpm --dir . run test:reference"])(
      "%s runs k6",
      (cmd) => {
        expect(analyze(cmd, at).k6Load).toBe(true);
      }
    );

    it("refuses scripts it cannot resolve or that fan out over workspaces", () => {
      expect(analyze("pnpm run no-such-script", at).indirect).toMatch(/cannot be resolved/);
      expect(analyze("pnpm -r test", at).indirect).toMatch(/workspace/);
      expect(analyze("pnpm run $S", at).indirect).toBeTruthy();
    });

    it("keeps ordinary scripts usable", () => {
      for (const cmd of ["pnpm lint", "pnpm test", "pnpm validate", "npm test", "pnpm install"]) {
        const a = analyze(cmd, at);
        expect(a.indirect, cmd).toBeNull();
        expect(a.k6Load, cmd).toBe(false);
      }
    });
  });

  describe("reads script files", () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-guard-"));
      fs.writeFileSync(path.join(dir, "evil.sh"), "#!/bin/bash\necho start\n" + ["k6", "run", "x.js"].join(" ") + "\n");
      fs.writeFileSync(path.join(dir, "ok.sh"), "#!/bin/sh\necho fine\n");
      fs.writeFileSync(path.join(dir, "weird.sh"), "echo 'unterminated\n");
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it.each(["bash evil.sh", "sh ./evil.sh", "./evil.sh", "source evil.sh", ". evil.sh", "zsh -e evil.sh"])("%s is inspected", (cmd) => {
      expect(analyze(cmd, { cwd: dir }).k6Load).toBe(true);
    });

    it("refuses scripts that are missing or unparseable, allows clean ones", () => {
      expect(analyze("bash missing.sh", { cwd: dir }).indirect).toMatch(/cannot be inspected/);
      expect(analyze("source missing.sh", { cwd: dir }).indirect).toMatch(/cannot be inspected/);
      expect(analyze("bash weird.sh", { cwd: dir }).indirect).toMatch(/cannot be parsed/);
      const ok = analyze("bash ok.sh && ./ok.sh", { cwd: dir });
      expect(ok.indirect).toBeNull();
      expect(ok.k6Load).toBe(false);
    });

    it("does not re-parse the runners or the repo's own bin/ tooling", () => {
      expect(analyze("./bin/run-test.sh --scenario=api/x", { cwd: ROOT }).k6Load).toBe(false);
      expect(analyze("bash bin/detect-secrets.sh src", { cwd: ROOT }).indirect).toBeNull();
    });
  });

  it("sees through watch, find -exec, glob names, git exec config and exec env vars", () => {
    expect(analyze("watch -n 5 k6 run x.js").k6Load).toBe(true);
    expect(analyze("find . -name x.js -exec k6 run {} ;").k6Load).toBe(true);
    for (const cmd of [
      "k[6] run x.js",
      "k? run x.js",
      "{k6,x} run x.js",
      "git -c core.pager=less log",
      "git config alias.x '!true'",
      "BASH_ENV=x.sh bash -c true",
      "helm template x . --post-renderer=./r.sh",
    ]) {
      expect(analyze(cmd).indirect, cmd).toBeTruthy();
    }
    expect(analyze("[ -f x ] && git log -1").indirect).toBeNull();
  });

  // Second adversarial pass.
  describe("second pass", () => {
    const LOAD = ["k6", "run", "x.js"].join(" ");
    let dir: string;
    let evil: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-guard2-"));
      fs.writeFileSync(path.join(dir, "x.sh"), "echo benign\n");
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "echo benign", load: LOAD } }));
      fs.writeFileSync(path.join(dir, "Makefile"), "build:\n\techo ok\n");
      evil = fs.mkdtempSync(path.join(os.tmpdir(), "shell-guard2-evil-"));
      fs.writeFileSync(path.join(evil, "package.json"), JSON.stringify({ scripts: { test: LOAD } }));
      fs.writeFileSync(path.join(evil, "Makefile"), `test:\n\t${LOAD}\n`);
      fs.writeFileSync(path.join(evil, "justfile"), `test:\n  ${LOAD}\n`);
    });
    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(evil, { recursive: true, force: true });
    });
    const at = () => ({ cwd: dir });

    it.each([
      `printf '%s\\n' '${LOAD}' > x.sh && bash x.sh`,
      `cat > x.sh <<'EOF'\n${LOAD}\nEOF\nbash x.sh`,
      "cp /tmp/other.sh x.sh; ./x.sh",
      "echo hi | tee x.sh; source x.sh",
      "sed -i s/benign/other/ x.sh && sh x.sh",
      `echo '{"scripts":{}}' > package.json && pnpm test`,
      "git checkout other -- x.sh && bash x.sh",
      "echo x > $F; bash x.sh",
    ])("write-then-run is refused: %s", (cmd) => {
      expect(analyze(cmd, at()).indirect).toMatch(/writes files and runs/);
    });

    it("allows writing files that are not run", () => {
      const a = analyze("./bin/run-test.sh --scenario=api/x 2>&1 | tee reports/run.log", { cwd: ROOT });
      expect(a.indirect).toBeNull();
      expect(analyze("bash x.sh > out.log", at()).indirect).toBeNull();
    });

    it("tracks cd for package scripts and script files", () => {
      expect(analyze(`cd ${evil} && pnpm test`, at()).k6Load).toBe(true);
      expect(analyze(`pushd ${evil} && make test`, at()).indirect).toMatch(/mentions k6/);
      expect(analyze(`env -C ${evil} pnpm test`, at()).k6Load).toBe(true);
      for (const cmd of ["cd $D && pnpm test", "cd - && pnpm test", "cd ~nobody && bash x.sh", "cd * && pnpm test"]) {
        expect(analyze(cmd, at()).indirect, cmd).toMatch(/cannot be determined/);
      }
    });

    it("inspects corepack, bun, bunx, make, just and task", () => {
      for (const cmd of ["corepack pnpm load", "bun run load", "bun load", "bunx --bun pnpm load", "corepack yarn run load"]) {
        expect(analyze(cmd, at()).k6Load, cmd).toBe(true);
      }
      expect(analyze("make test", { cwd: evil }).indirect).toMatch(/make file that mentions k6/);
      expect(analyze("just test", { cwd: evil }).indirect).toMatch(/just file that mentions k6/);
      expect(analyze("task test", { cwd: evil }).indirect).toMatch(/cannot be read/);
      expect(analyze("make -f $M", at()).indirect).toBeTruthy();
      expect(analyze("make build", at()).indirect).toBeNull();
    });

    it("refuses any env assignment before a guarded command, not before others", () => {
      for (const cmd of [
        "PATH=/tmp/evil:$PATH ./bin/run-test.sh --scenario=api/x",
        "export PATH=/tmp/evil; ./bin/run-test.sh --scenario=api/x",
        "env npm_config_script_shell=/tmp/sh pnpm test",
        "FOO=1 bash x.sh",
        "NODE_OPTIONS=--x pnpm test",
      ]) {
        expect(analyze(cmd, at()).indirect, cmd).toMatch(/environment assignment/);
      }
      for (const cmd of ["FOO=1 echo hi", "CI=1 pnpm install", "export X=1; ls"]) {
        expect(analyze(cmd, at()).indirect, cmd).toBeNull();
      }
    });

    it("parses case ... esac and still sees commands in its branches", () => {
      const a = analyze(`case "$1" in a|b) echo a;; (c) echo c ;; *) echo x;; esac; echo after`);
      expect(a.error).toBeNull();
      expect(a.indirect).toBeNull();
      expect(analyze(`case x in a) ${LOAD};; esac`).k6Load).toBe(true);
    });
  });

  // Third adversarial pass.
  describe("third pass", () => {
    const K = "k6";
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-guard3-"));
      for (const f of ["x.sh", "xaa", "xx00", "pfx00"]) fs.writeFileSync(path.join(dir, f), "echo benign\n");
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it.each([
      `docker run --rm grafana/${K} run - < x.js`,
      `docker run --rm -v $PWD:/s img ${K} run /s/x.js`,
      `kubectl run t --image=busybox -- ${K} run x.js`,
      `kubectl run t --image=grafana/${K}:latest`,
      `kubectl exec pod-1 -- ${K} run x.js`,
      `ssh host ${K} run x.js`,
      `ssh host ./bin/run-test.sh --scenario=api/x`,
      `vim -c '!${K} run x.js' -c q`,
      `less +'!${K} run x.js' README.md`,
      `awk 'BEGIN{system("${K} run x.js")}'`,
      `tclsh -c 'exec ${K} run x.js'`,
      `perl -e 'system("${K} run x.js")'`,
      `python3 -c "import os; os.system('${K} run x.js')"`,
      `ruby -e 'system("${K} cloud x.js")'`,
      `php -r 'system("${K} run x.js");'`,
      `lua -e 'os.execute("${K} run x.js")'`,
      `deno eval 'new Deno.Command("${K}")'`,
      `node -e 'require("child_process").execSync("${K} run x.js")'`,
      `python3 -c "import subprocess; subprocess.run(['./bin/run-test.sh', '--unsafe'])"`,
    ])("k6 inside another program's arguments is refused: %s", (cmd) => {
      expect(analyze(cmd).indirect).toMatch(/inside the arguments of/);
    });

    it.each([
      `git commit -m "fix: ${K} run docs"`,
      `echo "use ./bin/run-test.sh, not ${K} run"`,
      `grep -rn "${K} run" docs`,
      `rg '${K} (run|cloud)' bin`,
      `sed -n '/${K} run/p' README.md`,
      "cat bin/run-test.sh",
      "shellcheck bin/run-test.sh",
      "ls ~/.k6 dist/k6-embedded",
      "pnpm test test/bin/run-test-exit-codes.test.ts",
      `helm status ${K} -n ${K}-tests`,
      `kubectl get testrun ${K}-load-test -n ${K}-tests`,
    ])("plain mentions in data tools stay allowed: %s", (cmd) => {
      expect(analyze(cmd, { cwd: ROOT }).indirect).toBeNull();
    });

    it.each([
      "openssl enc -d -in p.enc -out x.sh -k s && bash x.sh",
      "openssl enc -d -in p.enc -out=x.sh && bash x.sh",
      "printf x | sponge x.sh && bash x.sh",
      "split -b 1000000 in.sh && bash xaa",
      "split -l 5 in.sh pfx && bash pfx00",
      "csplit in.sh /---/ && bash xx00",
      "csplit -f pfx in.sh /---/ && bash pfx00",
      "exec 3>x.sh; bash x.sh",
      "echo x >| x.sh; bash x.sh",
      "echo x &> x.sh; bash x.sh",
      "echo x >&x.sh; bash x.sh",
    ])("more writers are tracked: %s", (cmd) => {
      expect(analyze(cmd, { cwd: dir }).indirect).toMatch(/writes files and runs/);
    });

    it("unknown writes do not taint the runners or repo bin/, direct writes to them still do", () => {
      for (const cmd of ["git pull && ./bin/run-test.sh --profile=smoke --scenario=api/x", "curl -sO https://example.com/f && bash bin/detect-secrets.sh src"]) {
        expect(analyze(cmd, { cwd: ROOT }).indirect, cmd).toBeNull();
      }
      expect(analyze("cp /tmp/x bin/run-test.sh && ./bin/run-test.sh --scenario=api/x", { cwd: ROOT }).indirect).toMatch(/writes files and runs/);
      expect(analyze("git pull && bash x.sh", { cwd: dir }).indirect).toMatch(/writes files and runs/);
    });

    it("allows inert env names before guarded commands, not the ones that change what runs", () => {
      for (const cmd of ["K6_DEBUG=1 ./bin/run-test.sh --scenario=api/x", "NODE_ENV=test pnpm test", "CI=1 FORCE_COLOR=0 LC_ALL=C pnpm lint", "TZ=UTC K6_PROFILE=smoke ./bin/run-test.sh --scenario=api/x"]) {
        expect(analyze(cmd, { cwd: ROOT }).indirect, cmd).toBeNull();
      }
      for (const cmd of [
        "K6_BINARY_PATH=/tmp/k ./bin/run-test.sh --scenario=api/x",
        "K6_SKIP_VALIDATE=1 ./bin/run-test.sh --scenario=api/x",
        "PATH=/tmp:$PATH ./bin/run-test.sh --scenario=api/x",
        "NODE_OPTIONS=--require=/tmp/x.js pnpm test",
        "npm_config_script_shell=/tmp/sh pnpm test",
        "SHELL=/tmp/sh pnpm test",
        "GIT_DIR=/tmp pnpm test",
        "LD_PRELOAD=/tmp/x.so ./bin/run-test.sh --scenario=api/x",
      ]) {
        expect(analyze(cmd, { cwd: ROOT }).indirect, cmd).toBeTruthy();
      }
    });
  });

  it("stays fast on large input", () => {
    const t0 = Date.now();
    analyze("echo 'x' && ".repeat(5000) + "true");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
