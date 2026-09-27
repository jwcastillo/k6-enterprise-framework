---
title: "Guardarraíles de IA"
sidebar_position: 6
---
# Guardarraíles de IA

Tres capas mantienen lo que produce un agente de IA dentro de la especificación y de las
reglas de seguridad:

1. **Gate de generación** — `bin/validate-generated.js` verifica cada artefacto producido por
   IA de forma determinística (sin LLM) antes de que un humano lo acepte.
2. **SkillSpector** — el escáner de NVIDIA revisa los skills del agente y el servidor MCP en
   busca de prompt injection, exfiltración, privilegios y riesgos de supply chain, en local y en CI.
3. **Hooks de Claude Code** — `.claude/settings.json` impide que un agente saltee el runner,
   habilite carga insegura o commitee tráfico grabado, y corre el gate en cada escenario que edita.

Ninguna es un sandbox: atrapan los errores comunes y caros. Un humano sigue revisando.

## Gate de generación

```bash
node bin/validate-generated.js --kind=scenario|testplan|flow|patch|report <path...> \
  [--client=<name>|--config=<client config json>] [--env=<env>] [--k6-env=KEY=VAL ...] \
  [--format=text|json] [--strict] [--no-build]
```

Códigos de salida: `0` pasa, `1` falla, `2` error de uso. `--format=json` imprime
`{kind, path, verdict: "pass"|"fail", checks: [{id, status, message, file?, line?}]}`
(un array si se pasan varios paths). El estado de cada check es `pass`, `warn`, `fail` o
`skip`; solo `fail` hace fallar el veredicto.

| Kind | Entrada | Verificaciones |
| --- | --- | --- |
| `scenario` | `.ts` de k6 | bucket `api`, `flow`, `domain`, `chaos` o `perf`; `perf/` y `chaos/` declaran `export const gate = "unsafe"\|"experimental"\|"quarantined"`; sin imports solo-Node (`@node/*`, `fs`, `path`, `child_process`, `src/ai`, ...); módulos remotos solo de `jslib.k6.io`; todo host hardcodeado está en `allowedHosts`; sin credenciales literales; `thresholds` declarados; `systemTags` sin `url` (warn si no está); `abortOnFail: true` avisa; VUs / rate por encima de `maxVUs` / `maxRate` avisan (fallan con `--strict`); compila con el webpack del repo; `k6 inspect` del bundle pasa (se omite con aviso si k6 no está instalado) |
| `testplan` | JSON del Planner | válido contra `shared/schemas/test-plan.schema.json`; hosts en la allowlist; cada `testTypes` y `profile` existe en `shared/profiles/` |
| `flow` | directorio de discovery o `flow.json` | válido contra `shared/schemas/discovery-flow.schema.json` (se omite con mensaje si no existe); `guardrails.maxSteps > 0` y `stopAt` o `denyText` no vacíos; `hostsSeen` en la allowlist; sin PII (emails, JWT, valores de Authorization / Cookie, secuencias largas de dígitos) ni secretos en `flow.json`, `flow.md`, `flow-plan.md` |
| `patch` | propuesta de self-healing `.md` / `.diff` / `.patch` | es una propuesta, nunca un fuente ya aplicado; solo toca `scenarios/` y `clients/*/{lib,scenarios}/`; no elimina gate markers, thresholds ni llamadas de guard; no agrega hosts nuevos; sin secretos en las líneas agregadas |
| `report` | reporte markdown de IA | cada número aparece en el JSON determinístico (`--data=<file>`, por defecto `<reporte>.json`); sin PII ni secretos; ninguno de `--deny-terms=a,b` (los términos nunca se imprimen) |

Campos de la config del cliente que lee el gate:

```json
{
  "allowedHosts": ["api.staging.example.com"],
  "maxVUs": 200,
  "maxRate": 500
}
```

Sin config: sin allowlist (las URLs hardcodeadas avisan), `maxVUs` 500, `maxRate` 1000.

`--no-build` reemplaza webpack + `k6 inspect` por un transpile solo de sintaxis (medio
segundo en vez de varios). Lo usa el hook PostToolUse; corré el gate completo antes de aceptar.
En `--no-build`, un escenario cuyas options vienen de otro módulo
(`export { options } from "..."` o `export const options = sharedOptions;`) recibe `warn`
en `thresholds` en vez de `fail`: el texto solo no las ve.

### Options resueltas

Cuando `k6 inspect` pasa, el gate lee el objeto de options que resolvió k6 (con imports,
re-exports y funciones helper incluidos) y lo chequea en lugar del texto fuente:

- `thresholds`: al menos una métrica con threshold;
- `system-tags`: `url` no está en `systemTags` (warn si no se define);
- `load-ceiling`: por escenario, el pico de VUs (`vus`, `startVUs`, `maxVUs`,
  `preAllocatedVUs`, targets de stages de VUs) contra `maxVUs` y el pico de tasa (`rate`,
  `startRate`, targets de stages de arrival-rate) contra `maxRate`; warn, o fail con `--strict`.

`k6 inspect` no lee tu entorno de shell. Si el init abre un path desde `__ENV` (un archivo
de datos, un directorio de CSV), pasalo con `--k6-env=KEY=VAL` (repetible); cada uno llega a
`k6 inspect` como `-e KEY=VAL`:

```bash
node bin/validate-generated.js --kind=scenario scenarios/api/orders.ts --strict \
  --k6-env=DATA_DIR=data --k6-env=BASE_URL=https://api.staging.example.com
```

### Repos standalone

En un repo exportado con `bin/export-client.sh --with-claude` el gate vive en `bin/` y
detecta el layout solo (existe `framework/src`): perfiles y schemas salen de
`framework/shared`, y `--env=<env>` lee `config/<env>.json` (y luego `config/default.json`)
sin `--client`.

## SkillSpector

[SkillSpector](https://github.com/NVIDIA/skillspector) escanea `.claude/skills/*` y
`mcp-server/src`.

```bash
uv tool install git+https://github.com/NVIDIA/skillspector.git
bin/scan-skills.sh                 # estático, todos los skills + el servidor MCP
bin/scan-skills.sh --semantic      # + análisis LLM con la sesión local del CLI de claude
bin/scan-skills.sh .claude/skills/mi-skill
```

Cada skill se escanea por separado contra `security/baselines/<skill>.yaml`. El script sale
con `1` si algún target tiene un hallazgo que no está en su baseline. El SARIF queda en
`reports/skillspector/` con paths relativos al repo.

Proceso ante un hallazgo nuevo:

1. Leerlo en contexto. **Verdadero positivo**: corregir el skill (para skills vendorizados de
   un repo upstream — ver `skills-lock.json` — abrir el fix upstream en vez de editar la copia con hash).
2. **Falso positivo**: primero intentar reescribir para que el patrón no matchee, cuando no
   cuesta nada de significado (fijar versión, usar una setup action en vez de `sudo apt`, ...).
3. Recién entonces agregarlo al baseline con su motivo y una fila en
   `security/skillspector-triage.md`.

Regenerar un baseline con
`skillspector baseline .claude/skills/<skill> --no-llm -o security/baselines/<skill>.yaml`
y reemplazar el motivo genérico por el motivo del triage en cada entrada.

CI (`.github/workflows/skillspector.yml`) corre el escaneo estático en los PR que tocan
`.claude/**`, `mcp-server/**` o `security/**`, sube el SARIF a code scanning y falla ante
hallazgos fuera de los baselines.

Un score 0 sin hallazgos puede figurar como `CAUTION` y no `SAFE`: SkillSpector falla cerrado
cuando la cobertura es parcial, por ejemplo si un skill referencia archivos del repo que no
vienen con él, o si su parser acotado de shell se rinde ante un template literal de JavaScript.

Limitaciones: algunas inspecciones de SkillSpector tienen presupuesto de tiempo (0,25 s por
artefacto), así que un runner muy cargado puede reportar un `AE1` de "análisis incompleto" que un
re-run no reporta. Los baselines matchean por id de regla, archivo y texto del hallazgo: una
edición que cambia el texto de una línea baselineada la vuelve a mostrar para revisión.

## Hooks de Claude Code

`.claude/settings.json` conecta `.claude/hooks/guardrails.js`:

| Hook | Matcher | Bloquea |
| --- | --- | --- |
| PreToolUse | `Bash` | `k6 run` / `k6 cloud` directos — usar `./bin/run-test.sh`, que aplica target-guard, gates de escenario y reportes |
| PreToolUse | `Bash` | `--unsafe` o `K6_ALLOW_PROD_LOAD=true`, salvo que el humano haya iniciado Claude Code con `K6_AGENT_ALLOW_UNSAFE=1` exportado en su propia shell |
| PreToolUse | `Bash` | indirección que podría producir cualquiera de los dos anteriores: un nombre de comando desde una variable o sustitución, variables en los argumentos de `k6` o de los runners, una variable con un valor protegido (`V=--unsafe`), `export "$V=..."`, `xargs` manejando el runner, una shell que lee su script de un pipe, `source` en la misma línea que una corrida |
| PreToolUse | `Write\|Edit\|MultiEdit` | tráfico grabado y estado del navegador — `*.har`, `*.har.json`, `*.har.gz`, `replay-*.json`, trazas de Playwright (`trace.zip`, `*.trace.zip`) y estado de storage/auth (`storage-state*.json`, `storageState*.json`, `*auth*state*.json`) — escritos en un path que git no ignora, o donde `git check-ignore` no puede responder (usar `data/` o `reports/`) |
| PostToolUse | `Write\|Edit\|MultiEdit` | nada — corre `validate-generated.js --kind=scenario --no-build` sobre `scenarios/**` y `clients/*/scenarios/**` y devuelve los fallos al agente |

El hook de Bash parsea el comando con `bin/_shell-guard.js` (sin dependencias, así funciona
antes de `pnpm install`) y decide sobre las palabras que bash ejecutaría: se quitan las
comillas, y `sh|bash|zsh -c`, `eval`, `env -S`, `$(...)`, backticks y heredocs que alimentan
una shell también se parsean como comandos. Así se detecta `bash -c "..."` o un `k6" "run`
partido, mientras que un mensaje de commit o un `echo` que solo cita `k6 run` pasa. Una
indirección denegada dice "indirection not allowed; write the command literally".

También sigue lo que un comando delega:

- Scripts de paquete: `pnpm <script>`, `pnpm run`, `npm run`/`npm test`, `yarn <script>`
  se resuelven desde el `package.json` más cercano (hooks pre/post incluidos) y se parsean.
  Un script que no se puede resolver, o una corrida sobre todo el workspace (`-r`,
  `--filter`), se deniega.
- Archivos de script: `bash|sh|zsh archivo`, `source`/`.` y `./archivo.sh` se leen (hasta
  256 KiB, 16 archivos por comando) y se parsean; un archivo inexistente o imposible de
  parsear se deniega. Los runners y las herramientas propias de `bin/` del repo se revisan
  por sus argumentos, sin releerlos.
- `corepack`, `bun run`/`bun <script>` y `bunx` se resuelven como pnpm/npx. Para `make`,
  `just` y `task` se lee el archivo de tareas y la llamada se deniega cuando el archivo
  menciona k6, los runners o los interruptores unsafe/prod-load, o cuando no se puede leer.
- `cd`/`pushd`/`env -C` con un destino literal agregan ese directorio a los usados para
  resolver scripts (el anterior se mantiene, por si el `cd` corre en una subshell o
  falla); un destino imposible de conocer (una variable, `-`, `~usuario`, un glob) hace
  que toda resolución de scripts posterior se deniegue.
- Escribir y ejecutar: una línea que escribe un archivo (`>`, `tee`, `cp`, `mv`,
  `sed -i`, `dd of=`, heredoc a un archivo, ...) y ejecuta ese archivo, un script junto a
  él, o un `package.json`/Makefile que reescribió se deniega, porque el hook lee los
  archivos antes de que la línea corra. `openssl -out`, `sponge`, `split`/`csplit` (su
  prefijo de salida) y `exec N>archivo` cuentan como escritores. Los escritores con
  destino desconocido (`curl -o`, `git checkout`, `awk`, `node -e`, un destino en
  variable, ...) cuentan como que escriben cualquier cosa, salvo frente a los runners y
  las herramientas de `bin/` del repo (nunca se leen), que solo se marcan con una
  escritura en su propio path: `git pull && ./bin/run-test.sh …` está permitido.
- Una asignación de entorno (`VAR=… cmd`, `env VAR=…`, `export VAR=…`) anterior en la
  línea a k6, un runner, un script de paquete o un archivo de script se deniega:
  `PATH=…`, `NODE_OPTIONS=…` o `npm_config_script_shell=…` cambiarían lo que se ejecuta.
  Los nombres inertes están permitidos: `NODE_ENV`, `CI`, `DEBUG`, `TZ`, `LANG`, `LC_*`,
  `FORCE_COLOR`, `NO_COLOR`, `TERM`, `COLUMNS` y `K6_*`, salvo `K6_ALLOW_PROD_LOAD` y los
  `K6_*` que eligen binario, imagen, extensión, CLI de reportes u origen de secretos o
  saltean chequeos (`K6_BINARY*`, `K6_SKIP_*`, ...). Las asignaciones antes de otros
  comandos están permitidas.
- k6, el nombre de un runner o los interruptores unsafe/prod-load dentro de los
  **argumentos** de otro programa se deniegan: `docker run … k6`,
  `kubectl run|exec … -- k6`, `ssh host k6 …`, `vim -c '!k6 …'`,
  `awk 'BEGIN{system("k6 …")}'`, `python3 -c`, `perl -e`, `node -e` y similares. Las
  herramientas de datos quedan exentas (echo, printf, grep, rg, sed, git, gh, cat, ls, jq,
  shellcheck, ...), así los mensajes de commit y los patrones de búsqueda que mencionan
  k6 siguen pasando.
- `watch`, `find -exec`, configuración de git que ejecuta programas (`-c core.pager=…`,
  `alias.*`, `--exec-path=`), variables como `BASH_ENV`/`GIT_PAGER`, nombres de comando
  con caracteres de glob o llaves y `helm --post-renderer` cuentan como indirección.

Los hooks fallan cerrado ante una violación detectada (exit `2`, el motivo vuelve al
agente), ante **cualquier** comando que no pueden parsear ("could not parse command; write
it in a simpler form" — escapes como `$'\x..'` pueden esconder una palabra protegida de
una búsqueda de texto, así que no hay respaldo basado en texto), y cuando falta
`bin/_shell-guard.js`. Las asignaciones de arrays, las definiciones de funciones y
`case … esac` se parsean. Fallan abierto ante sus propios errores internos, así un hook
roto nunca traba una sesión.

El hook es defensa en profundidad de mejor esfuerzo, no un sandbox. Los intérpretes y los
lanzadores remotos o de contenedores solo se detectan cuando el token de k6/runner aparece
literalmente en sus argumentos; los binarios renombrados, los payloads codificados o
calculados dentro del código de un intérprete y los archivos descargados en una llamada
de herramienta y ejecutados en otra no se ven, y un agente decidido con acceso a la shell
puede encontrar otros caminos. El límite
de aplicación es el chequeo de aprobación propio del runner (agregado en un cambio
aparte): el hook existe para atrapar errores y evasiones obvias temprano, con un mensaje
claro.

## Para repos de clientes

- Agregar `allowedHosts`, `maxVUs` y `maxRate` a la config del cliente; el gate y
  `bin/target-guard.js` leen `allowedHosts`.
- Correr el gate sobre todo lo que produjo un agente antes de mergear:
  `node bin/validate-generated.js --kind=scenario clients/<client>/scenarios/api/x.ts --client=<client>`.
- Reportes: `--kind=report --data=<summary.json> --deny-terms=<cliente>,<marca>` mantiene los
  nombres fuera de todo lo que se comparta fuera del equipo.
- Un skill propio del cliente (`clients/<client>/skill/`) se escanea con
  `bin/scan-skills.sh clients/<client>/skill`.
