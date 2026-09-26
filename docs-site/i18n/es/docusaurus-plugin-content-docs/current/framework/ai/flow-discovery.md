---
title: "Flow Discovery"
sidebar_position: 5
---
# Descubrimiento de Flujos

Escribir un script k6 para un flujo web empieza por saber qué requests hace el flujo, en qué
orden, y qué valores entrega el servidor que el siguiente request debe devolver.
`bin/discover-flow.js` lo averigua por vos: maneja un navegador real (Playwright) hacia un
objetivo escrito en lenguaje natural, deja que un decisor de IA elija cada paso, graba un HAR
y escribe un plan para el script k6 — secuencia de endpoints y **candidatos a correlación**.

Es una herramienta Node que corre antes de escribir el test, nunca dentro del runtime de k6.

## Inicio rápido

```bash
pnpm exec playwright install chromium        # una vez
export ANTHROPIC_API_KEY=...                 # o TYPESAFE_API_KEY con --decider=jev

node bin/discover-flow.js \
  --url=https://staging.example.com \
  --goal="search for a product and open its detail page" \
  --data=data/discovery.json \
  --stop-at=/checkout \
  --out=reports/discovery/product-detail
```

`data/discovery.json` contiene los valores de prueba **con nombre** que el agente puede tipear:

```json
{ "query": "blue shirt", "email": "qa.user@example.com" }
```

El agente solo tipea un valor de este archivo, o relleno claramente sintético que declara
como `synthetic:<descripción>` (p. ej. `synthetic:city name` se convierte en `test`). El
modelo ve las claves (`query`, `email`), nunca los valores.

## Cómo funciona un paso

1. **Observar** — URL, título y hasta 120 elementos interactivos visibles (rol, nombre
   accesible, índice; valores de formulario enmascarados como `{{clave}}` o `<n chars>`).
   No entra a iframes ni shadow roots, pero informa cuántos hay para que el decisor sepa que
   falta contenido.
2. **Filtrar** — los elementos que coinciden con `--deny-text` se quitan antes de que el
   decisor los vea.
3. **Redactar** — los valores de `--data` pasan a `{{clave}}`; emails, JWTs, tokens opacos y
   secuencias de 4+ dígitos se reemplazan. Cookies y headers nunca forman parte de la observación.
4. **Decidir** — el decisor responde `click | fill | select | check | navigate_done | stop`,
   un índice de candidato, una clave de valor y una justificación.
5. **Proteger** — un índice inválido, una clave desconocida o una confianza bajo
   `--min-confidence` detienen la corrida para que decida una persona. Los campos password
   solo se llenan con la clave `password`.
6. **Actuar y esperar** — vía `getByRole(role, { name })` (con un atributo marcador como
   respaldo), y luego espera a que no haya requests en vuelo durante 500 ms.
7. **Registrar** — acción, locator, clave de valor, URL antes/después, duración y cantidad de
   requests, con una línea de log por paso.

La corrida termina cuando el decisor informa el objetivo cumplido, se alcanza una URL de
`--stop-at` (se registra y no se toca nada en ella), o salta una salvaguarda.

## Decisores

Ambos reciben la **misma** observación redactada.

| Decisor | Env | Cómo decide |
| --- | --- | --- |
| `claude` (default) | `ANTHROPIC_API_KEY`, `DISCOVERY_MODEL` (default `claude-sonnet-5`) | Una llamada a la Messages API por paso con salida JSON-schema (acción, índice, clave, justificación, confianza). |
| `jev` | `TYPESAFE_API_KEY`, `TYPESAFE_MODEL` (default `jev-latest`) | Un request a TypeSafe System One por paso con tres preguntas `choice`: estado (continuar / objetivo cumplido / detener), elemento (criteria = descripciones de candidatos) y clave de valor. La acción se deriva del rol del elemento; la confianza es la menor de las respuestas usadas. |

Los tests inyectan un decisor guionado; no hace falta ninguna key para correrlos.

## Opciones

| Flag | Default | Propósito |
| --- | --- | --- |
| `--url` | — | URL inicial. Su host siempre está permitido. |
| `--goal` | — | Qué debe lograr el flujo. |
| `--decider` | `claude` | `claude` o `jev`. |
| `--data` | — | Objeto JSON de valores de prueba con nombre. |
| `--max-steps` | `30` | Máximo de acciones. |
| `--allow-hosts` | — | Hosts extra a los que puede navegar el frame principal; cualquier otro se aborta y detiene la corrida. |
| `--block-hosts` | — | Hosts (comodines `*.x.com`) cuyos requests se abortan, en todas las páginas del contexto. |
| `--stop-at` | — | Regex repetible; cuando la URL coincide, registra y se detiene. |
| `--deny-text` | pay, buy, purchase, checkout, confirm/place order, delete, … | Elementos cuyo nombre o texto coincide nunca se ofrecen. |
| `--min-confidence` | `0.5` | Por debajo, la corrida se detiene para una persona. |
| `--max-tokens` | `200000` | Presupuesto de tokens del decisor (Jev: estimado por tamaño del request). |
| `--user-agent`, `--storage-state` | — | Identidad del navegador / sesión iniciada. |
| `--no-headless` | headless | Muestra el navegador. |
| `--out` | `reports/discovery/<datetime>` | Directorio de salida. |
| `--dry-run` | off | Carga la página y planifica sin hacer click ni tipear. |
| `--trace` | off | Además escribe un `trace.zip` de Playwright. |
| `--k6` | off | Ejecuta `har-to-k6` si está instalado (no es dependencia). |

## Salidas

| Archivo | Contenido |
| --- | --- |
| `flow.har` | Tráfico crudo con bodies embebidos (lo que consumen k6 Studio y `har-to-k6`). **Sensible.** |
| `flow.json` | Objetivo, decisor, pasos, motivo de detención, hosts vistos, endpoints first-party (método + plantilla de path), correlaciones y un bloque `guardrails`. Se valida contra [`shared/schemas/discovery-flow.schema.json`](https://github.com/jwcastillo/k6-enterprise-framework/blob/main/shared/schemas/discovery-flow.schema.json) antes de escribirse. |
| `flow.md` | Resumen legible de la corrida. |
| `flow-plan.md` | Secuencia de endpoints, candidatos a correlación con la extracción k6 (`res.json("session.token")`), próximos pasos. |

Antes de escribir, `flow.json`, `flow.md` y `flow-plan.md` pasan un chequeo que falla
cerrado: sin JWTs, cookies, valores de `Authorization`, emails ni secuencias de 7+ dígitos.
Un hallazgo aborta sin escribirlos. Todos los archivos se crean `0600`.

### Candidatos a correlación

Determinístico, sin IA: un valor (hoja JSON o input hidden, 6+ caracteres) que **aparece
primero en una respuesta** y luego se envía en la URL, body o header de un request es un
candidato a correlación. Se excluyen los valores que el cliente envió primero (lo tipeado) y
las cookies (las maneja el cookie jar de k6). Solo se informan el origen, el selector, los
destinos y el largo del valor — nunca el valor.

### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Objetivo cumplido, `--stop-at` alcanzado, o dry run completo. |
| `3` | Detenido por una salvaguarda: salió del allowlist, presupuesto, baja confianza, loop, máximo de pasos, detención del decisor, decisión inválida. |
| `1` | Error (input inválido, dependencia o key faltante, falla del schema o del chequeo de PII). |

## Del HAR a k6

1. Leé `flow-plan.md`.
2. **Grafana k6 Studio:** File → Import HAR (`flow.har`) → Generator → activá
   Autocorrelation, y compará sus reglas con la tabla de correlaciones.
3. O `--k6` / `npx har-to-k6 flow.har -o flow-k6.js`, y luego reemplazá los tokens grabados
   por las extracciones del plan y mové los valores tipeados a un archivo de datos.

## En un repo standalone de cliente

Exportá con la herramienta:

```bash
./bin/export-client.sh --client=my-team --output=../my-team-k6 --with-discovery
```

Luego, en el repo exportado:

```bash
npm i -D playwright @anthropic-ai/sdk && npx playwright install chromium
ANTHROPIC_API_KEY=... node framework/bin/discover-flow.js --url=... --goal="..." --stop-at=/checkout
```

`ajv` y `ajv-formats` ya son dependencias de desarrollo de los repos exportados.

## Limitaciones

- Una sola pestaña: no sigue popups ni ventanas nuevas.
- Iframes y shadow DOM se informan pero no se recorren.
- Los nombres accesibles son aproximados; cuando `getByRole` no resuelve al elemento
  observado se usa un atributo marcador y el paso lo indica.
- Un dry run no ve el efecto de sus propias acciones, así que planifica solo desde la página inicial.
- El uso de tokens de Jev es estimado (TypeSafe no lo informa).

Las partes puras (filtrado, redacción, correlación, mapeo de decisores) y una corrida punta a
punta contra un sitio fixture local con un decisor guionado se prueban sin red:

```bash
npx vitest run test/bin/discover-flow.test.ts test/bin/discover-flow.e2e.test.ts
```
