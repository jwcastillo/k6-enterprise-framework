---
title: "Generadores — US21"
sidebar_position: 3
---
# Generadores — US21

Genera scaffolding de nuevos clientes, escenarios de prueba, servicios y data factories sin escribir boilerplate.

**Tareas:** T-059, T-060, T-061, T-062, T-063, T-064
**Scripts:** `bin/generate.js`, `bin/create-client.sh`, `bin/generate-data.js`

---

## Inicio Rápido

```bash
# Generador interactivo (guiado por menú)
node bin/generate.js

# No interactivo: crear un nuevo cliente
bin/create-client.sh my-client

# Generar datos de prueba
node bin/generate-data.js --type=users --count=1000 --format=csv > data/users.csv
node bin/generate-data.js --type=transactions --count=50000 --format=json
```

---

## Generador interactivo — bin/generate.js (T-059)

Lanza un asistente guiado por menú (sin dependencias externas — Node.js puro con `readline`):

```
k6 Enterprise Framework — Generator
────────────────────────────────────
1) New client
2) New test scenario
3) New service class
4) New data factory
q) Quit

Select option:
```

### Menú: Nuevo cliente (1)

Solicita:
- Nombre del cliente (alfanumérico, guiones, guiones bajos)
- URL base del servicio principal

Crea el árbol completo del directorio del cliente (ver `create-client.sh` más abajo).

### Menú: Nuevo escenario de prueba (2)

Solicita:
- Nombre del cliente (debe existir previamente)
- Nombre del escenario (ej. `api/smoke-orders`)
- Protocolo: http / graphql / websocket / mixed

Crea `clients/{client}/scenarios/{name}.ts` a partir de `shared/templates/generators/scenario-api.ts`.

### Menú: Nueva clase de servicio (3)

Solicita:
- Nombre del cliente
- Nombre del servicio (ej. `OrderService`)
- URL base

Crea `clients/{client}/lib/services/{name}.ts` a partir de `shared/templates/generators/service.ts`.

### Menú: Nueva data factory (4)

Solicita:
- Nombre del cliente
- Nombre de la factory (ej. `OrderFactory`)

Crea `clients/{client}/lib/factories/{name}.ts` a partir de `shared/templates/generators/factory.ts`.

---

## Scaffolder no interactivo — bin/create-client.sh (T-060)

Crea un directorio de cliente completo y ejecutable en menos de 5 segundos.

```bash
bin/create-client.sh <client-name>
```

### Estructura creada

```
clients/my-client/
├── config/
│   └── default.json          ← configuración de cliente pre-llenada
├── data/
│   └── .gitkeep
├── lib/
│   ├── factories/
│   │   └── .gitkeep
│   └── services/
│       └── my-client-service.ts   ← clase de servicio de ejemplo
├── reports/                  ← excluido de git
├── scenarios/
│   └── api/
│       └── smoke-baseline.ts      ← prueba de humo ejecutable
└── README.md                 ← documentación del cliente
```

### Validación

El nombre debe coincidir con `^[a-zA-Z0-9_-]+$`. Los nombres de cliente duplicados se rechazan inmediatamente (EC-CLI-010).

### Siguientes pasos (mostrados después del scaffolding)

```
✓ Client 'my-client' created successfully!

Next steps:
  1. Edit clients/my-client/config/default.json — set your service URL
  2. Run: bin/run-test.sh --client=my-client --scenario=api/smoke-baseline
  3. View report: reports/my-client/api/smoke-baseline/{timestamp}/report.html
```

---

## Generador de datos — bin/generate-data.js (T-061)

Genera conjuntos de datos de prueba realistas en formato CSV o JSON.

### Uso

```bash
node bin/generate-data.js [options]

Options:
  --type=TYPE        users | products | transactions  (required)
  --count=N          Number of records (default: 100)
  --format=FORMAT    csv | json                       (default: json)
  --output=FILE      Write to file instead of stdout
  --seed=N           Random seed for reproducibility
```

### Tipos de datos

**users** — `id`, `username`, `email`, `firstName`, `lastName`, `role`, `country`
**products** — `id`, `sku`, `name`, `price`, `category`, `stock`, `currency`
**transactions** — `id`, `userId`, `productId`, `amount`, `currency`, `status`, `timestamp`

### Ejemplos

```bash
# 500 usuarios como CSV (redirigir a archivo)
node bin/generate-data.js --type=users --count=500 --format=csv > data/users.csv

# 10000 productos como arreglo JSON
node bin/generate-data.js --type=products --count=10000 --format=json --output=data/products.json

# Conjunto de datos reproducible con semilla
node bin/generate-data.js --type=transactions --count=200 --seed=42 --format=csv
```

### Modo streaming (count > 10,000)

Para conjuntos de datos grandes, el generador cambia a modo streaming para evitar presión de memoria:

```
Generating 50000 transactions...
  ████████████████░░░░░░░░  10000/50000 (20%)  12.3s elapsed
  ████████████████████████  50000/50000 (100%) done in 61.2s
```

El progreso se reporta cada 10% o cada 10 segundos (EC-CLI-011).

---

## Plantillas — shared/templates/generators/

Todos los generadores usan plantillas con sustitución de `{{PLACEHOLDER}}`:

| Plantilla | Uso |
|-----------|-----|
| `client-default.json` | Stub de configuración de cliente |
| `scenario-api.ts` | Esqueleto de escenario de prueba |
| `service.ts` | Clase de servicio con métodos CRUD |
| `factory.ts` | Clase de data factory |
| `client-readme.md` | README del cliente |

### Agregar plantillas personalizadas

1. Copiar una plantilla existente a `shared/templates/generators/`
2. Usar `{{NAME}}`, `{{CLIENT_NAME}}`, `{{SERVICE_NAME}}`, `{{BASE_URL}}` como marcadores de posición
3. Referenciar la plantilla en `bin/generate.js` a través del mapa de configuración `templates`

---

## Cliente de referencia — clients/examples/ (T-063, T-064)

Una implementación de referencia completamente anotada que cubre todos los protocolos y patrones del framework.

### Catálogo de escenarios

| # | Archivo | Protocolo | Patrón |
|---|---------|-----------|--------|
| 01 | `api/01-auth-bearer.ts` | HTTP | Autenticación con token Bearer |
| 02 | `api/02-contract-validation.ts` | HTTP | Validación de esquema JSON |
| 03 | `api/03-pagination.ts` | HTTP | Paginación por cursor/página |
| 04 | `api/04-retry-backoff.ts` | HTTP | Reintento exponencial |
| 05 | `api/05-correlation.ts` | HTTP | Propagación de headers de traza |
| 06 | `api/06-weighted-execution.ts` | HTTP | Distribución ponderada de escenarios |
| 07 | `api/07-structured-logging.ts` | HTTP | Integración con StructuredLogger |
| 08 | `api/08-rate-limiting.ts` | HTTP | Detección de rate-limit + reintento |
| 09 | `mixed/09-ecommerce-flow.ts` | HTTP | Flujo de negocio multi-paso |
| 10 | `api/10-graphql.ts` | GraphQL | Query + mutation |
| 11 | `api/11-file-upload.ts` | HTTP | Carga multipart |
| 12 | `integration/12-websocket.ts` | WebSocket | Echo + pub/sub |
| 13 | `mixed/13-multi-protocol.ts` | HTTP+WS+GQL | Mezcla de protocolos |
| 14 | `api/14-advanced-headers.ts` | HTTP | Headers de traza + localización |
| 15 | `integration/15-smoke-baseline.ts` | HTTP | Línea base de overhead del framework |

### Ejecutar ejemplos

```bash
# Escenario de ejemplo individual
bin/run-test.sh --client=examples --scenario=api/01-auth-bearer

# Ejecutar todos los ejemplos
bin/testing/run-all-tests.sh --client=examples --concurrency=3

# Ejecutar solo escenarios API
bin/testing/run-all-tests.sh --client=examples --pattern="api/*.ts"
```

### SC-067 — Tiempo de adaptación ≤15 minutos

Cada archivo de escenario es autocontenido y está ampliamente anotado. Un desarrollador familiarizado con k6
puede adaptar cualquier escenario a su propio servicio en menos de 15 minutos:

1. Copiar el archivo de escenario al directorio `scenarios/` de su cliente
2. Actualizar el `BASE_URL` y las rutas de los endpoints
3. Ajustar los thresholds de verificación para que coincidan con su SLO

---

## Modo no interactivo (MCP / CI)

`bin/generate.js` soporta `--non-interactive` para uso desde el servidor MCP o pipelines de CI:

```bash
# Crear una clase de servicio de forma no interactiva
node bin/generate.js --non-interactive --type=service --client=clienteA --name=OrderService

# Crear un escenario de prueba
node bin/generate.js --non-interactive --type=test --client=clienteA --name=api/load-orders
```

Este es el mismo código invocado por `generate_scaffold` en el servidor MCP (T-067).
