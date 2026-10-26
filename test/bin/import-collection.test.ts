/**
 * bin/import-collection.js — Postman v2.1, Bruno and curl into one intermediate form and client code.
 * Spawned as a CLI (dry-run JSON and exit codes are the contract); generated files go to a throwaway client.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "bin/import-collection.js");
const FX = path.join(ROOT, "test/fixtures/import-collection");
const CLIENT = `__import_test_${process.pid}`;
const CLIENT_DIR = path.join(ROOT, "clients", CLIENT);
const PREFIX = `${CLIENT.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_`;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require(path.join(ROOT, "bin/import/collection.js"));

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT, `--client=${CLIENT}`, ...args], { cwd: ROOT, encoding: "utf-8", timeout: 120000 });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function dry(from: string, extra: string[] = []) {
  const r = run([`--from=${path.join(FX, from)}`, "--dry-run", ...extra]);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

function allGenerated(): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(fs.readFileSync(p, "utf-8"));
    }
  };
  walk(CLIENT_DIR);
  return out.join("\n");
}

beforeAll(() => fs.mkdirSync(path.join(CLIENT_DIR, "scenarios"), { recursive: true }));
afterAll(() => fs.rmSync(CLIENT_DIR, { recursive: true, force: true }));

describe("bin/import-collection.js", () => {
  it("parses Postman: folders, bearer auth, status, extracted variables and warnings", () => {
    const d = dry("shop.postman.json");
    const r = d.parsed.requests;
    expect(r.map((x: { name: string }) => x.name)).toEqual(["Catalog List", "Cart List", "Login", "Add to cart", "Upload"]);
    expect(r[1].headers.Authorization).toBe("Bearer {{token}}");
    expect(r[2]).toMatchObject({ method: "POST", path: "/v1/login", expect: 200, json: true, extract: [{ var: "token", path: "session.token" }] });
    expect(r[3]).toMatchObject({ expect: 201, headers: { Authorization: "Bearer {{token}}" } });
    expect(r[3].headers["X-Off"]).toBeUndefined(); // header deshabilitado
    expect(d.parsed.base).toEqual({ var: "baseUrl" });
    expect(d.secrets_to_export).toEqual([`${PREFIX}PASSWORD`]); // token lo extrae el login
    expect(d.flow_only).toEqual(["Cart List", "Add to cart"]);
    const w = d.warnings.join("\n");
    expect(w).toMatch(/Login: el pre-request script no se importa/);
    expect(w).toMatch(/Add to cart: parte del test script no se importa/);
    expect(w).toMatch(/Upload: auth oauth2 no soportada/);
    expect(w).toMatch(/Upload: body formdata no soportado/);
  });

  it("parses Bruno with an environment: secrets from vars:secret, post-response vars, bearer auth", () => {
    const d = dry("bruno", ["--bruno-env=dev"]);
    const r = d.parsed.requests;
    expect(r.map((x: { method: string; path: string }) => `${x.method} ${x.path}`)).toEqual(["GET /v1/products?page=1", "POST /v1/login", "POST /v1/cart/items"]);
    expect(r[1].extract).toEqual([{ var: "token", path: "session.token" }]); // ~disabled se ignora
    expect(r[2]).toMatchObject({ expect: 201, headers: { Authorization: "Bearer {{token}}" } });
    expect(d.parsed.variables).toMatchObject({ baseUrl: "https://api.example.com", user: "demo" });
    expect(d.secrets_to_export).toEqual([`${PREFIX}PASSWORD`]);
    expect(d.warnings).toEqual([]);
  });

  it("parses curl and lifts literal credentials into env vars", () => {
    const d = dry("shop.curl.sh", ["--env-prefix=SHOP_"]);
    const r = d.parsed.requests;
    expect(r.map((x: { name: string; method: string }) => `${x.name}:${x.method}`)).toEqual(["List:GET", "Login:POST", "GET /v1/cart:GET"]);
    expect(JSON.parse(r[1].body)).toEqual({ user: "demo", password: "{{password}}" });
    expect(r[2].headers.Authorization).toBe("Bearer {{authorization}}");
    expect(d.secrets_to_export.sort()).toEqual(["SHOP_AUTHORIZATION", "SHOP_PASSWORD"]);
    expect(JSON.stringify(d)).not.toMatch(/literal-secret-123|eyJliteral/);
  });

  it("refuses collections that point at more than one host", () => {
    const r = run([`--from=${path.join(FX, "two-hosts.curl.sh")}`, "--dry-run"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/más de un host/);
  });

  it("writes service + api/ + flow/ without secret values, then refuses to overwrite", () => {
    const r = run([`--from=${path.join(FX, "shop.postman.json")}`, "--name=shop", "--no-validate"]);
    expect(r.code, r.stderr).toBe(0);
    const files = JSON.parse(r.stdout).files.map((f: string) => f.replace(`clients/${CLIENT}/`, ""));
    expect(files).toEqual(["lib/services/shop.service.ts", "scenarios/api/shop/catalog-list.ts", "scenarios/api/shop/login.ts",
      "scenarios/api/shop/upload.ts", "scenarios/flow/shop.ts"]);
    const code = allGenerated();
    expect(code).not.toMatch(/pa\\?"ss/); // el valor de la contraseña (pa"ss\word) nunca va a disco
    expect(code).toContain('"password": "${jv("password")}"'); // escapado dentro del JSON
    expect(code).toContain('remember("token", res.json("session.token"))');
    expect(code).toContain("[statusCheck(201)]");
    const again = run([`--from=${path.join(FX, "shop.postman.json")}`, "--name=shop", "--no-validate"]);
    expect(again.code).toBe(2);
    expect(again.stderr).toMatch(/--force/);
    fs.writeFileSync(path.join(CLIENT_DIR, "scenarios/flow/shop.ts"), "// escrito a mano\n");
    const handWritten = run([`--from=${path.join(FX, "shop.postman.json")}`, "--name=shop", "--no-validate", "--force"]);
    expect(handWritten.code).toBe(2);
    expect(handWritten.stderr).toMatch(/no lo generó este importador/);
  });

  it("generated scenarios pass the generation gate", () => {
    const r = run([`--from=${path.join(FX, "bruno")}`, "--bruno-env=dev", "--name=gate"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/PASS scenario .*scenarios\/flow\/gate\.ts/);
  }, 120000); // compila con webpack y corre k6 inspect por escenario

  it("shellSplit handles quotes, escapes and line continuations", () => {
    expect(lib.shellSplit(`curl -H 'A: "x"' -d "{\\"k\\": 1}" a\\ b \\\n --x`)).toEqual(["curl", "-H", 'A: "x"', "-d", '{"k": 1}', "a b", "--x"]);
    expect(() => lib.shellSplit("curl 'abierta")).toThrow(/comilla/);
  });
});
