---
title: "Gestión de Repositorios de Cliente (T-152)"
sidebar_position: 4
---
# Gestión de Repositorios de Cliente (T-152)

El framework soporta tres estrategias para vincular repositorios de cliente.
Las tres estrategias producen un comportamiento idéntico — `bin/run-test.sh` y
`client-validator.ts` funcionan igual independientemente de cómo se haya vinculado el cliente.

Los repositorios de cliente siguen la convención de nombres: `k6-tests-<client>`.

---

## Estrategia 1 — Git Submodules (recomendada para equipos monorepo)

```bash
# Agregar un cliente como submódulo
git submodule add https://github.com/my-org/k6-tests-my-team clients/my-team

# Actualizar todos los submódulos
git submodule update --init --recursive

# Actualizar un cliente específico a la última versión
git submodule update --remote clients/my-team
```

### Entrada en .gitmodules (generada automáticamente)

```ini
[submodule "clients/my-team"]
    path = clients/my-team
    url = https://github.com/my-org/k6-tests-my-team
    branch = main
```

### CI/CD con submódulos

```yaml
# GitHub Actions
- name: Checkout with submodules
  uses: actions/checkout@v4
  with:
    submodules: recursive
    token: ${{ secrets.GH_PAT }}  # PAT con acceso a los repos de cliente
```

---

## Estrategia 2 — Symlinks (recomendada para desarrollo local)

```bash
# Vincular un repo externo que ya está clonado localmente
ln -s /path/to/k6-tests-my-team clients/my-team

# Verificar que el enlace se resuelve correctamente
ls clients/my-team/scenarios/
```

Los symlinks son transparentes para el framework — `run-test.sh` valida que
la ruta resuelta permanezca dentro de `clients/` (protección contra path-traversal T-127).

---

## Estrategia 3 — Clonación en CI/CD (recomendada para pipelines aislados)

Clonar el repositorio del cliente al inicio del pipeline, luego ejecutar las pruebas:

### GitHub Actions

```yaml
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4  # repo del framework

      - name: Clone client repo
        run: |
          git clone \
            --depth=1 \
            --branch=${BRANCH:-main} \
            https://x-access-token:${{ secrets.GH_PAT }}@github.com/my-org/k6-tests-my-team \
            clients/my-team

      - name: Run tests
        run: ./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

### GitLab CI

```yaml
load-test:
  script:
    - git clone
        --depth=1
        https://oauth2:${CI_JOB_TOKEN}@gitlab.com/my-org/k6-tests-my-team
        clients/my-team
    - ./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

---

## Configuración de .gitignore

El `.gitignore` del framework excluye todos los directorios de cliente excepto los
clientes de referencia integrados:

```gitignore
# Repos de cliente — cada uno vive en su propio repositorio
clients/*/
!clients/_reference/
!clients/_benchmark/
```

Esto significa:
- `clients/_reference/` y `clients/_benchmark/` se incluyen en el repositorio del framework
- Todos los demás directorios `clients/<name>/` se ignoran (vinculados mediante submódulo, symlink o clonación en CI)

---

## Generar un nuevo repositorio de cliente

```bash
# Crear la estructura de directorios del cliente
./bin/create-client.sh --client=my-team

# Esto crea:
#   clients/my-team/
#   ├── config/
#   │   └── config.json        (configuración del cliente)
#   ├── scenarios/             (escenarios de prueba)
#   ├── data/                  (archivos de datos de prueba)
#   └── lib/                   (helpers compartidos)
```

El nombre del repositorio generado sigue la convención `k6-tests-<client>`.

---

## Migración: monorepo → multi-repo

Si actualmente tienes código de cliente dentro del repositorio del framework y deseas
moverlo a un repositorio separado:

```bash
# 1. Crear nuevo repo en GitHub/GitLab: k6-tests-my-team

# 2. Enviar el directorio de cliente existente al nuevo repo
cd /tmp
git init k6-tests-my-team
cp -r /path/to/framework/clients/my-team/. k6-tests-my-team/
cd k6-tests-my-team
git add -A
git commit -m "chore: extract client to dedicated repo"
git remote add origin https://github.com/my-org/k6-tests-my-team
git push -u origin main

# 3. Eliminar del monorepo del framework y agregar como submódulo
cd /path/to/framework
git rm -r clients/my-team
git submodule add https://github.com/my-org/k6-tests-my-team clients/my-team
git commit -m "chore: migrate my-team client to submodule"

# 4. Verificar que las pruebas siguen pasando
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```
