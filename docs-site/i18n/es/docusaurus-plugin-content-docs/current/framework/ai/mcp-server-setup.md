---
title: "k6 Enterprise Framework — MCP Server"
sidebar_position: 3
---
# k6 Enterprise Framework — MCP Server

Expone las capacidades del framework a cualquier cliente compatible con MCP (Claude Desktop, IDEs, agentes custom).

---

## Recursos

| Resource URI | Descripción |
|---|---|
| `k6://config/{client}/{env}` | Lee el JSON de configuración del cliente |
| `k6://scenarios/{client}` | Lista los escenarios de test disponibles |
| `k6://metrics/{client}/{service}/{timestamp}` | Obtiene métricas de ejecución de un run pasado |

## Tools

| Tool | Descripción |
|---|---|
| `run_test` | Ejecuta un test k6 vía run-test.sh |
| `validate_schema` | Valida un archivo de config contra los JSON schemas |
| `generate_scaffold` | Genera scaffold de un nuevo cliente, test, servicio o factory |

---

## Instalación

```bash
cd mcp-server
npm install
npm run build
```

---

## Configuración para Claude Desktop

Agrega a `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

En Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Reinicia Claude Desktop después de editar.

---

## Configuración para otros clientes MCP

Cualquier cliente que soporte transporte stdio puede conectarse:

```json
{
  "command": "node",
  "args": ["/path/to/k6-framework/mcp-server/dist/index.js"],
  "transport": "stdio"
}
```

---

## Ejemplos de interacción (Claude Desktop)

```
Tú: List the scenarios for the examples client.
→ Llama: list_scenarios({ client: "examples" })

Tú: Run the smoke test for client acme, scenario api/smoke-users.
→ Llama: run_test({ client: "acme", test: "api/smoke-users", profile: "smoke" })

Tú: Is the config for client acme valid?
→ Llama: validate_schema({ file: "clients/acme/config/default.json" })

Tú: Create a new client called beta-team.
→ Llama: generate_scaffold({ name: "beta-team", type: "client" })
```

---

## Seguridad

- Todos los parámetros `client` y `test` son sanitizados para prevenir inyección de shell
- El acceso a archivos está restringido al directorio raíz del framework
- La ejecución concurrente del mismo par `client:test` se bloquea con error `ALREADY_RUNNING`
- El server no expone rutas del filesystem fuera del directorio raíz del framework

---

## Troubleshooting

| Error | Causa | Fix |
|---|---|---|
| `NOT_FOUND: Client 'x' not found` | El directorio del cliente no existe | Ejecuta `bin/create-client.sh x` |
| `ALREADY_RUNNING` | El mismo test ya está en ejecución | Espera a que termine o mata el proceso en ejecución |
| `INVALID_PARAMS: unsafe characters` | Intento de shell injection | Usa solo nombres alfanuméricos |
| El server no arranca | Ruta `dist/index.js` incorrecta | Ejecuta `npm run build` en `mcp-server/` |
