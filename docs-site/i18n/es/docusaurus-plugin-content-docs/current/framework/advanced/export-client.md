---
title: "Exportar Clientes"
sidebar_position: 5
---
# Exportar Clientes

Exporta un cliente del monorepo como un repositorio standalone completamente independiente que compila, verifica tipos y ejecuta tests sin necesitar el monorepo.

---

## Tabla de Contenidos

1. [Resumen](#resumen)
2. [Uso](#uso)
3. [Parametros Requeridos](#parametros-requeridos)
4. [Opciones](#opciones)
5. [Capabilities](#capabilities)
6. [Estructura del Repositorio](#estructura-del-repositorio)
7. [Reescritura de Imports](#reescritura-de-imports)
8. [Generacion de CI/CD](#generacion-de-cicd)
9. [Scaffolding de Cliente Nuevo](#scaffolding-de-cliente-nuevo)
10. [Actualizar el Framework](#actualizar-el-framework)
11. [Manifiesto de Exportacion](#manifiesto-de-exportacion)
12. [Ejemplos](#ejemplos)

---

## Resumen

El script `bin/export-client.sh` extrae un solo cliente del monorepo y produce un repositorio autocontenido con:

- Todos los archivos del cliente (`scenarios/`, `lib/`, `config/`, `data/`)
- Una copia vendorizada del framework core (`framework/`)
- Imports reescritos apuntando al directorio local `framework/`
- Archivos de configuracion generados (`package.json`, `tsconfig.json`, `webpack.config.js`, etc.)
- Un runner de tests standalone (`bin/run-test.sh`)
- Un script de actualizacion para traer nuevas versiones del framework (`bin/update-framework.sh`)

El repositorio exportado funciona de forma independiente — los destinatarios solo necesitan `npm install && npm run build` para empezar.

### Pipeline

La exportacion sigue un pipeline de 5 pasos:

1. **Validar inputs** — el cliente existe, el path de salida es valido, no hay path traversal
2. **Copiar archivos** — archivos del cliente + framework core
3. **Reescribir imports** — `../../../src/` → `../framework/src/`
4. **Generar configs** — `package.json`, `tsconfig.json`, `webpack.config.js`, `.eslintrc.json`, `.gitignore`, `README.md`
5. **Validacion post-export** — `npm install` + typecheck (opcional)

---

## Uso

```bash
./bin/export-client.sh --client <nombre> --output <ruta> [OPCIONES]
```

### Dry run (preview sin crear archivos)

```bash
./bin/export-client.sh --client=acme-client --output=/tmp/test --dry-run
```

---

## Parametros Requeridos

| Parametro | Descripcion |
|-----------|-------------|
| `--client <nombre>` | Nombre del directorio del cliente bajo `clients/`. Debe existir en el monorepo (a menos que se use `--new`). |
| `--output <ruta>` | Directorio de salida para el repositorio standalone. No debe existir a menos que se use `--force`. |

---

## Opciones

| Opcion | Descripcion |
|--------|-------------|
| `--force` | Sobrescribir el directorio de salida si ya existe. |
| `--skip-validate` | Saltar validacion post-export (`npm install` + typecheck). Util para CI o exports rapidos. |
| `--git-init` | Inicializar un repositorio git con un commit inicial en el directorio de salida. |
| `--ci <proveedor>` | Generar un workflow de CI/CD. Soportados: `github`, `gitlab`, `none` (default). |
| `--dry-run` | Mostrar que se exportaria sin crear archivos. |
| `--debug` | Habilitar logging verbose de debug. |
| `--new` | Crear un cliente nuevo desde plantillas de scaffolding y exportarlo (ver [Scaffolding de Cliente Nuevo](#scaffolding-de-cliente-nuevo)). |
| `--service <nombre>` | Nombre del servicio para el scaffolding con `--new` (default: `api`). |

---

## Capabilities

Flags opcionales para incluir herramientas extra en el repositorio exportado. Usa `--full` para habilitar todas.

| Flag | Que incluye |
|------|-------------|
| `--with-reports` | `bin/report.sh` — generador de reportes HTML |
| `--with-observability` | `bin/observability.sh` + `infrastructure/` — Grafana, Prometheus y dashboards |
| `--with-binary` | `bin/build-binary.sh` — constructor de binario standalone k6 (Go embed) |
| `--with-claude` | `.claude/` — CLAUDE.md, settings y skills para integracion con Claude Code |
| `--with-mcp` | `mcp-server/` — servidor MCP standalone para creacion de tests asistida por IA |
| `--full` | Todas las anteriores |

---

## Estructura del Repositorio

```
<output>/
├── config/                Configuracion del cliente (default.json, staging.json, etc.)
├── data/                  Archivos de datos de prueba (CSV, JSON)
├── lib/                   Services, helpers, factories del cliente
│   ├── services/
│   └── factories/
├── scenarios/             Escenarios k6 (TypeScript)
│   ├── api/               Tests de un solo endpoint
│   ├── integration/       Flujos multi-paso
│   └── mixed/             Patrones de trafico ponderado
├── framework/             Framework core (vendorizado)
│   ├── src/               Helpers, patterns, modulos core
│   ├── shared/            Profiles y schemas
│   ├── bin/               Scripts de validacion
│   └── VERSION            Version del framework al momento del export
├── bin/
│   ├── run-test.sh        Runner standalone (pipeline de 5 pasos)
│   └── update-framework.sh   Actualizar framework desde monorepo o remoto
├── package.json           Generado (con scripts build, typecheck, lint)
├── tsconfig.json          Generado (con path aliases a framework/)
├── webpack.config.js      Generado (auto-descubre scenarios/)
├── .eslintrc.json         Generado
├── .gitignore             Generado
├── README.md              Generado (con Quick Start, tabla de escenarios, estructura)
└── export-manifest.json   Metadata del export (version, fecha, conteo de archivos)
```

Con capabilities habilitadas, aparecen archivos adicionales:

| Capability | Archivos adicionales |
|-----------|---------------------|
| `--with-reports` | `bin/report.sh` |
| `--with-observability` | `bin/observability.sh`, `infrastructure/` |
| `--with-binary` | `bin/build-binary.sh` |
| `--with-claude` | `.claude/CLAUDE.md`, `.claude/settings.local.json`, `.claude/skills/` |
| `--with-mcp` | `mcp-server/` |

---

## Reescritura de Imports

Durante la exportacion, todos los imports estilo monorepo se reescriben para apuntar al directorio local `framework/`:

```typescript
// Antes (monorepo)
import { RequestHelper } from '../../../src/helpers/request';
import { retryPattern } from '../../../src/patterns/retry';

// Despues (standalone)
import { RequestHelper } from '../framework/src/helpers/request';
import { retryPattern } from '../framework/src/patterns/retry';
```

La reescritura:
- Convierte rutas relativas como `../../../src/` a `../framework/src/`
- Preserva imports locales (`./`, `../lib/`, `../config/`) sin cambios
- Preserva imports de `k6` y `k6/*` sin cambios
- Preserva imports de URLs externas (jslib) sin cambios

---

## Generacion de CI/CD

### GitHub Actions (`--ci=github`)

Genera `.github/workflows/k6.yml` con:
- Triggers en push/PR a `main` + dispatch manual con inputs de escenario/perfil
- Setup de Node.js 20 con cache de npm
- Instalacion de k6 desde repositorio APT oficial
- Pipeline de build + typecheck + ejecucion
- Upload de reportes como artifacts (retencion 30 dias)

### GitLab CI (`--ci=gitlab`)

Genera `.gitlab-ci.yml` con:
- 4 stages: `validate` → `build` → `test` → `report`
- Instalacion de k6 en `before_script`
- Artifacts de build pasados entre stages
- Artifacts de reportes con retencion de 30 dias

---

## Scaffolding de Cliente Nuevo

Usa `--new` para crear un cliente desde cero sin necesitar que exista en el monorepo:

```bash
./bin/export-client.sh --client=payments-team --new --service=payments --output=~/payments-k6
```

Esto genera:
- `config/default.json` con el nombre del servicio preconfigurado
- `lib/services/` y `lib/factories/` con archivos iniciales
- `scenarios/api/`, `scenarios/integration/`, `scenarios/mixed/` con tests de ejemplo
- Todos los archivos del framework y configs generados

El scaffolding temporal se limpia automaticamente — nada queda en el monorepo.

:::caution
`--new` fallara si ya existe un cliente con el mismo nombre en el monorepo. Para exportar un cliente existente, omite el flag `--new`.
:::

---

## Actualizar el Framework

Los repositorios exportados incluyen `bin/update-framework.sh` para traer versiones mas nuevas del framework:

```bash
# Actualizar desde un checkout local del monorepo
./bin/update-framework.sh --from=/path/to/k6-enterprise-framework --yes

# Actualizar desde un repositorio git remoto
./bin/update-framework.sh --from=github:org/k6-enterprise-framework --ref=v1.2.0
```

El script de actualizacion reemplaza solo el directorio `framework/`, preservando todos los archivos del cliente.

---

## Manifiesto de Exportacion

Cada exportacion produce un `export-manifest.json` con metadata:

```json
{
  "exportVersion": "1.0.0",
  "sourceFramework": "k6-enterprise-framework",
  "sourceVersion": "1.5.0",
  "client": "acme-client",
  "exportedAt": "2026-03-23T10:30:00Z",
  "exportedBy": "bin/export-client.sh",
  "filesExported": {
    "scenarios": 12,
    "lib": 8,
    "config": 3,
    "data": 2,
    "frameworkSrc": 45,
    "total": 70
  },
  "importsRewritten": 34,
  "capabilities": {
    "reporting": false,
    "observability": false,
    "binaryBuilder": false,
    "claude": false,
    "mcp": false
  }
}
```

Este manifiesto es usado por `update-framework.sh` para tracking de versiones y por el equipo para auditorias.

---

## Ejemplos

### Exportar un cliente existente

```bash
./bin/export-client.sh \
  --client=acme-client \
  --output=/tmp/airline-standalone
```

### Export completo con git y GitHub Actions

```bash
./bin/export-client.sh \
  --client=acme-client \
  --output=~/acme-k6 \
  --full \
  --git-init \
  --ci=github
```

### Crear un cliente nuevo desde cero

```bash
./bin/export-client.sh \
  --client=payments-team \
  --new \
  --service=payments \
  --output=~/payments-k6 \
  --git-init \
  --ci=gitlab
```

### Exportar solo con reporting y observability

```bash
./bin/export-client.sh \
  --client=_reference \
  --output=/tmp/ref-standalone \
  --with-reports \
  --with-observability \
  --force
```

### Dry run para preview

```bash
./bin/export-client.sh \
  --client=acme-client \
  --output=/tmp/test \
  --dry-run
```
