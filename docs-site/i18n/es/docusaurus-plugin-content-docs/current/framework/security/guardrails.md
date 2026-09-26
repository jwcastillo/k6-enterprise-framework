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
  [--client=<name>|--config=<client config json>] [--format=text|json] [--strict]
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

## Hooks de Claude Code

`.claude/settings.json` conecta `.claude/hooks/guardrails.js`:

| Hook | Matcher | Bloquea |
| --- | --- | --- |
| PreToolUse | `Bash` | `k6 run` / `k6 cloud` directos — usar `./bin/run-test.sh`, que aplica target-guard, gates de escenario y reportes |
| PreToolUse | `Bash` | `--unsafe` o `K6_ALLOW_PROD_LOAD=true`, salvo que el humano haya iniciado Claude Code con `K6_AGENT_ALLOW_UNSAFE=1` exportado en su propia shell |
| PreToolUse | `Write\|Edit\|MultiEdit` | `*.har` y `replay-*.json` escritos en un path que git no ignora (usar `data/` o `reports/`) |
| PostToolUse | `Write\|Edit\|MultiEdit` | nada — corre `validate-generated.js --kind=scenario --no-build` sobre `scenarios/**` y `clients/*/scenarios/**` y devuelve los fallos al agente |

Los hooks fallan cerrado ante una violación detectada (exit `2`, el motivo vuelve al agente)
y fallan abierto ante sus propios errores, así un hook roto nunca traba una sesión. Matchean
el texto del comando, así que un mensaje que solo cita `k6 run` también se bloquea — reformularlo.

## Para repos de clientes

- Agregar `allowedHosts`, `maxVUs` y `maxRate` a la config del cliente; el gate y
  `bin/target-guard.js` leen `allowedHosts`.
- Correr el gate sobre todo lo que produjo un agente antes de mergear:
  `node bin/validate-generated.js --kind=scenario clients/<client>/scenarios/api/x.ts --client=<client>`.
- Reportes: `--kind=report --data=<summary.json> --deny-terms=<cliente>,<marca>` mantiene los
  nombres fuera de todo lo que se comparta fuera del equipo.
- Un skill propio del cliente (`clients/<client>/skill/`) se escanea con
  `bin/scan-skills.sh clients/<client>/skill`.
