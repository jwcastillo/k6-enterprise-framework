---
title: "Client Management"
sidebar_position: 3
---
# Client Management

Estrategias para organizar clientes: monorepo, repositorios separados y mecanismos de vinculacion.

---

## Tabla de contenidos

1. [Modelo de cliente](#modelo-de-cliente)
2. [Monorepo vs repositorios separados](#monorepo-vs-repositorios-separados)
3. [Mecanismos de vinculacion](#mecanismos-de-vinculacion)
   - [Git submodules](#1-git-submodules)
   - [Symlinks locales](#2-symlinks-locales)
   - [Clonacion en CI/CD](#3-clonacion-en-cicd)
4. [Tabla comparativa](#tabla-comparativa)
5. [Aislamiento de filesystem](#aislamiento-de-filesystem)
6. [Guia de migracion](#guia-de-migracion)

---

## Modelo de cliente

Cada cliente es un directorio bajo `clients/{nombre}/` con la siguiente estructura minima:

```
clients/
  acme/
    config/
      default.json       # configuracion base del cliente
      thresholds.json    # (opcional) thresholds custom por servicio
      slos.json          # (opcional) SLOs por servicio
      rbac.json          # (opcional) roles y permisos
      chaos.json         # (opcional) inyeccion de caos
    scenarios/
      users.ts           # al menos un escenario de test
    data/                # (opcional) pools de datos CSV/JSON
    mocks/               # (opcional) configuraciones de mock server
    branding/            # (opcional) logo, colores para reportes HTML
```

Todo acceso a recursos del cliente pasa por `ClientResolver` (`src/core/client-resolver.ts`), que previene path traversal y garantiza aislamiento entre clientes.

---

## Monorepo vs repositorios separados

### Monorepo

El framework y todos los clientes viven en el mismo repositorio Git.

**Ventajas**:
- Setup inicial inmediato: `mkdir clients/nuevo-cliente`
- Un solo pipeline CI/CD para todos
- Cambios en el framework y en el cliente en el mismo PR

**Desventajas**:
- Todos los ingenieros tienen acceso al codigo de todos los clientes
- El repositorio crece con cada nuevo cliente
- No hay aislamiento de historial Git por cliente

**Recomendado cuando**: equipo pequeno, todos los clientes son internos, fase inicial del proyecto.

### Repositorios separados

El framework vive en su propio repositorio. Cada cliente tiene su propio repo (`k6-tests-{nombre-cliente}`) que se vincula al framework via submodule, symlink o clonacion CI/CD.

**Ventajas**:
- Aislamiento total: cada cliente solo ve su propio codigo
- Historial Git independiente por cliente
- Los clientes pueden actualizar el framework a su propio ritmo (cuando es submodule)

**Desventajas**:
- Setup inicial mas complejo
- Pipeline CI/CD requiere gestion de tokens de acceso

**Recomendado cuando**: clientes son organizaciones externas, se requiere confidencialidad del codigo de test.

---

## Mecanismos de vinculacion

### 1. Git submodules

El cliente vinculado como submodule de Git. El directorio `clients/{nombre}` apunta a un commit especifico del repositorio del cliente.

```bash
# Vincular un cliente como submodule
git submodule add https://github.com/org/k6-tests-acme.git clients/acme
git submodule update --init --recursive

# Actualizar a la ultima version del cliente
cd clients/acme && git pull origin main && cd ../..
git add clients/acme && git commit -m "chore: update acme submodule"
```

El framework detecta automaticamente si `clients/{nombre}` es un submodule y lo trata identicamente a un directorio regular.

**Que hacer si el submodule no esta inicializado**:
```bash
git submodule update --init clients/acme
```

### 2. Symlinks locales

Util para desarrollo local cuando el repositorio del cliente esta clonado en otra ruta.

```bash
# Clonar el repositorio del cliente en alguna ubicacion local
git clone https://github.com/org/k6-tests-acme.git ~/repos/k6-tests-acme

# Crear el symlink en clients/
ln -s ~/repos/k6-tests-acme clients/acme
```

El `ClientResolver` acepta symlinks que apunten a directorios validos con estructura de cliente. Symlinks que apunten a directorios inexistentes o al core del framework son rechazados.

### 3. Clonacion en CI/CD

El pipeline clona el repositorio del cliente antes de ejecutar los tests. No hay vinculacion persistente en el repositorio del framework.

**GitHub Actions** — usar el template en `ci-templates/github-actions-client.yml`:

```yaml
- name: Clone client repository
  uses: actions/checkout@v4
  with:
    repository: org/k6-tests-acme
    token: ${{ secrets.CLIENT_REPO_TOKEN }}
    path: clients/acme
```

**GitLab CI** — usar el template en `ci-templates/gitlab-ci-client.yml`:

```yaml
before_script:
  - git clone https://oauth2:${CLIENT_REPO_TOKEN}@gitlab.com/org/k6-tests-acme.git clients/acme
```

Los tokens de CI/CD deben tener scope minimo `read` (solo lectura del repositorio del cliente).

---

## Tabla comparativa

| Caracteristica              | Monorepo    | Submodule   | Symlink     | Clonacion CI/CD |
|-----------------------------|-------------|-------------|-------------|-----------------|
| Setup inicial               | Inmediato   | Facil       | Facil       | Medio           |
| Aislamiento de codigo       | Ninguno     | Alto        | Alto        | Alto            |
| Historial Git separado      | No          | Si          | Si          | Si              |
| Desarrollo local            | Optimo      | Bueno       | Optimo      | Requiere clone  |
| Requiere token CI/CD        | No          | No          | No          | Si              |
| Detectado automaticamente   | Si          | Si          | Si          | Si              |
| Actualizacion del framework | Manual      | Explicita   | Transparente| Automatica      |

---

## Aislamiento de filesystem

El `ClientResolver` garantiza las siguientes propiedades de seguridad:

- **Path traversal bloqueado**: `--client=../otroCliente` es rechazado antes de cualquier operacion de filesystem.
- **Symlinks controlados**: solo se aceptan symlinks cuyo target existe y cumple la estructura de cliente.
- **Errores opacos**: los mensajes de error no revelan la existencia ni las rutas de otros clientes.
- **Ejecuciones concurrentes aisladas**: Cliente A y Cliente B en ejecucion simultanea operan en namespaces de filesystem completamente separados.

```typescript
// Todo acceso a recursos de cliente debe pasar por resolveClient()
import { resolveClient } from "./src/core/client-resolver";

const ctx = resolveClient("acme");
// ctx.configDir, ctx.dataDir, ctx.scenariosDir, ctx.reportsDir, ctx.envFile
// son rutas absolutas canonicas y validadas
```

---

## Guia de migracion

Proceso para mover un cliente de monorepo a repositorio separado sin perder historial de resultados.

### Paso 1: Extraer el codigo del cliente

```bash
# Crear el nuevo repositorio del cliente
git init k6-tests-acme
cd k6-tests-acme

# Copiar la estructura del cliente
cp -r ../k6-framework/clients/acme/* .
echo "node_modules/" > .gitignore

git add -A
git commit -m "feat: initial migration from monorepo"
git remote add origin https://github.com/org/k6-tests-acme.git
git push -u origin main
```

### Paso 2: Vincular como submodule

```bash
cd ../k6-framework

# Eliminar el directorio local
git rm -r clients/acme

# Vincular como submodule
git submodule add https://github.com/org/k6-tests-acme.git clients/acme
git commit -m "chore(clients): migrate acme to separate repository"
```

### Paso 3: Preservar historial de reportes

Los reportes historicos viven en `reports/acme/`. No se migran al repositorio del cliente (permanecen en el framework). El audit log y los reportes HTML/JSON siguen siendo accesibles desde `bin/audit-query.js --client=acme`.

### Paso 4: Verificar

```bash
# Verificar que el cliente funciona identicamente tras la migracion
./bin/run-test.sh --client=acme --service=users --test=smoke
```
