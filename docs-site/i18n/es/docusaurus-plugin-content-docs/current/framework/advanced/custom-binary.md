---
title: "Binario k6 Personalizado y Módulos jslib (T-159)"
sidebar_position: 1
---
# Binario k6 Personalizado y Módulos jslib (T-159)

## Uso de un Binario k6 Personalizado (`K6_BINARY_PATH`)

Reemplaza el binario `k6` del sistema con una compilación personalizada (p. ej., compilada con extensiones xk6):

```bash
# Establece la ruta a tu binario personalizado
export K6_BINARY_PATH=./dist/binaries/my-team/linux_amd64/k6-my-team

# Ejecuta pruebas — el framework usa el binario personalizado automáticamente
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

### Restricción de directorio de confianza

Por seguridad (T-137), `K6_BINARY_PATH` debe resolverse dentro de un directorio de confianza.
Las rutas de confianza predeterminadas son:

```
/usr/local/bin
/usr/bin
/opt/k6
/opt/homebrew/bin
<project>/dist/binaries
```

Se puede sobrescribir con:
```bash
export K6_BINARY_ALLOWED_PATHS="/custom/bin:/another/path"
```

### Compilar un binario personalizado con xk6

```bash
# Instalar xk6
go install go.k6.io/xk6/cmd/xk6@latest

# Compilar con extensiones
xk6 build \
  --with github.com/grafana/xk6-redis \
  --with github.com/grafana/xk6-sql \
  --output dist/binaries/my-team/k6-custom

# Usarlo
export K6_BINARY_PATH=dist/binaries/my-team/k6-custom
./bin/run-test.sh --client=my-team --scenario=api/smoke-users
```

### Uso del binario compilado por el framework

```bash
# Compilar binario del cliente (incorpora scripts JS compilados)
./bin/build-binary.sh --client=my-team --platform=linux/amd64

# El binario es autónomo — no se necesitan archivos externos
./dist/binaries/my-team/linux_amd64/k6-my-team list-scripts
./dist/binaries/my-team/linux_amd64/k6-my-team run embedded://api/smoke-users
```

---

## Uso de Módulos jslib (T-158 / T-159)

Importa módulos de la comunidad k6 (`jslib.k6.io`) directamente desde los scripts.
Estos se obtienen en tiempo de empaquetado (webpack) — no se necesita acceso de red en tiempo de ejecución.

> **Nota sobre TypeScript**: Las importaciones remotas no tienen seguridad de tipos. Usa `// @ts-ignore`
> o agrega un archivo de declaración local `*.d.ts`.

### httpx — cliente HTTP mejorado

```typescript
// @ts-ignore — importación remota jslib, sin declaraciones TypeScript
import { Httpx } from "https://jslib.k6.io/httpx/0.1.0/index.js";

const session = new Httpx({
  baseURL: "https://api.example.com",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

export default function () {
  const res = session.get("/users");
  // httpx soporta hooks beforeRequest / afterResponse para rastreo automático
}
```

### k6-utils — utilidades auxiliares

```typescript
// @ts-ignore
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

export default function () {
  const correlationId = uuidv4();
  const res = http.get(url, {
    headers: { "X-Correlation-ID": correlationId },
  });
}
```

### Declaraciones TypeScript locales para jslib

Crea un archivo de declaración para obtener autocompletado en el IDE sin `@ts-ignore`:

```typescript
// src/types/jslib.d.ts
declare module "https://jslib.k6.io/httpx/0.1.0/index.js" {
  export class Httpx {
    constructor(params?: Record<string, unknown>);
    get(url: string, params?: Record<string, unknown>): import("k6/http").RefinedResponse<any>;
    post(url: string, body?: unknown, params?: Record<string, unknown>): import("k6/http").RefinedResponse<any>;
  }
}

declare module "https://jslib.k6.io/k6-utils/1.4.0/index.js" {
  export function uuidv4(): string;
  export function randomIntBetween(min: number, max: number): number;
  export function randomItem<T>(array: T[]): T;
}
```

### Configuración de webpack para jslib

Las URLs de jslib se tratan como externals por webpack — NO se empaquetan.
k6 las obtiene en tiempo de inicialización del script desde su caché de módulos incorporada.

```javascript
// webpack.config.js — externals de jslib (ya configurado)
externals: {
  "https://jslib.k6.io/httpx/0.1.0/index.js": "commonjs https://jslib.k6.io/httpx/0.1.0/index.js",
  "https://jslib.k6.io/k6-utils/1.4.0/index.js": "commonjs https://jslib.k6.io/k6-utils/1.4.0/index.js",
}
```

### Uso de jslib con extensiones xk6

Si tu prueba usa tanto jslib como extensiones xk6, necesitas un binario personalizado:

```bash
# Compilar binario con extensión redis
xk6 build --with github.com/grafana/xk6-redis --output ./k6-custom

# El script puede entonces usar tanto jslib COMO la extensión xk6
# import redis from "k6/x/redis";                   ← extensión xk6
# import { Httpx } from "https://jslib.k6.io/...";  ← jslib (no requiere cambio en el binario)
```

Si se importa `k6/x/redis` pero el binario no lo incluye:
```
ERRO[0000] could not initialize 'k6/x/redis': 'k6/x/redis' external module is not available
```
→ Compilar: `xk6 build --with github.com/grafana/xk6-redis`
→ Usar: `K6_BINARY_PATH=./k6-custom ./bin/run-test.sh ...`
