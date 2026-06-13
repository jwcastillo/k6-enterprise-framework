---
title: "k6 Enterprise Framework — Roadmap v2.0: Intelligent Quality Platform"
sidebar_position: 3
---
# k6 Enterprise Framework — Roadmap v2.0: Intelligent Quality Platform

**Fecha**: 2026-02-18
**Version**: 2.0-alpha
**Spec**: 001-service-perf-resilience

---

## Vision General

La version 2.0 transforma el k6 Enterprise Framework de un "Test Runner Empresarial" a una **Intelligent Quality Platform** mediante un ecosistema de 4 agentes de IA especializados que colaboran en pipeline para planificar, construir, ejecutar y analizar pruebas de rendimiento de forma autonoma.

```
Especificacion
   │ (OpenAPI / texto / lenguaje natural)
   ▼
┌─────────────┐    TestPlan    ┌─────────────┐   Scripts .ts  ┌──────────────┐
│  🧠 Planner  │ ─────────────► │  🔨 Builder  │ ──────────────► │   k6 via MCP │
│    Agent    │               │    Agent    │               │  (run_test)  │
└─────────────┘               └─────────────┘               └──────┬───────┘
                                                                    │ JSON results
                                                                    ▼
                                                         ┌──────────────────┐
┌──────────────┐  AnalysisReport  ┌─────────────┐        │   Observability  │
│  📢 Reporter │ ◄─────────────── │  🔍 Analyst  │ ◄───── │ Prometheus/Tempo │
│    Agent    │                  │    Agent    │        │  Loki/Pyroscope  │
└──────────────┘                  └─────────────┘        └──────────────────┘
       │
       ├── Slack / Teams (alertas enriquecidas)
       ├── Jira (tickets automaticos)
       └── HTML reports (ejecutivo + tecnico)
```

---

## Sub-fases del Roadmap

### v2.0-alpha (T-106 a T-114) — MCP extendido + Builder Agent + Base de conocimiento

**Entregables funcionales**:
- ChromaDB vector database con RAG sobre scripts, docs y helpers del framework
- Planner Agent: genera TestPlan desde OpenAPI / texto / lenguaje natural
- Builder Agent: genera scripts TypeScript k6 ejecutables desde TestPlan (tasa exito >=95%)
- Budget Manager: control de tokens y costos por agente
- MCP extendido con 5 nuevos tools de IA
- Suite de validacion del Builder (12 TestPlan fixtures)

**Uso standalone** (sin pipeline completo):
```bash
# Generar TestPlan desde descripcion en lenguaje natural
npx ts-node src/ai/agents/planner-agent.ts \
  --format=natural-language \
  --spec="API de e-commerce con checkout flow, 1000 usuarios concurrentes"

# Generar script k6 desde TestPlan
npx ts-node src/ai/agents/builder-agent.ts \
  --plan=./test-plan.json

# Indexar base de conocimiento
node bin/ai/index-knowledge-base.js --full
```

---

### v2.0-beta (T-115 a T-118) — Analyst Agent + Observabilidad profunda

**Entregables funcionales**:
- Clientes programaticos para Prometheus, Tempo, Loki, Pyroscope
- Anomaly Detector: z-score, IQR, CUSUM, percentile (sin LLM, determinista)
- Analyst Agent: correlacion de causa raiz cruzando k6 + observabilidad
- Suite de validacion del Analyst (8 datasets con ground truth)

**Uso standalone**:
```bash
# Analizar resultados de una ejecucion
npx ts-node src/ai/agents/analyst-agent.ts \
  --results=./reports/client/test/2026-02-18/summary.json \
  --from=-1h

# Detector de anomalias (sin LLM)
npx ts-node src/ai/analysis/anomaly-detector.ts \
  --metrics=./reports/client/test/2026-02-18/summary.json \
  --baseline-runs=10
```

---

### v2.0-GA (T-119 a T-121) — Reporter Agent + Pipeline completo + Motor adaptativo

**Entregables funcionales**:
- Reporter Agent: resumen ejecutivo + tecnico + Slack/Teams/Jira automatico
- Orquestador del pipeline (Planner → Builder → run_test → Analyst → Reporter)
- Self-healing: scripts auto-reparables ante cambios de schema de API (tasa reparacion >=70%)
- Pipeline completo CLI e2e

**Uso del pipeline completo**:
```bash
# Pipeline completo desde descripcion hasta reporte
node cmd/ai-pipeline.js \
  --client=acme-corp \
  --spec="API de pagos con endpoints POST /charge y GET /status" \
  --format=natural-language \
  --notify=slack,jira

# Pipeline completo desde OpenAPI
node cmd/ai-pipeline.js \
  --client=acme-corp \
  --spec=./openapi.json \
  --format=openapi \
  --start-from=planner

# Iniciar desde un paso especifico
node cmd/ai-pipeline.js \
  --start-from=analyst \
  --input=./reports/run-results.json

# Modo dry-run (sin LLM ni ejecucion real)
node cmd/ai-pipeline.js --dry-run --spec=./openapi.json
```

---

## Descripcion de Agentes

### Planner Agent (`src/ai/agents/planner-agent.ts`)

| Dimension | Detalle |
|-----------|---------|
| **Entrada** | OpenAPI spec (JSON/YAML), requerimientos funcionales (texto), lenguaje natural |
| **Salida** | `TestPlan` (JSON editable, legible por humanos) |
| **Capacidades** | Extraccion de endpoints desde OpenAPI, seleccion de tipos de test, modelos de trafico realistas, consulta RAG de arquitectura |
| **LLM** | claude-sonnet-4-6, temperature=0.3 |
| **Tokens/invocacion** | ~8K input + ~2K output |
| **Costo estimado** | ~$0.054 USD/invocacion |
| **Errores manejados** | EC-AI-003 (OpenAPI incompleta: plan parcial con warnings) |

### Builder Agent (`src/ai/agents/builder-agent.ts`)

| Dimension | Detalle |
|-----------|---------|
| **Entrada** | `TestPlan` validado |
| **Salida** | `GeneratedScript` (archivos .ts ejecutables + CSVs de datos) |
| **Capacidades** | Few-shot via RAG, uso obligatorio de helpers del framework, auto-correccion hasta 3 ciclos, generacion de CSVs de datos |
| **LLM** | claude-sonnet-4-6, temperature=0.1 (determinista) |
| **Tokens/invocacion** | ~15K input + ~4K output |
| **Costo estimado** | ~$0.105 USD/invocacion |
| **Errores manejados** | EC-AI-004 (patron no soportado), EC-AI-007 (max reintentos) |
| **SLA** | Tasa exito >= 95% (SC-100) |

### Analyst Agent (`src/ai/agents/analyst-agent.ts`)

| Dimension | Detalle |
|-----------|---------|
| **Entrada** | JSON output de k6 + datos de observabilidad |
| **Salida** | `AnalysisReport` (anomalias + correlaciones + regresiones + recomendaciones) |
| **Capacidades** | Deteccion de anomalias estadisticas (z-score, IQR, CUSUM), correlacion causa-raiz, comparacion con mejor historico |
| **LLM** | claude-sonnet-4-6, temperature=0.2 |
| **Tokens/invocacion** | ~12K input + ~3K output |
| **Costo estimado** | ~$0.081 USD/invocacion |
| **Errores manejados** | EC-AI-005 (observabilidad no disponible: analisis parcial) |
| **SLA** | Precision >= 90%, recall >= 80% (SC-101) |

### Reporter Agent (`src/ai/agents/reporter-agent.ts`)

| Dimension | Detalle |
|-----------|---------|
| **Entrada** | `AnalysisReport` + metricas de ejecucion |
| **Salida** | Resumen ejecutivo + tecnico + alertas Slack/Teams + tickets Jira |
| **Capacidades** | Adaptacion de audiencia (ejecutivo vs tecnico), publicacion multi-canal, creacion automatica de tickets |
| **LLM** | claude-sonnet-4-6, temperature=0.4 |
| **Tokens/invocacion** | ~8K input + ~3K output |
| **Costo estimado** | ~$0.069 USD/invocacion |
| **Errores manejados** | EC-AI-009 (Jira no accesible: hallazgo persistido localmente) |
| **SLA** | Claridad >= 4/5 (SC-102) |

---

## Requisitos de Infraestructura

### Minimos (v2.0-alpha)

| Componente | Requisito |
|------------|-----------|
| **Node.js** | >= 18.0 (ESM, fetch nativo) |
| **npm packages** | `@anthropic-ai/sdk`, `chromadb` |
| **Docker** | ChromaDB: `docker compose --profile ai up chromadb` |
| **API Key** | `ANTHROPIC_API_KEY=sk-ant-...` en `.env` |
| **RAM** | +512 MB para ChromaDB |
| **Disco** | +1 GB para embeddings (base de conocimiento inicial) |

### Stack completo (v2.0-GA)

| Componente | Requisito |
|------------|-----------|
| **Observabilidad** | `./bin/observability.sh up --full` (Prometheus, Loki, Tempo, Pyroscope) |
| **Redis** | `docker compose --profile redis up` (para patterns de datos) |
| **Jira** | `JIRA_URL`, `JIRA_USER`, `JIRA_API_TOKEN` en `.env` (opcional) |
| **Slack** | `NOTIFY_SLACK_WEBHOOK` en `.env` (opcional) |

---

## Estimacion de Costos por Operacion

| Operacion | Tokens aprox | Costo USD | Frecuencia tipica |
|-----------|-------------|-----------|------------------|
| Planner (spec simple) | 10K | $0.054 | 1x por test suite |
| Planner (OpenAPI grande) | 25K | $0.135 | 1x por test suite |
| Builder (test simple) | 19K | $0.105 | 1x por test |
| Builder (e-commerce multi-paso) | 45K | $0.250 | 1x por test |
| Analyst (ejecucion simple) | 15K | $0.081 | 1x por run |
| Analyst (con observabilidad) | 30K | $0.162 | 1x por run |
| Reporter (resumen ejecutivo) | 11K | $0.069 | 1x por run |
| **Pipeline completo (simple)** | **~55K** | **~$0.30** | **1x por ciclo** |
| **Pipeline completo (complejo)** | **~125K** | **~$0.70** | **1x por ciclo** |

> **Limites configurados por defecto**: Budget manager bloquea al llegar a $3 USD/pipeline.
> Configurable via `AI_TOKEN_BUDGET` y `AI_COST_BUDGET_USD` en `.env`.

---

## Guia de Adopcion Incremental (CHK-UX-172)

### Paso 1: Solo MCP (sin IA)

El servidor MCP con los tools base ya es util sin agentes:

```bash
# Ejecutar test via MCP
mcp call run_test '{"client": "acme", "test": "api/smoke"}'

# Validar config
mcp call validate_schema '{"file": "clients/acme/config.json"}'
```

### Paso 2: Builder Agent standalone

Generar un script k6 desde un TestPlan manual:

```bash
# 1. Crear TestPlan manualmente (o editar uno generado por Planner)
cat > my-plan.json << 'EOF'
{ "id": "my-test", "endpoints": [...], ... }
EOF

# 2. Generar script
DRY_RUN=true npx ts-node src/ai/agents/builder-agent.ts --plan=my-plan.json

# 3. Revisar y ejecutar el script generado
k6 run clients/_generated/my-test.ts
```

### Paso 3: Planner + Builder

```bash
node cmd/ai-pipeline.js \
  --start-from=planner \
  --end-at=builder \
  --spec=./openapi.json \
  --client=acme-corp
```

### Paso 4: Analyst standalone

```bash
# Analizar resultados de una ejecucion existente
node cmd/ai-pipeline.js \
  --start-from=analyst \
  --input=./reports/acme/my-test/2026-02-18_100000/summary.json
```

### Paso 5: Pipeline completo

```bash
node cmd/ai-pipeline.js \
  --client=acme-corp \
  --spec=./openapi.json \
  --notify=slack
```

---

## FAQ y Troubleshooting

**P: El Builder Agent falla con EC-AI-007 (max reintentos)**
R: El TestPlan puede tener endpoints con patrones no soportados (MQTT, WebSocket, gRPC). Revisa los warnings del plan. Puedes editar el plan y pasar a Builder directamente con `--start-from=builder`.

**P: ChromaDB no inicia**
R: `docker compose --profile ai up chromadb`. Verifica que el puerto 8000 no este ocupado en tu host (solo necesario si expones ChromaDB con override.yml).

**P: La busqueda RAG retorna 0 documentos**
R: La base de conocimiento no esta indexada. Ejecuta: `node bin/ai/index-knowledge-base.js --full`

**P: Error ANTHROPIC_API_KEY not set**
R: Agrega `ANTHROPIC_API_KEY=sk-ant-...` en `infrastructure/.env` o exporta en tu shell.

**P: El Analyst Agent reporta analisis parcial**
R: El stack de observabilidad no esta activo. Inicia con: `./bin/observability.sh up --full`. El analisis parcial usa solo los datos JSON de k6.

**P: Jira ticket no se crea (EC-AI-009)**
R: El hallazgo se persistio localmente en `reports/_jira-pending/`. Configura `JIRA_URL`, `JIRA_USER`, `JIRA_API_TOKEN` en `.env` para habilitarlo.

**P: El costo de LLM es mayor al esperado**
R: Revisa el Budget Manager: `BudgetManager.getPipelineStatus()`. Puedes reducir `maxOutputTokens` por agente en `ai-config.json` o usar `--dry-run` para validar flujos sin costo.

**P: Como indexar solo los scripts de un cliente especifico?**
R: `node bin/ai/index-knowledge-base.js --full --client=acme-corp`. Esto crea una coleccion aislada que el Builder usa cuando `clientId` esta configurado.
