---
title: "Failure Triage"
sidebar_position: 4
---
# Failure Triage

Una corrida fallida te dice *que* fallaron requests. Esto te dice **de quien es la culpa**:
del sistema bajo prueba, del test, o del ambiente alrededor. Hasta saber eso, una corrida en
rojo no es un hallazgo — un WAF bloqueando al generador y un servicio saturado se ven igual
en el summary.

`bin/triage-failures.js` lee el `k6-execution-*.log` de la corrida, agrupa sus lineas de
error y warning en firmas redactadas, y le pregunta a [TypeSafe](https://typesafe.ai)
(System One) la causa mas probable de cada una en una sola request batcheada.

No es el [Analyst Agent](./agents.md): ese correlaciona `summary.json` con Prometheus, Loki
y Tempo para explicar *por que* el sistema se comporto como lo hizo. El triage trabaja sobre
el log del propio generador, no necesita stack de observabilidad, y responde una pregunta
mas acotada.

## Como habilitarlo

Opt-in por partida doble — esta apagado salvo que ambos esten seteados:

```bash
export TYPESAFE_API_KEY=...   # sin key, no hay llamada
K6_TRIAGE=true ./bin/run-test.sh --client=my-team --scenario=api/checkout --profile=load
```

El resultado se imprime y se escribe en `triage-<timestamp>.txt` junto a los demas
artefactos. El triage nunca cambia el exit code — el gating sigue siendo de
`bin/slo-report.js`.

Correrlo aparte contra cualquier log de ejecucion:

```bash
TYPESAFE_API_KEY=... node bin/triage-failures.js reports/my-team/api_checkout/k6-execution-20260921-120000.log
```

## Causas y duenos

El modelo elige la causa; **el dueno es politica fija en codigo**, no algo que decida el
modelo:

| Causa | Dueno | Firma tipica |
| --- | --- | --- |
| `waf_block` | environment | 403 del edge, HTML "Access Denied" |
| `network` | environment | falla de DNS, conexion rechazada/reseteada, error TLS |
| `auth` | test | 401, token vencido o ausente |
| `test_data` | test | 400/404/422 atado a un registro o payload puntual |
| `script_bug` | test | excepcion del propio escenario |
| `saturation` | sut | timeouts, 429, 502/503/504, resets de stream |
| `server_error` | sut | 5xx o stack trace que no es problema de capacidad |
| `other` | unknown | no encaja nada, o la linea no es una falla |

Las respuestas por debajo de `confidence >= 0.5` quedan en `unknown` y marcadas `(review)`
en vez de contarse. Cuando mas de la mitad de las fallas cae en *test* o *environment*, el
reporte lo dice sin vueltas: arregla eso antes de confiar en los numeros.

## Que sale de la maquina

Solo firmas redactadas, nunca el log crudo. Antes de armar la request, `normalize()`
reemplaza JWTs, URLs, hostnames, IPs, emails, timestamps, query strings e ids
alfanumericos, colapsa las partes variables para que fallas identicas agrupen, y trunca cada
mensaje a 400 caracteres. Se mandan como maximo 25 firmas, en una sola request.

Agrega nombres de cliente o servicio con `TRIAGE_REDACT=acme,acme-orders` — terminos
literales, aplicados despues de las reglas por patron.

## Perillas

| Variable | Default | Para que |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | — | Requerida. Sin ella el script sale sin llamar a nada. |
| `TYPESAFE_MODEL` | `jev-latest` | Id del modelo. |
| `TRIAGE_REDACT` | — | Terminos literales extra a ocultar, separados por coma. |
| `K6_TRIAGE` | `false` | Si `run-test.sh` corre el triage despues del test. |

El parseo, la redaccion y la politica de duenos estan cubiertos offline, sin red:

```bash
npx vitest run test/bin/triage-failures.test.ts
```
