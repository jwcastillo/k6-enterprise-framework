---
title: "k6 Enterprise Load Testing Framework"
sidebar_position: 1
---
# k6 Enterprise Load Testing Framework

Plataforma unificada y self-service de pruebas de carga empresarial construida sobre [Grafana k6](https://k6.io) con una **arquitectura de dos capas**: un core generico reutilizable (`src/`) y capas de producto aisladas por cliente (`clients/`).

**192+ funcionalidades** en 16 categorias — perfiles de carga, helpers, patrones, metricas, reportes, observabilidad, seguridad, CI/CD e IA.

---

## Inicio Rapido

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar el test smoke de referencia
./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke

# 3. Ver el reporte HTML interactivo
open reports/_reference/api/smoke-users/*/report.html
```

---

## Arquitectura

```
k6-enterprise-framework/
├── src/                        # Capa generica (compartida entre todos los clientes)
│   ├── core/                   # Motor de ejecucion, cargador de config, resolver de cliente,
│   │                           #   cargador de perfiles, gestor de secretos, evaluador SLO,
│   │                           #   validador de entrada, RBAC, audit log
│   ├── helpers/                # 14 helpers reutilizables
│   ├── patterns/               # 10 patrones de test
│   ├── metrics/                # Motor de 125+ metricas
│   ├── observability/          # Salud del generador, detector de overhead
│   └── reporting/              # Generador de reportes HTML, visualizador de tendencias
├── shared/
│   ├── profiles/               # 9 definiciones JSON de perfiles de carga
│   └── schemas/                # Definiciones de JSON Schema
├── clients/
│   ├── _reference/             # Implementacion de referencia (comienza aqui)
│   ├── _benchmark/             # Benchmark de overhead del framework
│   └── examples/               # Escenarios de ejemplo (grupos, metricas custom, web vitals)
├── infrastructure/
│   ├── docker-compose.yml      # Stack de observabilidad
│   ├── grafana/dashboards/     # 3 dashboards Grafana (provisionados via JSON)
│   └── k8s/                    # Manifiestos Kubernetes (RBAC, NetworkPolicy)
├── bin/                        # Scripts CLI (run-test, generadores, exportadores)
├── ci-templates/               # Templates GitHub Actions + GitLab CI
└── reports/                    # Reportes generados (HTML, JSON, PDF, analisis LLM)
```

---

## Matriz de Funcionalidades

| Categoria | Cantidad | Destacados |
|-----------|----------|------------|
| Perfiles de Carga | 9 | smoke, quick, load, rampup, capacity, stress, spike, breakpoint, soak |
| Helpers | 14 | request, data, date, header, validation, performance, logger, redis, upload, graphql, websocket, data-pool |
| Patrones | 10 | auth, correlation, pagination, retry, weighted-execution, contract, mock-server, chaos-injection, redis-coordination, funnel |
| Metricas | 125+ | HTTP, checks, grupos, custom (Trend/Counter/Rate/Gauge), Web Vitals, SLO, salud del generador |
| Reportes | 17+ | HTML interactivo, exportacion PDF/PNG, analisis LLM, auto-comparacion, tendencias, branding |
| Dashboards Grafana | 3 | Load Test Overview, Enterprise Analytics, Web Vitals |
| Metricas Custom | 4 tipos | Trend, Counter, Rate, Gauge — auto-detectadas en dashboards |
| Analisis de Grupos | Auto | Inyeccion sintetica de thresholds, suplementacion root_group, timing + checks |
| SLA/SLO | Auto | Evaluacion 3 estados (cumple/en-riesgo/incumple), APDEX, reportes mensuales |
| Seguridad | 14 | RBAC, audit log, path traversal, hardening shell, YAML, secretos, redaccion PII |
| CI/CD | 2 | Templates GitHub Actions, GitLab CI con detect-secrets |
| Observabilidad | 5 | Prometheus, Grafana, Loki, Tempo, Pyroscope |
| Generadores | 4 | Scaffolding de cliente, escenario, servicio, data factory |
| Distribucion | K8s | k6 Operator, segmentos de ejecucion, NetworkPolicy |
| Servidor MCP | 5 tools | Integracion IA para ejecucion y analisis de tests |
| Roadmap IA v2 | 4 agentes | Planner, Builder, Analyst, Reporter (ChromaDB + RAG) |

---

## Perfiles de Carga

| Perfil | VUs | Duracion | Proposito |
|--------|-----|----------|-----------|
| `smoke` | 1 | 1 min | Verificar que el sistema esta operativo |
| `quick` | 5 | 3 min | Feedback rapido para CI/CD |
| `load` | 20 | 14 min | Carga normal sostenida |
| `rampup` | 50 | 13 min | Incremento gradual |
| `capacity` | 200 | 20 min | Encontrar throughput maximo |
| `stress` | 400 | 25 min | Encontrar punto de ruptura |
| `spike` | 300 burst | 8 min | Probar elasticidad |
| `breakpoint` | ->1000 | 1 hora | Encontrar limite del sistema |
| `soak` | 20 | 4+ horas | Detectar memory leaks |

---

## Helpers

| Helper | Propósito |
|--------|-----------|
| `RequestHelper` | Cliente HTTP con headers de tracing automáticos + inyección de auth |
| `DataHelper` | Cadenas aleatorias, emails, tarjetas de crédito (Luhn), usuarios, precios |
| `DateHelper` | Formateo de fechas, aritmética, rangos, seguro para zonas horarias |
| `HeaderHelper` | Headers de tracing (UUID), headers de auth, localización, User-Agent |
| `ValidationHelper` | Código de estado, campos JSON, tiempo de respuesta, validadores email/URL/UUID |
| `PerformanceHelper` | Percentiles (p50/p90/p95/p99), agregación, comparación con línea base |
| `StructuredLogger` | Logging JSON con enmascaramiento automático de secretos |
| `RedisHelper` | Estado compartido Redis para compartir datos entre VUs |
| `UploadHelper` | Subida de archivos con multipart/form-data |
| `GraphQLHelper` | Queries/mutations GraphQL con variables |
| `WebSocketHelper` | Conexiones WebSocket con manejo de mensajes |
| `DataPool` | Gestión de pools de datos CSV/JSON con acceso round-robin/aleatorio |

---

## Patrones

| Patrón | Propósito |
|--------|-----------|
| `authenticate()` | Flujos Bearer, Basic, OAuth2, API Key |
| `extractFromResponse()` | Correlación — extraer valores JSON/header/regex |
| `interpolate()` | Sustitución de templates `{{variable}}` en URLs/bodies |
| `initPagination()` / `traverseAll()` | Traversal de APIs por offset, cursor, página |
| `withRetry()` / `retryRequest()` | Backoff exponencial con jitter |
| `weightedSwitch()` | Distribución aleatoria ponderada de escenarios |
| `ContractValidator` | Validación JSON Schema via ajv |
| `loadMockConfigs()` / `getMockUrl()` | Configuración y enrutamiento de mock server |
| `loadChaosConfig()` / `evaluateChaosRules()` | Inyección de caos con reglas de fallo configurables |
| `UserPool` / `DistributedRateLimiter` | Estado compartido y limitación de tasa respaldados por Redis |
| `initFunnelMetrics()` / `runFunnel()` | Tracking de funnel multi-paso con análisis de abandono |

---

## Reportes

Después de cada ejecución, el framework genera:

- **Reporte HTML interactivo** con 17+ secciones (KPIs, APDEX, SLAs, gráficos de latencia, grupos, métricas custom, web vitals, comparación)
- **Exportación PDF/PNG** vía renderizado headless con Puppeteer
- **Reportes de análisis LLM** (`analysis-*.md` + `message-*.md`) con insights inteligentes usando Claude
- **Comparación automática** con la ejecución anterior (tablas delta + sparklines)
- **Análisis de tendencias** a través de ejecuciones históricas

```bash
# Ejecutar test (reporte auto-generado)
./bin/run-test.sh --client=acme --service=users --test=load

# Los reportes se auto-generan en:
# reports/{client}/{scenario}/{timestamp}/report.html
```

---

## Dashboards Grafana

Tres dashboards provisionados para observabilidad en tiempo real:

| Dashboard | Proposito |
|-----------|-----------|
| **Load Test Overview** | KPIs, APDEX, SLA, percentiles de latencia, analisis de grupos, metricas custom |
| **Enterprise Analytics** | Analisis de capacidad, throughput, patrones de error, metricas custom detalladas |
| **Web Vitals** | LCP, FCP, CLS, TTFB, INP con thresholds bueno/necesita-mejora/pobre |

```bash
# Iniciar stack de observabilidad
./bin/observability.sh up --full

# Acceder a Grafana
./bin/observability.sh open
```

---

## Metricas Custom y Analisis de Grupos

Define metricas de negocio custom que se detectan automaticamente en reportes y Grafana:

```typescript
import { Counter, Trend, Rate, Gauge } from "k6/metrics";

const transactions = new Counter("business_transactions");
const latency = new Trend("api_latency_ms");
const successRate = new Rate("business_success_rate");
const activeUsers = new Gauge("active_users_gauge");
```

Los grupos obtienen análisis de timing automático con inyección sintética de thresholds:

```typescript
group("Checkout", () => {
  // El framework rastrea automáticamente duración, checks e inyecta thresholds
  const res = http.post(`${BASE_URL}/checkout`, payload);
  check(res, { "checkout ok": (r) => r.status === 200 });
});
```

---

## SLA/SLO y APDEX

- Define SLOs por servicio en `clients/{nombre}/config/slos.json`
- Evaluacion automatica de 3 estados: **cumple** / **en-riesgo** / **incumple**
- Puntuacion APDEX con thresholds configurables
- Reportes mensuales de cumplimiento con tendencias

---

## Seguridad

14 funcionalidades de seguridad incluyendo:
- **RBAC**: 3 roles (developer, lead, admin) con permisos granulares
- **Audit log inmutable**: Cadena de hashes SHA-256 en formato JSONL
- **Aislamiento de clientes**: Protección contra path traversal, errores opacos
- **Hardening de shell**: Validación de entrada, whitelist de backends de secretos
- **Parseo seguro de YAML**: Límites de tamaño, profundidad, protección contra YAML bombs
- **Gestión de secretos**: Detección de patrones, sanitización de URLs en logs
- **Redacción de PII**: Automática en reportes HTML y labels de Prometheus

---

## Integración CI/CD

Templates para GitHub Actions y GitLab CI:

```bash
# GitHub Actions: .github/workflows/k6-test.yml
# GitLab CI: .gitlab-ci.yml

# Ambos incluyen:
# - Detección de secretos antes de la ejecución de tests
# - Subida de artefactos de reportes
# - Permisos de mínimo privilegio
```

---

## Stack de Observabilidad

```bash
./bin/observability.sh up --full
```

| Servicio | Puerto | Propósito |
|----------|--------|-----------|
| Grafana | 3000 | Dashboards |
| Prometheus | 9090 | Métricas |
| Loki | 3100 | Logs |
| Tempo | 3200 | Trazas |
| Pyroscope | 4040 | Profiling |

---

## Servidor MCP

Integración IA vía Model Context Protocol:

```bash
node mcp-server/dist/index.js
```

---

## Variables de Entorno

```bash
K6_PROFILE=smoke              # Perfil de carga
K6_ENV=default                # Entorno destino
K6_CLIENT=_reference          # Nombre del cliente
K6_STRUCTURED_LOGS=true       # Logging JSON estructurado
K6_DEBUG=true                 # Output de debug detallado
K6_SECRETS_BACKENDS=env       # Secretos: env,vault,aws-sm,azure-kv
ANTHROPIC_API_KEY=sk-ant-...  # Analisis LLM (opcional)
```

---

## Crear un Nuevo Cliente

```bash
# Usar el generador
node bin/generate.js --type=client --name=mi-producto

# O scaffolding manual
cp -r clients/_reference clients/mi-producto
# Editar config, agregar servicios, escribir escenarios
```

---

## Desarrollo

```bash
npm run build       # Compilar TypeScript -> bundles k6 (webpack)
npm run typecheck   # Verificacion de tipos TypeScript
npm run lint        # ESLint
npm run format      # Prettier
npm run validate    # TypeScript + ESLint (todas las verificaciones)
```



## Siguientes Pasos

Explora la documentacion usando la barra lateral:

- **[Catalogo de Funcionalidades](./framework/feature-catalog)** — listado completo de 192+ funcionalidades
- **[Perfiles de Carga](./framework/load-profiles)** — 13 perfiles predefinidos
- **[Guia de Patrones](./framework/patterns/patterns-guide)** — 10 patrones de prueba
- **[Motor de Metricas](./framework/metrics/metrics-engine)** — referencia de 125+ metricas
- **[Reportes](./framework/reporting/)** — reportes HTML, PDF, LLM
- **[Seguridad](./framework/security/)** — RBAC, auditoria, aislamiento
