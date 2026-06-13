---
title: "Ejecución Batch — US20"
sidebar_position: 2
---
# Ejecución Batch — US20

Ejecuta múltiples escenarios k6 en paralelo con un solo comando, reportes consolidados e integración CI/CD.

**Tareas:** T-055, T-056, T-057, T-058
**Scripts:** `bin/testing/run-all-tests.sh`, `bin/testing/run-parallel.js`, `bin/testing/test-summary.sh`

---

## Inicio Rápido

```bash
# Ejecutar todos los escenarios de un cliente (por defecto: 2 workers en paralelo)
bin/testing/run-all-tests.sh --client=clienteA

# Ejecutar con 4 workers en paralelo
bin/testing/run-all-tests.sh --client=clienteA --concurrency=4

# Filtrar por patrón
bin/testing/run-all-tests.sh --client=clienteA --pattern="api/*.ts"

# Excluir tests de integración (requiere bash extglob)
bin/testing/run-all-tests.sh --client=clienteA --pattern="!(integration)/*.ts"

# Ejecución en seco (listar escenarios sin ejecutar)
bin/testing/run-all-tests.sh --client=clienteA --dry-run
```

---

## Arquitectura

```
run-all-tests.sh
  │
  ├── valida la configuración del cliente (shared/schemas/client.schema.json)
  ├── descubre escenarios mediante glob
  └── delega a run-parallel.js
        │
        ├── genera hasta N procesos hijo (por defecto: 2)
        ├── cada hijo: bin/run-test.sh --client=X --scenario=Y
        ├── captura stdout/stderr por escenario
        └── escribe la salida consolidada en:
              reports/{client}/all-tests-{timestamp}/
                ├── summary.json       ← legible por máquinas
                ├── summary.md         ← legible por humanos (Markdown)
                ├── execution.log      ← logs sin procesar por escenario
                └── {scenario}/        ← reportes individuales por escenario
```

---

## run-all-tests.sh

### Opciones

| Flag | Por defecto | Descripción |
|------|-------------|-------------|
| `--client=NAME` | requerido | Nombre del cliente (debe existir en `clients/`) |
| `--pattern=GLOB` | `**/*.ts` | Patrón glob para selección de escenarios |
| `--concurrency=N` | `2` | Máximo de procesos k6 en paralelo |
| `--profile=NAME` | `smoke` | Perfil de carga: smoke, quick, load, stress |
| `--env=NAME` | `default` | Nombre de configuración de entorno |
| `--dry-run` | false | Listar escenarios sin ejecutar |
| `--no-color` | false | Deshabilitar salida con colores ANSI |

### Negación de patrones (extglob)

Los patrones de negación requieren bash `extglob`:

```bash
# Esto funciona en bash ≥4 con extglob:
bin/testing/run-all-tests.sh --client=clienteA --pattern="!(integration)/**/*.ts"

# Alternativa para shells sin extglob:
bin/testing/run-all-tests.sh --client=clienteA --pattern="api/*.ts"
bin/testing/run-all-tests.sh --client=clienteA --pattern="mixed/*.ts"
```

El script muestra una advertencia si `extglob` no está disponible en el shell actual.

### Validación de configuración

Antes de ejecutar, el script valida `clients/{client}/config/default.json` contra
`shared/schemas/client.schema.json`. Una configuración inválida aborta inmediatamente con un error claro.

---

## run-parallel.js

Ejecutor paralelo en Node.js — genera procesos hijo y gestiona el pool de ejecución.

### Uso programático

```javascript
// Desde otro script de Node.js
const { runParallel } = require("./bin/testing/run-parallel.js");

const results = await runParallel({
  client: "clienteA",
  scenarios: ["api/smoke-users.ts", "api/load-orders.ts"],
  concurrency: 3,
  profile: "load",
  env: "staging",
  outputDir: "reports/clienteA/custom-run",
});

console.log(`${results.passed}/${results.total} passed`);
```

### Concurrencia y núcleos de CPU

```
┌─────────────────────────────────────────────────────┐
│  Warning: concurrency > CPU cores detected          │
│  Requested: 8  │  Available: 4                      │
│  High concurrency may skew per-scenario metrics.    │
│  Recommended: --concurrency=4 (= CPU count)         │
└─────────────────────────────────────────────────────┘
```

El ejecutor advierte cuando `--concurrency` excede los núcleos de CPU disponibles (EC-CLI-004).
Cada proceso k6 es intensivo en CPU; la sobre-suscripción causa distorsión en las métricas.

### Manejo de SIGTERM / SIGINT

Ante una interrupción, el ejecutor:
1. Envía `SIGTERM` a todos los procesos hijo en ejecución
2. Espera hasta 5 segundos para un cierre graceful
3. Escribe un **resumen parcial** marcando:
   - Escenarios completados como `pass` / `fail`
   - Escenarios en progreso como `interrupted`
   - Escenarios pendientes como `skipped`
4. Sale con código `130` (SIGINT) o `143` (SIGTERM)

---

## Reportes consolidados

Después de que todos los escenarios se completan, el ejecutor escribe en `reports/{client}/all-tests-{timestamp}/`:

### summary.json

```json
{
  "client": "clienteA",
  "timestamp": "2026-02-17T14:30:00.000Z",
  "duration": 142.3,
  "total": 5,
  "passed": 4,
  "failed": 1,
  "interrupted": 0,
  "skipped": 0,
  "scenarios": [
    {
      "name": "api/smoke-users",
      "status": "pass",
      "exitCode": 0,
      "duration": 28.1,
      "reportPath": "reports/clienteA/api/smoke-users/2026-02-17_143000"
    }
  ]
}
```

### summary.md

Tabla legible por humanos con indicadores de pass/fail, duraciones y enlaces a reportes individuales.

### execution.log

Salida sin procesar de stdout/stderr por escenario, con prefijo `[scenario-name]` para facilitar el uso de grep:

```
[api/smoke-users] ✓ checks.........................: 100.00%
[api/load-orders] ✗ checks.........................: 94.23%
```

---

## test-summary.sh (T-073)

Regenerador independiente — útil para volver a mostrar el resumen de una ejecución anterior.

```bash
# Desde un directorio de reportes
bin/testing/test-summary.sh reports/clienteA/all-tests-2026-02-17_143000/

# Desde un summary.json específico
bin/testing/test-summary.sh reports/clienteA/smoke-users/2026-02-17_143000/k6-summary.json

# Sin argumentos: mostrar ayuda
bin/testing/test-summary.sh
```

El código de salida refleja el resultado del test: `0` = todos pasaron, `1` = alguno falló.

---

## Integración CI/CD

### GitHub Actions

```yaml
- name: Run load tests
  run: |
    bin/testing/run-all-tests.sh \
      --client=${{ inputs.client }} \
      --profile=smoke \
      --concurrency=2 \
      --no-color

- name: Upload test reports
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: k6-reports
    path: reports/${{ inputs.client }}/all-tests-*/
```

### Códigos de salida

| Código | Significado |
|--------|-------------|
| `0` | Todos los escenarios pasaron |
| `1` | Uno o más escenarios fallaron |
| `2` | Error de configuración o argumentos |
| `130` | Interrumpido (SIGINT) |
| `143` | Terminado (SIGTERM) |

---

## Casos límite

| Escenario | Comportamiento |
|-----------|----------------|
| El patrón no coincide con ningún archivo | Error con sugerencia de verificar el patrón (EC-CLI-003) |
| Concurrencia > cantidad de CPUs | Se muestra advertencia; la ejecución continúa (EC-CLI-004) |
| SIGTERM durante la ejecución | Se escribe resumen parcial; los restantes se marcan como interrumpidos (EC-CLI-005) |
| Dos ejecuciones en el mismo milisegundo | Las marcas de tiempo usan precisión de ms para evitar colisiones (EC-CLI-006) |
| Shell sin extglob | Se muestra advertencia; el patrón de negación recurre a un escaneo completo (EC-CLI-007) |
| Terminal sin ANSI | La salida se degrada automáticamente a texto plano (EC-CLI-008) |
