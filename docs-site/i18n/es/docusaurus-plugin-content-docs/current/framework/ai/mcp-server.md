---
title: "Servidor MCP — US22"
sidebar_position: 2
---
# Servidor MCP — US22

Expone el k6 Enterprise Framework a Claude Desktop y otros clientes compatibles con MCP a través del Model Context Protocol.

**Tareas:** T-065, T-066, T-067, T-068
**Directorio:** `k6-framework/mcp-server/`

---

## ¿Qué es MCP?

El [Model Context Protocol](https://modelcontextprotocol.io/) permite a los asistentes de IA interactuar con herramientas externas y fuentes de datos a través de una interfaz estandarizada. El servidor MCP del k6 Framework expone:

- **Resources** — datos de solo lectura (configuraciones, listas de escenarios, métricas pasadas)
- **Tools** — acciones (ejecutar pruebas, validar esquemas, generar nuevos artefactos)

---

## Configuración

### Compilación

```bash
cd k6-framework/mcp-server
npm install
npm run build
# Output: dist/index.js
```

### Claude Desktop

Edita `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "k6-framework": {
      "command": "node",
      "args": ["/absolute/path/to/k6-framework/mcp-server/dist/index.js"]
    }
  }
}
```

Reinicia Claude Desktop. El servidor se inicia automáticamente cuando Claude lo necesita.

### Otros clientes MCP

Cualquier cliente que soporte el transporte stdio de MCP puede conectarse:

```bash
# Start manually (for testing or custom clients)
node k6-framework/mcp-server/dist/index.js
```

El servidor se comunica vía stdin/stdout usando el protocolo JSON-RPC de MCP.

---

## Resources

Los resources son fuentes de datos de solo lectura identificadas por URI.

### read_config — `k6://config/{client}/{env}`

Lee la configuración de un cliente para un entorno dado.

```
k6://config/clienteA/default
k6://config/clienteA/staging
```

Devuelve el JSON de configuración parseado desde `clients/{client}/config/{env}.json`.

**Ejemplo de interacción:**
```
User: Show me the clienteA production config.
→ reads k6://config/clienteA/production
→ returns JSON with services, thresholds, SLO definitions
```

### list_scenarios — `k6://scenarios/{client}`

Lista todos los escenarios de prueba disponibles para un cliente.

```
k6://scenarios/clienteA
```

Devuelve un arreglo de rutas de escenarios relativas a `clients/{client}/scenarios/`.

### get_metrics — `k6://metrics/{test_id}`

Recupera las métricas de ejecución de una prueba pasada.

```
k6://metrics/clienteA/api/smoke-users/2026-02-17_143000
```

Formato de `test_id`: `{client}/{scenario}/{timestamp}` — coincide con la estructura del directorio de reportes.

Devuelve las métricas desde `reports/{client}/{scenario}/{timestamp}/k6-summary.json`.

---

## Tools

Los tools son acciones que modifican estado o ejecutan procesos.

### run_test

Ejecuta una prueba de carga k6 para un cliente.

```json
{
  "client": "clienteA",
  "test": "api/smoke-users",
  "profile": "smoke",
  "env": "default"
}
```

**Parámetros:**

| Campo | Tipo | Requerido | Por defecto | Descripción |
|-------|------|-----------|-------------|-------------|
| `client` | string | sí | — | Nombre del cliente |
| `test` | string | sí | — | Ruta del escenario (ej. `api/smoke-users`) |
| `profile` | string | no | `smoke` | Perfil de carga: smoke, quick, load, stress |
| `env` | string | no | `default` | Nombre del entorno de configuración |

**Devuelve:**

```json
{
  "status": "pass",
  "exitCode": 0,
  "output": "✓ checks.........................: 100.00%\n...",
  "reportPath": "reports/clienteA/api/smoke-users/2026-02-17_143000"
}
```

**Protección de concurrencia:** Si la misma combinación `client+test` ya está en ejecución, la herramienta
devuelve el error `ALREADY_RUNNING` inmediatamente (EC-AI-001).

**Ejemplo de interacción:**
```
User: Run a smoke test for clienteA's smoke-users scenario.
→ calls run_test({ client: "clienteA", test: "api/smoke-users", profile: "smoke" })
→ returns pass/fail status + truncated output (≤8000 chars)
```

### validate_schema

Valida un archivo de configuración contra los esquemas JSON del framework.

```json
{
  "file": "clients/clienteA/config/default.json"
}
```

La herramienta prueba todos los esquemas en `shared/schemas/` y devuelve la mejor coincidencia.

**Devuelve:**

```json
{
  "valid": true,
  "errors": []
}
```

En caso de fallo:

```json
{
  "valid": false,
  "errors": [
    { "path": "/services/0/baseUrl", "message": "must be a string" }
  ]
}
```

### generate_scaffold

Genera un nuevo artefacto del framework.

```json
{
  "name": "OrderService",
  "type": "service",
  "client": "clienteA"
}
```

**Parámetros:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `name` | string | sí | Nombre para el artefacto |
| `type` | enum | sí | `client` \| `test` \| `service` \| `factory` |
| `client` | string | para tipos no-client | Cliente destino |

**Devuelve:**

```json
{
  "created": [
    "clients/clienteA/lib/services/OrderService.ts"
  ]
}
```

---

## Ejemplos de interacción con Claude

### Ejecutar una prueba

```
User: Run a load test for clienteA with the load profile.
Claude: I'll run the load test for clienteA.
[calls run_test({ client: "clienteA", test: "api/smoke-users", profile: "load" })]
The load test completed with status: pass. All 47 checks passed (100%).
Report saved to: reports/clienteA/api/smoke-users/2026-02-17_150000
```

### Consultar configuración

```
User: What services does clienteA test?
Claude: Let me check the clienteA configuration.
[reads k6://config/clienteA/default]
clienteA tests 2 services:
- users-api (https://api.example.com, SLO: p95 < 500ms)
- orders-api (https://orders.example.com, SLO: p95 < 800ms)
```

### Scaffolding

```
User: Create a new client called "payment-service".
Claude: I'll scaffold a new client for payment-service.
[calls generate_scaffold({ name: "payment-service", type: "client" })]
Created:
- clients/payment-service/config/default.json
- clients/payment-service/scenarios/api/smoke-baseline.ts
- clients/payment-service/lib/services/payment-service-service.ts
- clients/payment-service/README.md
```

---

## Seguridad

### Prevención de path traversal

Todas las rutas de archivos se validan para estar dentro de `FRAMEWORK_ROOT` antes de cualquier operación de archivo:

```typescript
const absFile = resolve(FRAMEWORK_ROOT, file);
if (!absFile.startsWith(FRAMEWORK_ROOT)) {
  throw mcpError("INVALID_PARAMS", "File path must be within the framework directory.");
}
```

### Prevención de inyección de shell

Todos los argumentos pasados a comandos de shell se sanitizan mediante `sanitizeArg()`,
que rechaza los caracteres: `; & | $ ( ) { } [ ] < > \` ' " \n \r \0`

Esto cubre el patrón de inyección de comandos de OWASP (CHK-SEC-110).

### Errores estructurados

Todos los errores de herramientas devuelven un objeto estructurado con `code`, `message` y `details` opcional:

```json
{
  "code": "CLIENT_NOT_FOUND",
  "message": "Client 'unknown-client' does not exist.",
  "details": { "clientsDir": "clients/" }
}
```

---

## Arquitectura

```
mcp-server/
├── src/
│   ├── index.ts              ← MCP Server + stdio transport
│   ├── resources/
│   │   └── index.ts          ← readConfig, listScenarios, getMetrics
│   ├── tools/
│   │   └── index.ts          ← runTest, validateSchema, generateScaffold
│   └── utils/
│       └── framework.ts      ← path helpers, sanitization, runCliCommand
├── dist/                     ← compiled output (npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

### Dependencias de ejecución

| Paquete | Versión | Propósito |
|---------|---------|-----------|
| `@modelcontextprotocol/sdk` | ^1.x | Implementación del protocolo MCP |
| `ajv` | resuelto desde el padre | Validación de esquemas JSON |
| `ajv-formats` | resuelto desde el padre | Validadores de formato (email, uri, etc.) |

El servidor MCP resuelve `ajv` y `ajv-formats` desde el `k6-framework/node_modules` padre
mediante ruta relativa — no se requiere instalación separada.

---

## Desarrollo

### Modo watch

```bash
cd k6-framework/mcp-server
npx tsc --watch
```

### Probar el servidor manualmente

Usa el MCP Inspector o cualquier cliente MCP basado en stdio:

```bash
# Install MCP inspector globally
npm install -g @modelcontextprotocol/inspector

# Inspect the server
npx @modelcontextprotocol/inspector node dist/index.js
```

### Agregar una nueva herramienta (tool)

1. Agrega la función handler a `src/tools/index.ts` con una interfaz de parámetros tipada
2. Registra en `src/index.ts`:
   - Agrega al handler de `ListToolsRequestSchema` (inputSchema)
   - Agrega un `case` al switch de `CallToolRequestSchema`

### Agregar un nuevo recurso (resource)

1. Agrega la función lectora a `src/resources/index.ts`
2. Registra en `src/index.ts`:
   - Agrega al handler de `ListResourcesRequestSchema` (plantilla URI)
   - Agrega una rama al handler de `ReadResourceRequestSchema`
