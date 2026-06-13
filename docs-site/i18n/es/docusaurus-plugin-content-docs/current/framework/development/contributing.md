---
title: "Guía de Contribución"
sidebar_position: 2
---
# Guía de Contribución

Lineamientos para contribuir al k6 Enterprise Load Testing Framework.

---

## Tabla de Contenidos

1. [Configuración de Desarrollo](#configuración-de-desarrollo)
2. [Estructura del Proyecto](#estructura-del-proyecto)
3. [Flujo de Desarrollo](#flujo-de-desarrollo)
4. [Convenciones de Commit](#convenciones-de-commit)
5. [Requisitos de Pruebas](#requisitos-de-pruebas)
6. [Estilo de Código](#estilo-de-código)
7. [Proceso de Pull Request](#proceso-de-pull-request)
8. [Convenciones Clave](#convenciones-clave)

---

## Configuración de Desarrollo

### Prerrequisitos

- **Node.js** >= 18
- **npm** >= 9
- **k6** >= 1.0.0 (para ejecutar pruebas)
- **Docker** y **Docker Compose** (para el stack de infraestructura)

### Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd k6-framework

# Instalar dependencias
npm install

# Verificar setup
npm run validate   # typecheck + lint
npm run test       # ejecutar tests unitarios
npm run build      # build de producción con webpack
```

### Opcional: binario xk6-redis

Si trabajas con patrones basados en Redis, compila el binario personalizado de k6:

```bash
./bin/build-binary.sh
```

### Opcional: stack de observabilidad

```bash
# Stack core (Grafana + Prometheus + Redis)
docker compose up -d

# Observabilidad completa (agrega Loki + Tempo + Pyroscope)
docker compose --profile observability up -d
```

---

## Estructura del Proyecto

```
k6-framework/
  src/
    core/           -- carga de config, CLI, validación, RBAC, SLO, secretos
    helpers/        -- request, data, date, redis, websocket, graphql, upload, browser, crypto
    patterns/       -- auth, retry, pagination, correlation, weighted, chaos, contract
    reporting/      -- reportes HTML/JSON, análisis de capacidad, visualización de tendencias
    observability/  -- monitoreo de salud, detección de overhead, Pyroscope, tracing
    metrics/        -- calculadores (performance, throughput, error, SLA, estabilidad)
    ai/             -- agentes (analyst, builder, planner, reporter), detección de anomalías
    integrations/   -- notificaciones, bot de Slack
    types/          -- definiciones de tipos TypeScript
  clients/
    _reference/     -- escenarios de ejemplo canónicos (tracked en git)
    _benchmark/     -- benchmarks de overhead del framework (tracked en git)
    examples/       -- escenarios estilo cookbook (tracked en git)
    <client>/       -- workloads reales por cliente (gitignored, repos separados)
  bin/              -- herramientas CLI
  test/             -- tests unitarios con Vitest
  docs/             -- documentación de features (EN + ES)
  infrastructure/   -- Docker Compose, dashboards de Grafana, config de Prometheus
```

### Path Aliases

| Alias | Ruta |
|-------|------|
| `@core/*` | `src/core/*` |
| `@helpers/*` | `src/helpers/*` |
| `@observability/*` | `src/observability/*` |
| `@patterns/*` | `src/patterns/*` |
| `@types-k6/*` | `src/types/*` |

---

## Flujo de Desarrollo

### Comandos Comunes

```bash
# Build
npm run build              # build de producción con webpack
npm run build:watch        # webpack en modo watch

# Type checking y linting
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint
npm run lint:fix           # ESLint con auto-fix
npm run format             # Prettier write
npm run validate           # typecheck + lint (ejecutar antes de commit)

# Testing
npm run test               # vitest run
npm run test:watch         # vitest watch
npm run test:coverage      # vitest con coverage v8

# Ejecutar tests k6
./bin/run-test.sh --client=_reference --scenario=smoke --profile=smoke
```

### Pipeline de Build

- **Webpack** auto-descubre `clients/*/scenarios/**/*.ts` como entry points
- Output: `dist/<client>/<scenario-path>.js`
- Target: `web` (runtime goja de k6, NO Node.js)
- Externals: builtins de `k6` y URLs de jslib
- CopyWebpackPlugin copia `clients/*/data/` y `clients/*/config/` a `dist/`

---

## Convenciones de Commit

Este proyecto sigue [Conventional Commits](https://www.conventionalcommits.org/). Usa `npm run commit` para un prompt interactivo con commitizen.

### Formato

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Tipos de Commit

| Tipo | Descripción |
|------|-------------|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de errores |
| `docs` | Solo cambios en documentación |
| `style` | Estilo de código (formato, punto y coma, etc.) |
| `refactor` | Cambio de código que no corrige bug ni agrega funcionalidad |
| `perf` | Mejora de rendimiento |
| `test` | Agregar o corregir tests |
| `build` | Sistema de build o dependencias externas |
| `ci` | Archivos y scripts de configuración CI |
| `chore` | Otros cambios que no modifican código fuente ni tests |
| `revert` | Revierte un commit anterior |

### Scopes

`core`, `runner`, `helpers`, `redis`, `reporting`, `metrics`, `observability`, `patterns`, `ai`, `ci`, `docs`

### Reglas

- Usar tiempo presente imperativo: "add" no "added" ni "adds"
- Sin mayúscula inicial, sin punto al final
- Máximo 100 caracteres para la línea de subject
- Referenciar issues en el footer: `Closes #123`
- Breaking changes: `BREAKING CHANGE: <descripción>` en el footer o `!` después de type/scope

### Ejemplos

```bash
# Feature
feat(patterns): add funnel pattern with drop-off tracking

# Bug fix
fix(helpers): handle null response body in RequestHelper

# Breaking change
feat(core)!: require Node.js 18+ for config loading

BREAKING CHANGE: dropped support for Node.js 16

# Docs
docs(patterns): add retry pattern usage examples
```

### Versionado Automatizado

Los tipos de commit mapean a bumps de versión:

| Tipo de Commit | Version Bump | Ejemplo |
|----------------|--------------|---------|
| `fix:` | patch | 1.0.0 -> 1.0.1 |
| `feat:` | minor | 1.0.0 -> 1.1.0 |
| `BREAKING CHANGE:` o `!` | major | 1.0.0 -> 2.0.0 |

```bash
# Bump de versión basado en el historial de commits
npm run version:bump

# Bump manual de versión
./bin/version.sh patch   # 1.2.3 -> 1.2.4
./bin/version.sh minor   # 1.2.3 -> 1.3.0
./bin/version.sh major   # 1.2.3 -> 2.0.0
```

---

## Requisitos de Pruebas

### Tests Unitarios

- Los tests usan **Vitest** con la convención `test/**/*.test.ts`
- El setup de tests está en `test/setup.ts`
- Toda nueva funcionalidad debe incluir tests unitarios
- Ejecuta `npm run test:coverage` para verificar cobertura

### Escribir Tests

```typescript
// test/helpers/data-helper.test.ts
import { describe, it, expect } from "vitest";
import { randomEmail, uuid } from "../../src/helpers/data-helper";

describe("DataHelper", () => {
  it("should generate valid email format", () => {
    const email = randomEmail();
    expect(email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it("should generate valid UUID v4", () => {
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

### Tests de Integración k6

```bash
# Ejecutar escenarios de referencia contra el output compilado
npm run test:reference
```

---

## Estilo de Código

### ESLint y Prettier

El proyecto usa ESLint para linting y Prettier para formato.

```bash
# Verificar lint
npm run lint

# Auto-fix de issues de lint
npm run lint:fix

# Formatear todos los archivos
npm run format

# Validación combinada
npm run validate   # typecheck + lint
```

### Reglas Clave de Estilo

- TypeScript en modo strict
- Sin tipos `any` (usar `unknown` + type guards)
- Preferir `const` sobre `let`
- Usar tipos de retorno explícitos en funciones exportadas
- Usar comentarios JSDoc para APIs públicas

### Restricciones del Runtime k6

El código en `src/` corre en el runtime goja de k6 (motor JS basado en Go), NO en Node.js:

- Sin módulos Node.js `fs`, `http`, `path`, `url` — usar APIs de k6 en su lugar
- Sin `async/await` en código de VU k6 (excepto con extensiones xk6 como xk6-redis)
- Usar `k6/http` para requests HTTP, `k6/crypto` para crypto
- `__ENV` para variables de entorno (no `process.env`)
- `open()` para leer archivos en tiempo de init

El código en `bin/` corre en Node.js y puede usar APIs de Node.js libremente.

---

## Proceso de Pull Request

### Antes de Enviar

1. Ejecuta la suite completa de validación:
   ```bash
   npm run validate   # typecheck + lint
   npm run test       # tests unitarios
   npm run build      # verificar que el build pasa
   ```

2. Asegúrate de que todo código nuevo tenga tests

3. Actualiza la documentación si agregas funcionalidades nuevas:
   - Docs en dos idiomas: `.md` para EN, `.es.md` para ES en `docs/`
   - Actualiza los docs existentes relevantes si cambia el comportamiento

4. Sigue las convenciones de commit descritas arriba

### Lineamientos para PR

- Mantén los PRs enfocados — una funcionalidad o fix por PR
- Escribe una descripción clara explicando el "por qué"
- Incluye un plan de pruebas con pasos para verificar los cambios
- Referencia los issues relacionados en la descripción del PR

### Checklist de Revisión

- [ ] El código sigue el estilo del proyecto (ESLint/Prettier pasan)
- [ ] TypeScript compila sin errores
- [ ] Los tests unitarios pasan y cubren el código nuevo
- [ ] Documentación actualizada si era necesario
- [ ] Sin secretos o credenciales hardcodeadas
- [ ] Compatibilidad con runtime k6 verificada (sin APIs solo de Node.js en `src/`)

---

## Convenciones Clave

### Aislamiento de Cliente

- Cada cliente tiene sus propios directorios `config/`, `data/` y `scenarios/` bajo `clients/<name>/`
- Los directorios de cliente (excepto `_reference`, `_benchmark`, `examples`) están gitignored
- Configuraciones de entorno: `envs/<client>.env` (gitignored), `envs/<client>.env.example` (tracked)

### Documentación

- Dos idiomas: `.md` para inglés, `.es.md` para español en `docs/`
- Usa el estilo existente de docs: header con toggle de idioma, tabla de contenidos, líneas horizontales entre secciones

### Escenarios

- Los escenarios importan desde `../../src` (relativo) o vía path aliases (`@core/*`, `@helpers/*`, etc.)
- Cada escenario es un archivo TypeScript bajo `clients/<name>/scenarios/`
- Webpack los auto-descubre y bundlea como entry points separados

### Workflow speckit

Para desarrollo de features usando speckit:
- Las specs viven bajo `specs/<feature-id>/`
- Workflow: specify > clarify > plan > tasks > analyze > checklist > implement > taskstoissues

---

## Documentación Relacionada

- [Workflow](/es/docs/framework/workflow) -- workflow end-to-end de ejecución de pruebas
- [Test Types](/es/docs/framework/test-types) -- tipos de pruebas y perfiles soportados
- [Client Management](/es/docs/framework/advanced/client-management) -- crear y gestionar clientes
- [Code Quality](/es/docs/framework/development/code-quality) -- estándares de calidad y enforcement
