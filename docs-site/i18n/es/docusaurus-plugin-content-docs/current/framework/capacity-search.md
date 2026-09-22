---
title: "Capacity Search"
sidebar_position: 6
---
# Capacity Search

Un load profile te dice si el sistema sobrevive a una tasa que elegiste vos. Una busqueda de
capacidad encuentra la tasa: el arrival rate mas alto que el target sostiene antes de
romperse.

`bin/find-capacity.js` corre un escenario repetidas veces a tasas fijas y va cerrando el
cerco:

1. **Ramp** — arranca en `--start-rps` y duplica hasta que una tasa falla (o hasta `--max-rps`).
2. **Binary** — bisecta entre la ultima que paso y la primera que fallo hasta que la brecha
   sea `--resolution-rps` o menor.
3. **Confirm** — repite la tasa ganadora `--confirm-runs` veces. Si la confirmacion falla,
   baja un escalon de resolucion y vuelve a confirmar. Un numero que aguanto una sola vez no
   es una capacidad.

Cada paso es una ejecucion normal de `run-test.sh`, asi que gates, artefactos y reportes
funcionan igual. El bundle se compila una sola vez, en el primer paso.

```bash
node bin/find-capacity.js \
  --client=my-team --scenario=api/checkout \
  --start-rps=10 --max-rps=400 --step-duration=60 --resolution-rps=5
```

## Requisito: el escenario tiene que tomar sus options del profile

La busqueda override la tasa a traves del profile, asi que el escenario tiene que construir
sus options desde ahi:

```ts
import { buildOptions } from "@core/config-loader";
export const options = buildOptions();
```

Un escenario con `export const options = { vus: 5, duration: "20s" }` hardcodeado corre la
misma carga en todos los pasos, y la "capacidad" reportada seria simplemente el ultimo paso
que casualmente paso. `find-capacity.js` revisa el fuente antes de arrancar y se niega, en
vez de entregarte un numero falso.

## Cuando un paso cuenta como fallado

Un paso falla si se cumple cualquiera de estas — las mismas reglas que aplicaria una persona:

- se cruzo un threshold (la corrida salio con 99),
- el generador descarto iteraciones, o sea que ni siquiera pudo emitir la carga pedida,
- la tasa lograda quedo por debajo de `--min-achieved-ratio` (95% por defecto) de la pedida.

Esta ultima importa: una corrida donde k6 pidio 200/s y solo logro 140/s no es un 200/s que
pasa, por mas linda que se vea la latencia.

Cualquier otra cosa — script roto, config mala, target que no esta — aborta la busqueda con
exit 2 en vez de registrarse como limite de capacidad.

## Seguridad

Una busqueda de capacidad empuja al target hasta romperlo, asi que un `baseUrl` no local se
rechaza:

```
[capacity] Refusing to run: target api.staging.example.com is not local.
  A capacity search pushes the target until it fails. Pass --i-own-this-target if you may do that.
```

Los hosts salen de la misma config de cliente que revisa el [Target Guard](./security/target-guard.md).
`--i-own-this-target` es el override explicito.

Entre pasos la busqueda espera `--cooldown` segundos, o consulta `--health-url` hasta que
responda 2xx — medir un target que no se recupero del paso anterior te da el tiempo de
recuperacion, no la capacidad.

## Opciones

| Flag | Default | Significado |
| --- | --- | --- |
| `--client`, `--scenario` | — | Requeridos, mismos valores que `run-test.sh`. |
| `--env` | `default` | Ambiente cuya config se lee. |
| `--profile` | `throughput-medium` | Profile arrival-rate cuyos thresholds aplican. |
| `--start-rps` | `10` | Primera tasa probada. |
| `--max-rps` | `1000` | Cota superior de la busqueda. |
| `--resolution-rps` | `5` | Dejar de bisectar cuando la brecha sea asi de chica. |
| `--step-duration` | `30` | Segundos por paso. |
| `--confirm-runs` | `2` | Corridas OK exigidas en la tasa ganadora. |
| `--retries` | `1` | Intentos extra antes de dar una tasa por fallada. |
| `--cooldown` | `10` | Segundos entre pasos (se ignora con `--health-url`). |
| `--health-url` | — | Consultar hasta 2xx en vez de dormir. |
| `--health-timeout` | `120` | Dejar de esperar tras estos segundos. |
| `--min-achieved-ratio` | `0.95` | Fraccion de la tasa pedida que hay que lograr. |
| `--i-own-this-target` | off | Permite un target no local. |

El override de tasa llega a k6 por `K6_ARRIVAL_RATE` y `K6_STEP_DURATION`, que reemplazan
`rate` y `duration` de cualquier profile arrival-rate y suben su pool de VUs en consecuencia.
Fuera de una busqueda de capacidad no estan seteadas y los profiles se comportan tal cual
estan declarados.

## Salida

Cada paso se imprime al terminar, despues una tabla y el veredicto:

```
Highest sustainable: 135 rps (confirmed: true)
First failing:       140 rps
Result written to:   reports/my-team/api_checkout/capacity-result.json
```

Exit `0` = se encontro una tasa sostenible, `1` = no paso ninguna (ni `--start-rps`),
`2` = error de uso o busqueda abortada.
