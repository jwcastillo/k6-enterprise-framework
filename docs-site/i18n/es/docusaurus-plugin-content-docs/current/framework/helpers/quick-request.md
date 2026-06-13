---
title: "Quick Request — Escenario HTTP generico"
sidebar_position: 1
---
> **Español** | [English](/docs/framework/helpers/quick-request)

# Quick Request — Escenario HTTP generico

Ejecuta cualquier request HTTP directamente desde variables de entorno sin crear un service client ni un escenario dedicado. Ideal para pipelines CI/CD, validaciones rapidas y pruebas ad-hoc.

**Escenario:** `clients/_reference/scenarios/api/quick-request.ts`
**Compilado:** `dist/reference/api/quick-request.js`

---

## Inicio rapido

```bash
# GET simple
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/health

# POST con body inline
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY='{"orderId":"TEST-001","orderName":"Test"}'

# POST desde archivo JSONL (un request por linea)
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/ruta/absoluta/orders.jsonl

# Via run-test.sh (pipeline completo con reportes)
./bin/run-test.sh --client=_reference --scenario=api/quick-request --profile=smoke \
  -e REQUEST_URL=http://api.example.com/api/health \
  -e REQUEST_EXPECTED_STATUS=200
```

---

## Variables de entorno

| Variable | Requerida | Default | Descripcion |
|----------|-----------|---------|-------------|
| `REQUEST_URL` | Si | — | URL completa con path (ej: `http://host:port/api/v1/orders`) |
| `REQUEST_METHOD` | No | `GET` | Metodo HTTP: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `REQUEST_BODY` | No | — | JSON string para body de POST/PUT/PATCH |
| `REQUEST_BODY_FILE` | No | — | Ruta absoluta a archivo `.json` o `.jsonl` (k6 `open()`) |
| `REQUEST_HEADERS` | No | `{}` | JSON string de headers extra: `'{"X-Api-Key":"abc"}'` |
| `REQUEST_AUTH_TYPE` | No | `none` | Tipo de auth: `none`, `bearer`, `basic`, `api-key` |
| `REQUEST_AUTH_TOKEN` | No | — | Token para auth `bearer` o `api-key` |
| `REQUEST_AUTH_USER` | No | — | Usuario para auth `basic` |
| `REQUEST_AUTH_PASS` | No | — | Password para auth `basic` |
| `REQUEST_ITERATIONS` | No | `1` | Numero de iteraciones (auto-detecta de lineas JSONL) |
| `REQUEST_VUS` | No | `1` | Usuarios virtuales concurrentes |
| `REQUEST_EXPECTED_STATUS` | No | `200` | Status esperado o rango: `201`, `200-299` |

---

## Fuentes de body

### JSON inline (REQUEST_BODY)

Pasa el JSON directamente como variable de entorno:

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/users \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY='{"name":"Juan","email":"juan@example.com"}'
```

### Archivo JSON (REQUEST_BODY_FILE)

Un solo objeto JSON — una iteracion:

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/ruta/a/order.json
```

### Archivo JSONL (REQUEST_BODY_FILE)

Un JSON por linea — una iteracion por linea:

```bash
# Archivo: orders.jsonl
# {"orderId":"001","name":"Orden 1"}
# {"orderId":"002","name":"Orden 2"}
# {"orderId":"003","name":"Orden 3"}

k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/ruta/a/orders.jsonl
# Ejecuta automaticamente 3 iteraciones (una por linea)
```

### Archivo JSON array (REQUEST_BODY_FILE)

JSON array — una iteracion por elemento:

```bash
# Archivo: orders.json
# [{"orderId":"001"}, {"orderId":"002"}, {"orderId":"003"}]

k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/ruta/a/orders.json
# Ejecuta automaticamente 3 iteraciones (una por elemento del array)
```

> **Nota:** `REQUEST_BODY_FILE` debe ser una ruta absoluta. k6 `open()` resuelve rutas relativas al script compilado, no al directorio de trabajo.

---

## Autenticacion

### Bearer Token

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/users \
  -e REQUEST_AUTH_TYPE=bearer \
  -e REQUEST_AUTH_TOKEN=eyJhbGciOiJIUzI1NiIs...
```

### Basic Auth

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/users \
  -e REQUEST_AUTH_TYPE=basic \
  -e REQUEST_AUTH_USER=admin \
  -e REQUEST_AUTH_PASS=secret123
```

### API Key

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/data \
  -e REQUEST_AUTH_TYPE=api-key \
  -e REQUEST_AUTH_TOKEN=ak_live_abc123
```

---

## Uso en pipelines CI/CD

### GitHub Actions

```yaml
- name: Health check
  run: |
    k6 run dist/reference/api/quick-request.js \
      -e REQUEST_URL=${{ env.API_URL }}/api/health \
      -e REQUEST_EXPECTED_STATUS=200

- name: Smoke test POST
  run: |
    k6 run dist/reference/api/quick-request.js \
      -e REQUEST_URL=${{ env.API_URL }}/api/v1/orders \
      -e REQUEST_METHOD=POST \
      -e REQUEST_BODY='{"orderId":"CI-001","orderName":"CI Test"}' \
      -e REQUEST_EXPECTED_STATUS=200-201
```

### Jenkins / CI generico

```bash
# Validacion rapida post-deploy
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=${API_BASE_URL}/api/health \
  -e REQUEST_EXPECTED_STATUS=200

# Carga con archivo
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=${API_BASE_URL}/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=${WORKSPACE}/test-data/orders.jsonl \
  -e REQUEST_VUS=5 \
  -e REQUEST_ITERATIONS=100
```

---

## Detalles de comportamiento

- **Validacion de status**: Codigo unico (`200`) o rango (`200-299`). Default: `200`.
- **Thresholds**: `http_req_failed < 10%`, `checks > 90%`, tiempo de respuesta < 30s.
- **Ciclo de bodies**: Si `iterations > cantidad de bodies`, se ciclan (modulo).
- **Logging**: Primeras 10 iteraciones y cada 100 se loguean. Los fallos siempre se loguean con preview del response.
- **Integracion con framework**: Usa `RequestHelper` para headers de tracing automaticos y `runChecks()` para aserciones.
