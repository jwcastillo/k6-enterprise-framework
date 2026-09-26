---
id: agent-team
title: Equipo de agentes para Claude Code
sidebar_position: 2
---

# Equipo de agentes para Claude Code

El repositorio incluye un equipo de ingeniería de performance para
[Claude Code](https://code.claude.com/docs): nueve subagentes en `.claude/agents/`, una
skill orquestadora (`perf-team`) y un conjunto de skills especialistas en
`.claude/skills/`. El equipo lleva un recorrido de usuario o un servicio desde el
descubrimiento hasta el informe, respetando las compuertas de seguridad del framework.

Es independiente de los [agentes de IA en tiempo de ejecución](./agents.md) de `src/ai`
(Planner, Builder, Analyst, Reporter). El arquitecto de pruebas puede usar el planner
como generador de borradores cuando hay una clave de LLM configurada.

## Pipeline

```
 alcance humano ──► perf-flow-discoverer ──► perf-test-architect ──► perf-scenario-author
                     (discover-flow.js,        (test-plan.md)          + perf-browser-engineer
                      Playwright, HAR)                                 (scenarios/<bucket>/)
                                                                             │
                                                                             ▼
 perf-reporter ◄── perf-results-analyst ◄── perf-load-operator ◄── perf-guardrail-reviewer
 (report/)         (analysis.md)            smoke ─► [sí humano] ─► carga (validate-generated,
                                            (solo bin/run-test.sh)          secretos, SkillSpector)

 perf-framework-maintainer: cambios en src/, bin/, export y docs (en cualquier momento, vía PR)
```

Los artefactos de traspaso viven en `reports/` (ignorado por git):
`reports/discovery/<flow>/` y `reports/perf-team/<work-id>/` (`test-plan.md`,
`analysis.md`, `report/`). Solo se versionan escenarios, librerías del cliente y datos
sintéticos.

## Compuertas

1. **Alcance** — el descubrimiento y las corridas nombran el target, el entorno y los
   hosts permitidos; la persona confirma. El alcance de producción se confirma
   explícitamente cada vez.
2. **Compuerta de generación** — `node bin/validate-generated.js --kind=<scenario|testplan|flow|patch|report>`
   debe pasar y el revisor debe devolver PASS antes de versionar o ejecutar un
   escenario. Si el validador no está disponible, el revisor informa `NOT RUN` y decide
   la persona.
3. **Smoke antes de carga** — el mismo escenario debe salir con `0` usando
   `--profile=smoke` primero.
4. **Confirmación humana para carga** — cada corrida no-smoke, `--unsafe`, contra
   producción, distribuida o de búsqueda de capacidad necesita un "sí" explícito para
   esa corrida.
5. **Números deterministas** — análisis e informes usan solo números de los artefactos
   de la corrida y de herramientas deterministas (compare, trend, SLO report, análisis
   generado).

El revisor, el operador y el descubridor llevan un hook `PreToolUse`
(`bin/agent-bash-guard.js`): el revisor solo puede ejecutar validadores, escáneres,
typecheck/lint/test y git de solo lectura; el operador nunca puede invocar `k6 run` /
`k6 cloud` directamente ni definir `K6_ALLOW_PROD_LOAD`, y los comandos pesados,
riesgosos (unsafe), de producción o de cambios en el cluster siempre piden confirmación; cada
descubrimiento pide confirmar el alcance.

## Agentes

| Agente | Herramientas | Skills precargadas |
|--------|--------------|--------------------|
| `perf-flow-discoverer` | Read, Grep, Glob, Bash (con guard) | flow-discovery, playwright-automation, har-to-k6, jev-typesafe, test-data-management, guardrails-gate |
| `perf-test-architect` | Read, Grep, Glob, Write (solo el plan), Bash | k6-scenario-authoring, run-operations, test-data-management, chaos-resilience, har-to-k6, guardrails-gate |
| `perf-scenario-author` | Read, Grep, Glob, Edit, Write, Bash | k6-scenario-authoring, test-data-management, chaos-resilience, guardrails-gate, k6 |
| `perf-browser-engineer` | Read, Grep, Glob, Edit, Write, Bash | playwright-automation, k6-browser, har-to-k6, k6-scenario-authoring, guardrails-gate |
| `perf-guardrail-reviewer` | Read, Grep, Glob, Bash (lista blanca) | guardrails-gate, security-scanning, k6-scenario-authoring, ci-quality-gates |
| `perf-load-operator` | Read, Grep, Glob, Bash (con guard) | run-operations, k6-distributed-runs, observability-setup, chaos-resilience |
| `perf-results-analyst` | Read, Grep, Glob, Write, Bash | results-analysis, jev-typesafe, observability-setup, promql |
| `perf-reporter` | Read, Grep, Glob, Write, Edit, Bash | reporting-toolkit, performance-report, results-analysis, guardrails-gate |
| `perf-framework-maintainer` | Read, Grep, Glob, Edit, Write, Bash | framework-development, client-export, ci-quality-gates, framework-mcp-server, guardrails-gate, security-scanning |

## Skills

| Skill | Cubre |
|-------|-------|
| `perf-team` | Orquestación: pipeline, responsables, traspasos, compuertas, RACI |
| `k6-scenario-authoring` | Buckets, alias, imports solo goja, patrones, thresholds, tags, marcas de gate |
| `flow-discovery` | Uso controlado de `discover-flow.js`, alcance, salidas, traspaso |
| `guardrails-gate` | Tipos de `validate-generated`, fallas comunes, escaneo de secretos |
| `run-operations` | Flags del runner, perfiles, gates, códigos de salida 0/1/99/107/108, aborto, búsqueda de capacidad |
| `results-analysis` | Mapa de artefactos, compare/trend/SLO, regla determinista primero, triage |
| `k6-distributed-runs` | Chart Helm de k6-operator, paralelismo, testid, datos por Secret o init container |
| `test-data-management` | SharedArray/DataPool, unicidad entre VUs y pods, generación, Redis, datos personales |
| `observability-setup` | Stack local, salidas del runner, histogramas nativos, trazas, dashboards |
| `ci-quality-gates` | Plantillas de CI, gates por código de salida, JUnit, regresiones, pasos de seguridad |
| `client-export` | `export-client.sh`, estructura standalone, `update-framework.sh` |
| `chaos-resilience` | Bucket chaos, patrón chaos-injection, métricas de continuidad, aprobaciones |
| `playwright-automation` | Playwright para captura (no carga), modos HAR, sesión guardada, ruteo, Test Agents, MCP |
| `k6-browser` | Módulo browser de k6, Web Vitals, patrón sonda, imagen `-with-browser` |
| `jev-typesafe` | Decisiones tipadas con TypeSafe Jev, triage, decisor de descubrimiento, redacción |
| `har-to-k6` | Captura de HAR, sanitización, conversión (k6 Studio, har-to-k6), mapeo a convenciones |
| `security-scanning` | SkillSpector (versión fija), baselines, SARIF, escaneo de secretos |
| `framework-development` | Cambios controlados en `src/` y `bin/`, tests, docs EN/ES, commits |
| `framework-mcp-server` | Herramientas del servidor MCP del framework y sus reglas |
| `reporting-toolkit` | Qué herramienta por entregable: performance-report, archify, docx/pdf/pptx/xlsx |

Las skills existentes (`k6`, `k6-docs`, `k6-performance-tester`,
`performance-engineering`, `performance-report`, `promql`, `dashboarding`,
`opentelemetry`) se reutilizan sin cambios.

### Herramientas opcionales de reporte

- **archify** (diagramas) está fijada en `skills-lock.json` (tag `v2.16.0`) pero no se
  versiona en el repo. Se instala a demanda con `npx skills@1.7.0 experimental_install`
  y se escanea con SkillSpector antes de usarla; la carpeta instalada está ignorada por
  git.
- **Document skills** (docx, pdf, pptx, xlsx) tienen licencia propietaria y se habilitan
  como el plugin `document-skills@anthropic-agent-skills` del marketplace
  `anthropics/skills`, declarado por un mantenedor en la configuración del proyecto
  (`extraKnownMarketplaces` + `enabledPlugins`). Ver la skill `reporting-toolkit`.

## Cómo usarlo

```text
# Pipeline completo
Use the perf-team skill to take the orders API from plan to report on staging;
work-id orders-api-load.

# Un paso
Ask perf-load-operator to run the smoke for api/orders.
@perf-results-analyst analyze the last run of api/orders
```

`/agents` lista el equipo. En un export standalone creado con
`./bin/export-client.sh --with-claude` se copian los agentes, las skills del repo y el
guard de Bash; el runner standalone no tiene flag `--client` ni aplica los gates de
escenarios, por lo que los agentes revisan `export const gate` por su cuenta.

## Verificación

- `pnpm test` ejecuta `test/claude/agent-team.test.ts`: cada agente y skill se parsea,
  las skills referenciadas existen, el revisor no tiene herramientas de edición y las
  decisiones del guard de Bash se cumplen.
- `skillspector scan .claude/agents --recursive --no-llm` y
  `skillspector scan .claude/skills/<name> --no-llm` reportan SAFE para los archivos del
  equipo.
