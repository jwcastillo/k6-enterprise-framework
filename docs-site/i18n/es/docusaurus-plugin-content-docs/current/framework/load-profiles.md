---
title: "Perfiles de Pruebas de Carga (T-160)"
sidebar_position: 2
---
# Perfiles de Pruebas de Carga (T-160)

El framework proporciona **17 perfiles de carga predefinidos** que cubren patrones
de prueba basados en VUs (modelo cerrado) y basados en tasa de llegada (modelo abierto).

## Referencia Rápida

### Perfiles Basados en VUs (Modelo Cerrado)

| Perfil | Categoría | VUs | Duración | Propósito |
|--------|-----------|-----|----------|-----------|
| `smoke` | Desarrollo | 1–2 | 1 min | Verificar operatividad |
| `quick` | Desarrollo | 5 | 3 min | Retroalimentación rápida CI/CD |
| `load` | Carga | 20 | 14 min | Carga sostenida normal |
| `rampup` | Carga | 50 | 13 min | Incremento gradual |
| `capacity` | Carga | 200 | 20 min | Encontrar throughput máximo |
| `stress` | Estrés | 400 | 25 min | Encontrar punto de quiebre |
| `spike` | Estrés | 300 pico | ~8 min | Probar elasticidad |
| `breakpoint` | Estrés | 1000 | 1 h | Encontrar límite del sistema |
| `soak` | Estabilidad | 20 | 4 h+ | Detectar fugas de memoria |

### Perfiles de Tasa de Llegada (Modelo Abierto)

| Perfil | Ejecutor | Tasa | Duración | VUs Pre/Máx |
|--------|----------|------|----------|-------------|
| `throughput-low` | constant-arrival-rate | 10/s | 5 min | 20 / 50 |
| `throughput-medium` | constant-arrival-rate | 50/s | 5 min | 60 / 150 |
| `throughput-high` | constant-arrival-rate | 100/s | 5 min | 120 / 300 |
| `throughput-ramp` | ramping-arrival-rate | 10→100/s | 12 min | 120 / 300 |

> **Modelo abierto vs cerrado:** Los perfiles basados en VUs usan un *modelo cerrado* donde
> el throughput depende del tiempo de respuesta del servidor. Los perfiles de tasa de llegada
> usan un *modelo abierto* donde el framework envía solicitudes a una tasa fija independiente
> del tiempo de respuesta — esto simula el tráfico del mundo real con mayor precisión.

---

## Categorías

### Desarrollo
Perfiles diseñados para iteración rápida durante el desarrollo y pipelines de CI.

#### `smoke`
- **VUs**: 1–2
- **Duración**: 1 minuto
- **Propósito**: Verificar que el sistema está operativo y los scripts se ejecutan sin errores
- **Cuándo usarlo**: Después de despliegues, antes de ejecutar pruebas más pesadas, durante el desarrollo
- **Etapas**: 30s → 1 VU, 30s → 0
- **Duración máxima**: 2m
- **Umbrales**: p95 < 2000ms, tasa de error < 1%, checks ≥ 99%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=smoke
```

#### `quick`
- **VUs**: 5
- **Duración**: 3 minutos
- **Propósito**: Retroalimentación rápida para CI/CD — detecta regresiones sin largas esperas
- **Cuándo usarlo**: En cada PR, puertas de pre-merge
- **Etapas**: 30s → 5, 2m → 5, 30s → 0
- **Duración máxima**: 5m
- **Umbrales**: p95 < 1500ms, p99 < 3000ms, tasa de error < 5%, checks ≥ 95%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=quick
```

---

### Carga
Perfiles para carga sostenida normal y elevada.

#### `load`
- **VUs**: 20 (rampa 0→20 en 2m, sostener 10m, rampa de bajada 2m)
- **Duración**: ~14 minutos en total
- **Propósito**: Simular tráfico de producción normal
- **Cuándo usarlo**: Regresión semanal, validación previa al lanzamiento
- **Etapas**: 2m → 20, 10m → 20, 2m → 0
- **Duración máxima**: 15m
- **Umbrales**: p95 < 1000ms, p99 < 2000ms, tasa de error < 5%, checks ≥ 95%

#### `rampup`
- **VUs**: 10→20→30→40→50 (rampa escalonada, 2m por paso, 3m rampa de bajada)
- **Duración**: ~13 minutos
- **Propósito**: Incrementar la carga gradualmente para observar el inicio de la degradación
- **Cuándo usarlo**: Validación de nuevas funcionalidades, línea base para planificación de capacidad
- **Etapas**: 2m → 10, 2m → 20, 2m → 30, 2m → 40, 2m → 50, 3m → 0
- **Duración máxima**: 20m
- **Umbrales**: p95 < 1500ms, tasa de error < 10%, checks ≥ 90%

#### `capacity`
- **VUs**: 50→100→150→200 (rampa escalonada 3m por paso, sostener 5m en 200, rampa de bajada 3m)
- **Duración**: ~20 minutos
- **Propósito**: Encontrar el throughput máximo sostenible
- **Cuándo usarlo**: Antes de lanzamientos importantes, cambios de infraestructura
- **Etapas**: 3m → 50, 3m → 100, 3m → 150, 3m → 200, 5m → 200, 3m → 0
- **Duración máxima**: 25m
- **Umbrales**: p95 < 2000ms, p99 < 5000ms, tasa de error < 15%, checks ≥ 85%

---

### Estrés
Perfiles que llevan el sistema más allá de las condiciones normales de operación.

#### `stress`
- **VUs**: 100→200→300→400→300→0 (rampa escalonada de subida y bajada, 2–5m por paso)
- **Duración**: ~25 minutos
- **Propósito**: Encontrar el punto de quiebre y observar los modos de fallo
- **Cuándo usarlo**: Pruebas de estrés trimestrales, antes de eventos de escalado
- **Etapas**: 2m → 100, 5m → 200, 5m → 300, 5m → 400, 5m → 300, 3m → 0
- **Duración máxima**: 30m
- **Umbrales**: p95 < 5000ms, tasa de error < 30%, checks ≥ 70%

#### `spike`
- **VUs**: 300 pico (precalentamiento 10 VUs 1m, pico a 300 en 30s, sostener 3m, bajar a 10 en 30s, enfriamiento 2m, rampa de bajada 1m)
- **Duración**: ~8 minutos
- **Propósito**: Probar la elasticidad del sistema ante picos repentinos de tráfico
- **Cuándo usarlo**: Antes de eventos promocionales, preparación para ventas flash
- **Etapas**: 1m → 10, 30s → 300, 3m → 300, 30s → 10, 2m → 10, 1m → 0
- **Duración máxima**: 10m
- **Umbrales**: p95 < 5000ms durante el pico, tasa de error < 25%, checks ≥ 75%

#### `breakpoint`
- **VUs**: 1000 (rampa lineal 0→1000 durante 1h)
- **Duración**: ~1 hora
- **Propósito**: Encontrar el límite absoluto del sistema
- **Cuándo usarlo**: Trimestralmente, después de cambios de infraestructura
- **Etapas**: 1h → 1000
- **Duración máxima**: 1h10m
- **Umbrales**: p95 < 60000ms, tasa de error < 50%
- **Nota**: Se esperan fallos en los umbrales — el objetivo es encontrar el límite, no superarlo

---

### Estabilidad
Perfiles de larga duración para detectar fugas de memoria y degradación gradual.

#### `soak`
- **VUs**: 20 (rampa 0→20 en 5m, sostener 4h, rampa de bajada 5m)
- **Duración**: 4 horas+
- **Propósito**: Detectar fugas de memoria, agotamiento del pool de conexiones, degradación gradual del rendimiento
- **Cuándo usarlo**: Mensualmente, antes de lanzamientos importantes
- **Etapas**: 5m → 20, 4h → 20, 5m → 0
- **Duración máxima**: 4h30m
- **Umbrales**: p95 < 1500ms, p99 < 3000ms, tasa de error < 5%, checks ≥ 95%
- **Monitorizar**: Crecimiento del RSS de memoria, uso del heap, pausas del GC, incremento gradual de p99

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=soak
```

---

### Throughput (Modelo Abierto)
Perfiles de tasa de llegada que desacoplan la tasa de solicitudes del tiempo de respuesta del servidor.

#### `throughput-low`
- **Ejecutor**: `constant-arrival-rate`
- **Tasa**: 10 iteraciones/segundo
- **Duración**: 5 minutos
- **VUs**: 20 pre-asignados, 50 máximo
- **Propósito**: Throughput constante bajo para pruebas base de modelo abierto
- **Cuándo usarlo**: Validar comportamiento de modelo abierto, pruebas de throughput base
- **Umbrales**: p95 < 2000ms, p99 < 5000ms, tasa de error < 5%, checks >= 95%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=throughput-low
```

#### `throughput-medium`
- **Ejecutor**: `constant-arrival-rate`
- **Tasa**: 50 iteraciones/segundo
- **Duración**: 5 minutos
- **VUs**: 60 pre-asignados, 150 máximo
- **Propósito**: Throughput constante medio simulando tráfico típico de producción
- **Cuándo usarlo**: Simulación realista de tráfico de producción, validación de SLA
- **Umbrales**: p95 < 1500ms, p99 < 3000ms, tasa de error < 5%, checks >= 95%

#### `throughput-high`
- **Ejecutor**: `constant-arrival-rate`
- **Tasa**: 100 iteraciones/segundo
- **Duración**: 5 minutos
- **VUs**: 120 pre-asignados, 300 máximo
- **Propósito**: Throughput constante alto para simulación de tráfico pico
- **Cuándo usarlo**: Validación de tráfico pico, verificaciones de capacidad pre-evento
- **Umbrales**: p95 < 1000ms, p99 < 2000ms, tasa de error < 5%, checks >= 95%

#### `throughput-ramp`
- **Ejecutor**: `ramping-arrival-rate`
- **Tasa**: 10→50→100 iteraciones/segundo (rampa durante 12 minutos)
- **Etapas**: 2m → 10/s, 3m → 50/s, 3m → 100/s, 2m sostenido en 100/s, 2m → 0
- **VUs**: 120 pre-asignados, 300 máximo
- **Propósito**: Throughput creciente gradual para encontrar el techo de throughput
- **Cuándo usarlo**: Planificación de capacidad, encontrar la tasa máxima sostenible de solicitudes
- **Umbrales**: p95 < 2000ms, p99 < 5000ms, tasa de error < 10%, checks >= 90%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=throughput-ramp
```

---

### Think Time Helper

Usa `ThinkTimeHelper` para agregar pausas realistas de usuario entre solicitudes:

```typescript
import { thinkTime, thinkTimeNormal, pace, THINK_TIME } from "../../src/helpers/think-time-helper";

export default function () {
  const iterStart = Date.now();

  // Pausa aleatoria uniforme: 1-3 segundos
  thinkTime(1, 3);

  // O usar presets
  thinkTime(...THINK_TIME.NORMAL);   // [1, 3]
  thinkTime(...THINK_TIME.READING);  // [3, 8]

  // Think time con distribución normal (más realista)
  thinkTimeNormal(2, 0.5);  // media=2s, desviación=0.5s

  // Pacear la iteración a duración fija (asegura throughput constante)
  pace(5000, iterStart);  // rellenar hasta 5s total
}
```

---

## Jerarquía de Umbrales

Los umbrales se aplican en orden de prioridad (los niveles posteriores reemplazan a los anteriores). Esta jerarquía de 5 niveles permite establecer valores predeterminados globales con sobreescrituras por servicio y por ejecución.

```
1. Valores predeterminados del perfil    (prioridad más baja)
        ↓ reemplazado por
2. Umbrales globales del cliente         (clients/<name>/config.json → bloque thresholds)
        ↓ reemplazado por
3. Objetivos de configuración SLO        (clients/<name>/config/slos.json → objetivos por métrica)
        ↓ reemplazado por
4. Opciones a nivel de escenario         (bloque thresholds dentro del archivo TypeScript del escenario)
        ↓ reemplazado por
5. Sobreescrituras --env por CLI         (variables de entorno K6_THRESHOLD_P95, K6_THRESHOLD_ERROR_RATE)
                                         (prioridad más alta — usar para ejecuciones puntuales)
```

**Ejemplo de resolución:**

| Nivel | Fuente | Valor p95 |
|-------|--------|-----------|
| 1 Valor predeterminado del perfil | `smoke` | < 2000ms |
| 2 Configuración del cliente | `config.json` | < 800ms |
| 3 Configuración SLO | `slos.json` payment-api | < 500ms |
| 4 Opciones del escenario | `smoke-users.ts` | < 500ms |
| 5 Variable de entorno CLI | `K6_THRESHOLD_P95=300` | **< 300ms** ← aplicado |

Umbral efectivo para la ejecución: **p95 < 300ms**

> **Consejo:** La configuración SLO (nivel 3) es el lugar recomendado para los SLOs de producción. Usa las variables de entorno por CLI (nivel 5) solo para experimentos temporales — no están bajo control de versiones.

---

## API de ProfileHelper

Usa `ProfileHelper` en los scripts de escenario para aplicar los umbrales del perfil activo de forma programática:

```typescript
// clients/my-team/scenarios/api/users.ts
import { buildOptions } from "../../lib/framework";

// Aplica los umbrales del perfil activo + sobreescrituras específicas del escenario
export const options = buildOptions({
  // Estas sobreescriben los valores predeterminados del perfil SOLO PARA ESTE escenario
  http_req_duration: ["p(99)<2000"],  // p99 más estricto para este endpoint
});

export default function () {
  // ... lógica de la prueba
}
```

### `buildOptions(overrides?)`

```typescript
function buildOptions(
  thresholdOverrides?: Record<string, string[]>
): k6.Options
```

Lee `K6_PROFILE` de `__ENV` y devuelve un objeto de opciones k6 completo con la definición de escenario del perfil y los umbrales fusionados.

### `ProfileHelper.applyProfile(profile, overrides?)`

```typescript
import { ProfileHelper } from "../../lib/profile-loader";

const helper = new ProfileHelper("load");
export const options = helper.applyProfile({
  // Sobreescrituras opcionales de umbrales
  http_req_duration: ["p(95)<300"],
});
```

### Perfiles disponibles programáticamente

```typescript
import { PROFILES, ProfileName } from "../../lib/profile-loader";

// Listar todos los perfiles
const names: ProfileName[] = Object.keys(PROFILES) as ProfileName[];
// ["smoke", "quick", "load", "rampup", "capacity", "stress", "spike", "breakpoint", "soak",
//  "throughput-low", "throughput-medium", "throughput-high", "throughput-ramp"]

// Comprobar si un perfil existe
const isValid = names.includes("custom-profile" as ProfileName); // false
```

---

## Perfiles Personalizados

Añade perfiles personalizados en `shared/profiles/`:

```json
// shared/profiles/my-custom-profile.json
{
  "name": "my-custom",
  "description": "Perfil personalizado para el servicio de pagos",
  "scenarios": {
    "default": {
      "executor": "constant-arrival-rate",
      "rate": 100,
      "timeUnit": "1s",
      "duration": "5m",
      "preAllocatedVUs": 50,
      "maxVUs": 200
    }
  },
  "thresholds": {
    "http_req_duration": ["p(95)<200", "p(99)<500"],
    "http_req_failed": ["rate<0.001"]
  }
}
```

Validar antes de usar:

```bash
node bin/validate-config.js --file=shared/profiles/my-custom-profile.json
```

Usarlo:

```bash
./bin/run-test.sh --client=my-team --scenario=api/checkout --profile=my-custom
```

---

## Modelado de Throughput (usuarios → RPS)

El framework incluye un modelo de throughput inspirado en GPT (`src/core/throughput-model.ts`, T-260)
que convierte un número objetivo de usuarios concurrentes en RPS recomendados y valores máximos de VUs,
usando las mismas constantes que la herramienta GitLab Performance Tool.

### Constantes de RPS por 1 000 usuarios

| Clase de endpoint  | RPS / 1 000 usuarios | Notas |
|--------------------|----------------------|-------|
| `"api"`            | 20                   | Llamadas a APIs REST / JSON |
| `"web"`            | 2                    | Solicitudes de página web completa |
| `"git-pull"`       | 2                    | Operaciones de git clone / fetch |
| `"git-push"`       | 0.4                  | Git push — mínimo 1 cuando usuarios > 0 |

Recomendación de VUs máximos: `min(targetRps × 5, 2000)` (convención GPT).

### API

```typescript
import { targetRpsForUsers, recommendMaxVUs, buildThroughputPlan } from "../../src";
// o también: import { targetRpsForUsers, recommendMaxVUs, buildThroughputPlan } from "@core/throughput-model";

// Clase individual
const rps = targetRpsForUsers(1000, "api");      // 20
const vus = recommendMaxVUs(rps);                // 100

// Plan completo para las cuatro clases
const plan = buildThroughputPlan(500);
// plan.perClass.api         → { targetRps: 10, recommendedMaxVUs: 50 }
// plan.perClass["git-push"] → { targetRps: 1,  recommendedMaxVUs: 5  }
```

> **Consejo:** Usa `buildThroughputPlan()` para dimensionar tus perfiles de tasa de llegada
> dado un número de usuarios conocido, y pasa el `targetRps` resultante como `rate` en un
> perfil `throughput-*`.

---

## Solución de Problemas

**Perfil no encontrado:**
```
Error: Profile 'heavy' not found. Available: smoke, quick, load, ..., throughput-low, throughput-medium, throughput-high, throughput-ramp
```
→ Verifica la ortografía o añade un perfil personalizado en `shared/profiles/`.

**Umbrales demasiado estrictos para smoke:**
→ Usa `--profile=smoke` — tiene umbrales más relajados por diseño.

**La prueba soak consume demasiados recursos:**
→ Reduce los VUs con `--env K6_SOAK_VUS=10` (si tu escenario lee esta variable de entorno).
