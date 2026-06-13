---
id: agents
title: Agentes de IA
sidebar_position: 1
---

# Agentes de IA

El k6 Enterprise Framework incluye un pipeline de IA de cuatro agentes (Planner, Builder, Analyst, Reporter) más helpers transversales (BudgetManager, AnomalyDetector, SelfHealing). Todos los agentes encaminan las completions de LLM a través de la abstracción `LLMProvider` (neutral respecto al proveedor) introducida en la Phase 5 / AI-01.

## Visión general

Usá el módulo de IA cuando querés que el framework:

- **Planifique** un test desde una spec en lenguaje libre (`PlannerAgent`).
- **Construya** el escenario k6 resultante a partir del plan (`BuilderAgent`).
- **Analice** una corrida ejecutada en busca de anomalías y correlaciones de causa raíz (`AnalystAgent`).
- **Reporte** resultados a humanos en prosa clara, con resúmenes ejecutivos (`ReporterAgent`).

Si podés escribir el escenario a mano, omití el módulo de IA — la mayoría de equipos enterprise lo hacen bien sin él. El camino con IA agrega costo de LLM ($, latencia) y dependencia de un proveedor externo. El framework funciona perfectamente con el módulo de IA deshabilitado.

`BudgetManager` y `AnomalyDetector` son transversales: cada agente impone un presupuesto USD/tokens por agente a través de `BudgetManager`, y el Analyst usa `AnomalyDetector` (z-score + IQR + CUSUM + percentile) para detectar outliers sin depender del criterio del LLM.

Los cuatro agentes aceptan un `provider: LLMProvider` inyectable (ver [Abstracción de provider](#abstracción-de-provider)). Cuando se omite, hacen fallback a `AnthropicProvider` instanciado con la cadena `LLM_API_KEY → ANTHROPIC_API_KEY`.

## Contratos de agentes

### PlannerAgent

**Propósito.** Convertir una spec en lenguaje natural + ejemplos OpenAPI/curl parseados en un `TestPlan` estructurado (scenarios, profiles, thresholds esperados).

**Inputs.** `PlannerInput` — ver `src/types/ai.d.ts`. Campos mínimos: `spec` (string), opcional `openApi`, `examples`, `constraints`. Construir vía:

```typescript
import { PlannerAgent } from "../../src/ai";
const planner = new PlannerAgent({ apiKey: process.env.LLM_API_KEY });
const result = await planner.plan({ spec: "..." });
```

**Outputs.** `PlannerOutput` con un `TestPlan`, `tokensUsed`, y un score de confianza. El plan es el input al `BuilderAgent`.

**Garantías de seguridad.** La spec se trata como no confiable; los secretos no pueden embeberse en el prompt — `K6_AI_PROMPT_REDACT` enmascara tokens antes de enviarlos. Una confianza menor al umbral configurado detiene el pipeline en lugar de construir un escenario de baja calidad.

**Expectativas de costo.** Llamada típica de planning: ~1–5K input tokens + ~2–4K output. A las tarifas de Sonnet (`0.003 / 0.015 USD por 1K`), eso da ~$0.03–0.10 por llamada.

### BuilderAgent

**Propósito.** Generar el `GeneratedScript` (archivo TypeScript del escenario k6 + archivos de soporte) desde un `TestPlan`.

**Inputs.** `BuilderInput` que contiene el `TestPlan` + un opcional `errorFeedback` (usado por `SelfHealingEngine` para reintentar tras un fallo de validación).

**Outputs.** `GeneratedScript` — un struct con `files: GeneratedFile[]`, resultado de validación, y metadatos (versión del agente, confianza, plan de origen).

**Garantías de seguridad.** Los outputs se validan contra `ScriptSchema` antes de devolverlos. Las credenciales hardcoded se rechazan; el generador DEBE usar `__ENV.VARIABLE` para todos los secretos (`CHK-SEC-112`).

**Expectativas de costo.** Llamada típica de build: ~2–6K input + ~3–8K output. A tarifas de Sonnet, ~$0.05–0.13 por llamada.

### AnalystAgent

**Propósito.** Leer summary de k6 + datos de observabilidad (Prometheus, Tempo, Loki, Pyroscope) y producir correlaciones de anomalías estructuradas más un resumen ejecutivo.

**Inputs.** `AnalystInput` — summary de k6, resultados de detección de regresiones, bundle de queries de observabilidad.

**Outputs.** `AnalystOutput` con `anomalies[]`, `correlations[]`, `executiveSummary`, y `recommendations[]`. Cada correlación lleva un `confidence ∈ [0,1]`.

**Garantías de seguridad.** Datos sensibles de logs/trazas se enmascaran antes de enviarse al LLM (`CHK-SEC-113`). El LLM está restringido a respuestas JSON; outputs no-JSON se rechazan.

**Expectativas de costo.** El input más grande de todos los agentes. Típico: ~5–20K input + ~2–4K output → $0.05–0.20 por análisis.

### ReporterAgent

**Propósito.** Renderizar un `AnalystOutput` en resúmenes ejecutivos y técnicos legibles, aptos para distribución por Slack/email.

**Inputs.** `ReporterInput` — el resultado del Analyst + flag de audiencia (`executive` | `technical`).

**Outputs.** `ReporterOutput` con `executiveSummary` (≤150 palabras) y `technicalSummary` (≤300 palabras). Ambos pasan por `maskSensitive()` antes de devolverse.

**Garantías de seguridad.** Sin tokens crudos, passwords, ni trace IDs en el output (`CHK-SEC-114`, `CHK-SEC-117`). Output solo en JSON.

**Expectativas de costo.** El más chico: ~2–4K input + ~1–2K output → $0.02–0.05 por reporte.

## BudgetManager

`BudgetManager` (`src/ai/core/budget-manager.ts`) impone límites de gasto por agente vía circuit breaker. Defaults:

| Límite | Default | Env knob |
| --- | --- | --- |
| USD por corrida del pipeline | `5.0` | `K6_AI_BUDGET_USD` |
| Requests por minuto | `60` | `K6_AI_BUDGET_RPM` |
| Tokens por minuto | `100000` | `K6_AI_BUDGET_TPM` |

Cuando cualquier límite se excede, el breaker se dispara y las siguientes llamadas del agente lanzan `BudgetExceededError`. El breaker es por agente (Planner, Builder, Analyst, Reporter) para que un agente desbocado no le robe presupuesto a sus hermanos.

## AnomalyDetector

`AnomalyDetector` (`src/ai/analysis/anomaly-detector.ts`) es el motor de anomalías multi-algoritmo usado por `AnalystAgent` y por callers standalone. NUNCA invoca al LLM — opera puramente sobre series numéricas.

### Z-score

Se dispara cuando una muestra se aparta más de `sensitivity` desviaciones estándar de la media móvil (default 3.0; `sensitivity: "medium"` → 2.5, `"high"` → 2.0).

### IQR (Interquartile Range)

Se dispara cuando una muestra cae fuera de `[Q1 − 1.5·IQR, Q3 + 1.5·IQR]`. Robusto ante distribuciones de colas pesadas.

### CUSUM (Cumulative Sum)

Detecta shifts sostenidos en la media acumulando desviaciones con signo y comparándolas contra un umbral. Mejor para drifts lentos que el z-score no ve.

### Percentile bound

Se dispara cuando el p95/p99 observado supera un techo configurado. Útil para bounds derivados de SLO (ej. "p95 debe ser < 800 ms").

Overrides vía `new AnomalyDetector({ sensitivity, p95Ceiling, cusumThreshold, ... })` o editando la opción `anomalyDetectorConfig` pasada a `AnalystAgent`.

## Salvaguardas de SelfHealing

`SelfHealingEngine` (`src/ai/adaptive/self-healing.ts`) auto-repara scripts k6 fallidos reinvocando al `BuilderAgent` con la traza de error como contexto. El hardening de Phase 5 / AI-03 lo hace seguro por default:

- **Sandbox.** Los fixes caen en `path.join(os.tmpdir(), "k6-self-healing", crypto.randomUUID())/<basename>.fixed.ts`. Nunca se escribe directamente bajo `clients/`.
- **Diff emission.** Un unified diff entre el original y el candidato se emite vía `console.warn` ANTES del gate check, así los operadores ven el cambio propuesto incluso cuando el gate lo rechaza.
- **Apply gate (precedencia estricta).**
  1. `K6_AI_AUTO_APPLY=true` → apply silencioso.
  2. TTY interactivo → prompt 30 s, default no (cualquier respuesta no-`y` o timeout = skip).
  3. Ninguno → log `[self-healing] fix proposed at <tmp> — not applied` y retorna.
- **Test-pass gate.** El `testCommand` configurado (default `["pnpm", "vitest", "run", "--passWithNoTests"]`) corre con `K6_AI_HEAL_TARGET=<tmp>` inyectado. Solo si exit code 0 el motor hace `copyFile(tmp, originalPath)`.
- **Retry cap.** `MAX_RETRIES = 3` por test fallido en una sola corrida (`EC-AI-007`).

| Gate | Propósito | Env var |
| --- | --- | --- |
| Apply gate (env) | Promoción silenciosa CI-friendly | `K6_AI_AUTO_APPLY` |
| Apply gate (interactivo) | Revisión humana en el loop | (detección de TTY) |
| Test-pass gate | Red de seguridad empírica antes del copy | (ninguna — derivada del exit del `testCommand`) |

La promoción usa `fs.promises.copyFile(tmpPath, originalPath)`. El directorio tmp se preserva incluso ante éxito para que los operadores puedan inspeccionar el diff después del hecho.

## Comportamiento ante caída de ChromaDB

La capa RAG del Knowledge Base (`src/ai/knowledge-base/knowledge-base.ts`) tiene comportamiento warn-vs-throw explícito cuando ChromaDB no es alcanzable:

| Condición | Comportamiento |
| --- | --- |
| `useKnowledgeBase: false` | Sin llamada a ChromaDB, sin warning. |
| `useKnowledgeBase: true` + alcanzable | RAG activo. |
| `useKnowledgeBase: true` + no alcanzable + `K6_AI_REQUIRE_RAG` unset/false | `console.warn(...)` + degrada (las queries devuelven `null`). |
| `useKnowledgeBase: true` + no alcanzable + `K6_AI_REQUIRE_RAG=true` | Lanza `Error("RAG required ... unreachable")`. |

Los callers pueden ramificar en `KnowledgeBaseManager.isDegraded(): boolean` para detectar el estado degradado programáticamente sin parsear strings de log. El `@ts-ignore` que antes estaba en el import de chromadb fue removido en Phase 5 / AI-04 — los tipos ahora resuelven vía el shim local `src/types/chromadb.d.ts` para que el import compile aún cuando la peer dep opcional no esté instalada.

La conexión a ChromaDB se configura vía env: `CHROMA_HOST` (default `localhost`) y `CHROMA_PORT` (default `8000`). Dejar unset para saltear RAG enteramente.

## Abstracción de provider

`LLMProvider` (`src/ai/core/llm-provider.ts`) es el contrato vendor-neutral que consumen todos los agentes. Tres métodos:

```typescript
interface LLMProvider {
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  embed(text: string): Promise<number[]>;
  estimateCost(usage: TokenUsage, model?: string): EstimateCostResult;
}
```

Implementaciones shipped:

- **`AnthropicProvider`** (`src/ai/core/providers/anthropic-provider.ts`) — envuelve `@anthropic-ai/sdk`. El ÚNICO archivo de producción autorizado a importar el SDK (impuesto por ESLint `no-restricted-imports` y `test/ai/sdk-boundary.test.ts`).
- **`OpenAIProvider`** (stub) — compatibilidad de interfaz únicamente; lanza `Error("OpenAIProvider not implemented for v0.3.0; use AnthropicProvider")`. Demuestra que la interfaz compila limpiamente con un segundo provider.

### Agregar un provider nuevo

1. Implementar `LLMProvider` en `src/ai/core/providers/<vendor>-provider.ts`.
2. Re-exportar desde `src/ai/core/providers/index.ts`.
3. Pasarlo en el constructor del agente: `new PlannerAgent({ provider: new MyProvider({ ... }) })`.
4. Actualizar el allow-list `EXPECTED_SDK_IMPORTERS` en `test/ai/sdk-boundary.test.ts` si tu provider importa un SDK vendor nuevo.

### Pricing config

Los costos se leen desde `src/ai/core/pricing.json` (schema D-06):

```json
{
  "default": "claude-sonnet-4-6",
  "models": {
    "claude-sonnet-4-6": { "input_usd_per_1k": 0.003, "output_usd_per_1k": 0.015 },
    "claude-opus-4-7":   { "input_usd_per_1k": 0.015, "output_usd_per_1k": 0.075 }
  }
}
```

Los env overrides aplican SOLO al modelo DEFAULT (Phase 5 / AI-02 / D-07):

```bash
LLM_INPUT_USD_PER_1K=0.002 LLM_OUTPUT_USD_PER_1K=0.010 ./bin/run-test.sh ...
```

Para agregar un modelo: appendearlo a `pricing.json` y pasar su id vía `chat({ model: "..." })` o vía `config.model` del agente. Modelos desconocidos caen al rate default Y al nombre default (D-08, sin throw) — `estimateCost()` devuelve el modelo que efectivamente se cobró.

## Cross-references

- `framework/ai/ai-config.md` — catálogo completo de env vars y walkthrough de bootstrap.
- `framework/ai/mcp-server.md` — integración MCP para generación de scaffold asistida por IA.
