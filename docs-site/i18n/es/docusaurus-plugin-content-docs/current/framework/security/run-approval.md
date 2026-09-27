---
title: "Aprobación de corridas y k6 confiable"
sidebar_position: 7
---
# Aprobación de corridas y k6 confiable

Las corridas pesadas, inseguras o de producción solo arrancan con la aprobación de una
persona, y los runners nunca buscan k6 en el `PATH` de quien los llama. Ambas verificaciones
viven en los runners (`bin/run-test.sh`, `bin/run-distributed.sh` y el `bin/run-test.sh`
standalone que genera un export), así que un truco de línea de comandos que pase el hook de
Claude Code igual se detiene en el runner. El hook queda como defensa en profundidad (ver
[Guardrails de IA](./guardrails.md)).

## Corridas protegidas

Una corrida está **protegida** cuando se cumple cualquiera de estas condiciones:

| Condición | Valor por defecto |
| --- | --- |
| Se desbloquea un gate de escenario (`export const gate = "unsafe"\|"experimental"\|"quarantined"` más su flag). Los runners standalone y distribuido no tienen flags de desbloqueo: cualquier escenario con gate está protegido. | — |
| `K6_ALLOW_PROD_LOAD=true` | — |
| `--env` no está en `nonProdEnvs` (sin distinguir mayúsculas) | `default local dev development test testing qa ci sandbox staging stage uat` |
| `--profile` está en `heavyProfiles` | `stress spike breakpoint soak capacity throughput-high throughput-ramp` |

Smoke, quick y load sobre un entorno no productivo siguen sin fricción: no piden aprobación.

Las listas son por cliente, en su config (`clients/<cliente>/config/default.json`, si no
`clients/<cliente>/config.json`; `config/default.json` en un repo standalone). Una lista
reemplaza su valor por defecto:

```json
{
  "nonProdEnvs": ["default", "dev", "staging", "perf-lab"],
  "heavyProfiles": ["stress", "spike", "breakpoint", "soak", "capacity"],
  "trustedBinDirs": ["~/.local/bin"]
}
```

La aprobación es un requisito adicional, nunca un sustituto: los flags de gate (exit `108`
sin ellos), `K6_ALLOW_PROD_LOAD` para carga en producción en el target guard, RBAC y
`K6_AGENT_ALLOW_UNSAFE` en el hook siguen aplicando.

## Aprobar una corrida (solo personas)

```bash
./bin/approve-run.sh --scenario=<bucket/ruta> --profile=<p> --env=<e> \
  [--client=<c>] [--ttl=4h] [--reason="..."]
```

- Se niega sin una terminal interactiva en stdin y stdout (exit `2`).
- Muestra exactamente qué aprueba (cliente, escenario, perfil, entorno, gate, motivo,
  usuario, vencimiento) y pide escribir un código aleatorio de 6 caracteres, leído de
  `/dev/tty`.
- Escribe un registro fuera del repositorio, en
  `${XDG_STATE_HOME:-$HOME/.local/state}/k6-framework/approvals/` (directorio `0700`,
  archivos `0600`): `{id, client, scenario, profile, env, gates, user, host, created,
  expires, reason, nonce}` más un HMAC-SHA256 sobre esos campos, con una clave por usuario
  en el mismo directorio (`.secret`, creado `0600` en el primer uso).
- `--ttl` va de `1m` a `24h` (por defecto `4h`). `--client` es `_reference` por defecto; un
  repo standalone usa el nombre de su directorio, igual que su runner.

Los runners nunca leen datos de aprobación de variables de entorno ni de sus propios flags.

## Qué hace el runner

1. Clasifica la corrida. Si está protegida, y antes de compilar, busca una aprobación que
   coincida (cliente, escenario, perfil y entorno exactos), vigente, sin consumir, con HMAC
   válido, del usuario actual y sin escritura para grupo u otros (el secreto tampoco puede
   ser legible por grupo u otros). Un almacén dentro del repositorio se rechaza.
2. Sin aprobación sale con **`109`** e imprime el comando `approve-run.sh` para que lo
   ejecute una persona.
3. Justo antes de arrancar k6 consume la aprobación (rename atómico a
   `approvals/consumed/`, un solo uso), escribe `approval-<ISO>.json` junto al resto de
   artefactos y guarda `approvalId` en el summary JSON (`distributedExecution.approvalId`
   en corridas distribuidas).
4. `--dry-run` no necesita aprobación; muestra si hace falta y por qué.

CI: sin terminal no se pueden crear aprobaciones, así que una corrida protegida en CI sale
con `109` (falla cerrado). Ejecuta las corridas protegidas desde la máquina de un operador,
o limita CI a smoke/quick sobre entornos no productivos.

## Resolución confiable de k6

- El runner busca en `trustedBinDirs` (en orden) y luego en
  `/usr/local/bin /usr/bin /bin /opt/homebrew/bin`. Un `~/` inicial es el home de la cuenta
  según la base de usuarios, no `$HOME`. Los directorios con escritura para grupo u otros, o
  cuyo dueño no es root ni tú, se ignoran con un aviso.
- Resuelve `k6` a una ruta absoluta, verifica que el archivo y su directorio no tengan
  escritura para grupo u otros y sean de root o tuyos, y ejecuta esa ruta.
- `K6_BINARY_PATH` sigue funcionando si apunta a un directorio confiable (o `/opt/k6`, o
  `dist/binaries` en el monorepo). **`K6_BINARY_ALLOWED_PATHS` ya no se lee**: una variable
  de entorno no debe ampliar lo que es confiable. Declara los directorios extra en
  `trustedBinDirs`.
- CI: las actions que dejan k6 en un directorio temporal y lo agregan al `PATH` (por
  ejemplo `grafana/setup-k6-action`) necesitan un paso más, `sudo install -m 0755
  "$(command -v k6)" /usr/local/bin/k6`; instalar k6 con apt ya lo deja en `/usr/bin`. Con
  `CI=true` las verificaciones de dueño y permisos solo avisan, porque los runners hospedados
  son VMs de un solo usuario con directorios de herramientas escribibles por todos; la lista
  de directorios permitidos sigue aplicando.
- k6 corre sin `NODE_OPTIONS`, `BASH_ENV`, `ENV`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
  `DYLD_INSERT_LIBRARIES` ni `DYLD_LIBRARY_PATH` en su entorno.
- El node que verifica aprobaciones se resuelve igual. Si tu node vive en otro lado (asdf,
  nvm), agrega ese directorio a `trustedBinDirs`; si no, las corridas protegidas salen con
  `107`. El node del post-procesamiento (reportes) sigue saliendo del `PATH`.

## Códigos de salida

| Código | Significado |
| --- | --- |
| `108` | Escenario con gate sin su flag de desbloqueo |
| `109` | Corrida protegida sin una aprobación humana válida |

## Modelo de amenazas

Detiene:

- Que un agente de IA (o un script que escriba) arranque por su cuenta una corrida pesada,
  insegura o de producción: la herramienta Bash de Claude Code no tiene terminal, así que no
  puede crear una aprobación con `approve-run.sh`, y el runner se niega sin ella.
- Reusar una aprobación (un solo uso), estirarla a otro escenario, perfil, entorno o
  cliente (coincidencia exacta, HMAC) o editar un registro (HMAC).
- El secuestro del `PATH`: nunca se ejecuta un `k6` que aparezca antes en el `PATH`.

No detiene:

- Que una persona apruebe lo equivocado. Lee el resumen antes de escribir el código.
- A root, ni a un proceso que corra con tu usuario y falsifique un registro a propósito
  (puede leer el secreto) o maneje una pseudo-terminal. Para agentes, combínalo con el
  sandbox de Claude Code (escritura limitada al proyecto) y deja el directorio de
  aprobaciones fuera de su alcance. El hook del repo y el guard del equipo de agentes ya
  niegan que un agente ejecute `approve-run.sh` / `_run-approval.js`; no ven una copia
  renombrada o enlazada en otro lugar, por eso la verificación de terminal y el HMAC siguen
  siendo la frontera real.
