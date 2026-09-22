---
title: "Target Guard"
sidebar_position: 5
---
# Target Guard

Antes de arrancar k6, `bin/run-test.sh` ejecuta `bin/target-guard.js` sobre la config
resuelta del cliente. Si alguna verificación falla, la corrida se rechaza, se imprimen los
motivos y el script sale con código `107` — k6 nunca se lanza.

El guard **no** se puede saltar con `--skip-validate`.

## Verificaciones

| Verificación | Rechaza cuando | Cómo continuar |
| --- | --- | --- |
| Credenciales embebidas | un `baseUrl` contiene `user:pass@` | mover las credenciales a la config de `auth` o a variables de entorno |
| Lista de hosts permitidos | `allowedHosts` está definido y el hostname de un `baseUrl` no está en la lista (o la URL es inválida) | corregir el `baseUrl` o agregar el hostname a `allowedHosts` |
| Carga contra producción | `--env` matchea `/^prod/i` y `--profile` no es `smoke` ni `quick` (incluye no pasar profile) | definir `K6_ALLOW_PROD_LOAD=true` |

Los mensajes de error solo nombran la clave de config y el hostname, nunca el `baseUrl`
completo — puede llevar un token o credenciales.

## Lista de hosts permitidos

`allowedHosts` es opcional. Si no está, no se verifican hostnames. Si está, cada `baseUrl`
de la config (nivel raíz, `endpoints.*`, `services.*`) debe resolver a un hostname listado:

```json
{
  "client": "my-team",
  "allowedHosts": ["api.staging.example.com", "auth.staging.example.com"],
  "endpoints": {
    "api": { "baseUrl": "https://api.staging.example.com" }
  }
}
```

Un typo que hubiera apuntado un stress de 400 VUs a producción ahora corta la corrida.

## Ejecutarlo por separado

```bash
node bin/target-guard.js --client=my-team --env=production --profile=stress
node bin/target-guard.js --config=clients/my-team/config/production.json --env=production
```

Código `0` = destino permitido, `1` = rechazado.

## Resolución de config

El guard lee el primer archivo que exista:

1. `clients/<client>/config/<env>.json`
2. `clients/<client>/config/default.json`
3. `clients/<client>/config.json`

Solo JSON. Un cliente con config en YAML obtiene la verificación de producción pero no las
de URL.
