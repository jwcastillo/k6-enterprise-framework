---
title: "Guía de Soporte de Datos Redis"
sidebar_position: 2
---
# Guía de Soporte de Datos Redis

<!-- T-103: Documentacion de Redis y datos de test -->

Esta guía cubre el uso de Redis para la gestión dinámica de datos de prueba en pruebas de carga k6 — pools de usuarios, limitación de tasa distribuida, estadísticas en tiempo real y coordinación de datos entre Usuarios Virtuales (VUs).

---

## Tabla de Contenidos

1. [Referencia Rápida](#1-referencia-rápida)
2. [Configuración e Instalación](#2-configuración-e-instalación)
3. [Patrones Reutilizables](#3-patrones-reutilizables)
4. [Flujo de Trabajo Recomendado](#4-flujo-de-trabajo-recomendado)
5. [Formatos de Archivos de Datos](#5-formatos-de-archivos-de-datos)
6. [Mejores Prácticas](#6-mejores-prácticas)
7. [Solución de Problemas](#7-solución-de-problemas)

---

## 1. Referencia Rápida

Todas las operaciones provienen de `RedisHelper`. Importa en tu script de k6:

```typescript
import { RedisHelper } from '../../src/helpers/redis-helper';
const redis = new RedisHelper(); // usa la variable de entorno REDIS_URL
```

### Operaciones Básicas

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `set(key, value, ttl?)` | Establece un valor de cadena, TTL opcional en segundos | `await redis.set('token:abc', 'value', 3600)` |
| `get(key)` | Obtiene un valor de cadena (null si no existe) | `await redis.get('token:abc')` |
| `del(...keys)` | Elimina una o más claves | `await redis.del('key1', 'key2')` |
| `exists(key)` | Verifica si una clave existe | `await redis.exists('user:1')` |
| `expire(key, ttl)` | Establece TTL en una clave existente | `await redis.expire('session:x', 1800)` |
| `ttl(key)` | Obtiene el TTL restante en segundos | `await redis.ttl('token:abc')` |

### Operaciones con Múltiples Claves

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `mset(pairs)` | Establece múltiples claves atómicamente | `await redis.mset({ 'a': '1', 'b': '2' })` |
| `mget(keys[])` | Obtiene múltiples valores en una sola llamada | `await redis.mget(['key1', 'key2'])` |

### Contadores (Atómicos)

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `incr(key)` | Incrementa en 1, retorna el nuevo valor | `await redis.incr('stats:requests')` |
| `incrby(key, n)` | Incrementa en n | `await redis.incrby('stats:latency', 245)` |

### Listas

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `lpush(key, ...values)` | Inserta a la IZQUIERDA de la lista | `await redis.lpush('queue:ids', 'id1', 'id2')` |
| `rpush(key, ...values)` | Inserta a la DERECHA de la lista | `await redis.rpush('user:ids', 'u1')` |
| `lpop(key)` | Extrae de la IZQUIERDA | `await redis.lpop('queue:ids')` |
| `rpop(key)` | Extrae de la DERECHA | `await redis.rpop('queue:ids')` |
| `llen(key)` | Obtiene la longitud de la lista | `await redis.llen('user:ids')` |
| `lrange(key, start, stop)` | Obtiene un rango (0,-1 = todos) | `await redis.lrange('user:ids', 0, -1)` |

### Hashes

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `hset(key, field, value)` | Establece un campo | `await redis.hset('user:1', 'email', 'a@b.com')` |
| `hmset(key, fields)` | Establece múltiples campos | `await redis.hmset('user:1', { email: 'a@b.com', name: 'Ana' })` |
| `hget(key, field)` | Obtiene un campo | `await redis.hget('user:1', 'email')` |
| `hgetall(key)` | Obtiene todos los campos como objeto | `await redis.hgetall('user:1')` |
| `hdel(key, ...fields)` | Elimina campos | `await redis.hdel('user:1', 'temp_field')` |

### Conexión

| Método | Descripción |
|--------|-------------|
| `disconnect()` | Cierra la conexión de forma segura — siempre llámalo en `teardown()` |

---

## 2. Configuración e Instalación

### 2.1 Local (sin Docker)

```bash
# Iniciar Redis localmente
brew install redis && brew services start redis
# o
docker run -d -p 6379:6379 redis:7-alpine

# Establecer URL de conexión
export REDIS_URL=redis://localhost:6379

# Ejecutar tu prueba
k6 run --env REDIS_URL=redis://localhost:6379 my-test.ts
```

### 2.2 Docker Compose (con perfil Redis)

```bash
# Iniciar el stack completo con Redis
docker compose --profile redis up -d

# REDIS_URL se inyecta automáticamente como redis://redis:6379
docker compose --profile redis --profile run up k6
```

El puerto de Redis (6379) NO está expuesto al host — solo es accesible dentro de la red Docker `k6-net`.

### 2.3 Con Autenticación

```bash
# Archivo .env (nunca hagas commit de credenciales)
REDIS_PASSWORD=mysecretpassword

# La REDIS_URL se construye automáticamente como: redis://:mysecretpassword@redis:6379
# O establécela explícitamente:
export REDIS_URL=redis://:mysecretpassword@localhost:6379
```

```typescript
// En tu script de k6 — las credenciales se enmascaran automáticamente en los logs
const redis = new RedisHelper();
// Logs: [RedisHelper] Connected to redis://***:***@localhost:6379
```

### 2.4 URL Explícita en el Constructor

```typescript
// Sobrescribir REDIS_URL para un script específico
const redis = new RedisHelper({ url: 'redis://:password@my-redis-host:6379' });
```

---

## 3. Patrones Reutilizables

### Patrón 1: Pool de Usuarios

Asigna datos de prueba únicos a cada VU sin colisiones.

```
┌─────────────────────────────────────────────┐
│              Redis                          │
│  user:0  →  { email: "a@b.com", ... }       │
│  user:1  →  { email: "c@d.com", ... }       │
│  user:2  →  { email: "e@f.com", ... }       │
│  user:_meta:size  →  "3"                    │
└─────────────────────────────────────────────┘
         ↑                    ↑
      VU 1 → user:0       VU 2 → user:1
      (index = VU-1 % poolSize)
```

```typescript
import { UserPool } from '../../src/patterns/redis-patterns';

// setup(): cargar 500 usuarios
export function setup() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:', policy: 'recycle' });
  await pool.load(usersArray);          // almacena user:0 ... user:499
  redis.disconnect();
}

// default(): cada VU obtiene su propio usuario (sin colisiones)
export default function() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:' });
  const user = await pool.getForVU(__VU, __ITER);
  // VU 1 → user:0, VU 2 → user:1, VU 501 → user:0 (recicla)
  redis.disconnect();
}

// teardown(): limpieza
export function teardown() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:' });
  await pool.cleanup();   // elimina todas las claves user:*
  redis.disconnect();
}
```

**Cuando los VUs > tamaño del pool:** Los VUs dan la vuelta y reutilizan datos (policy: `'recycle'`). Documenta esto en tu reporte de prueba. Usa policy `'error'` para fallar en su lugar.

### Patrón 2: Limitador de Tasa Distribuido

Coordina la tasa de solicitudes entre TODOS los VUs usando contadores atómicos.

```
┌─────────────────────────────────────────────┐
│              Redis                          │
│  rate:payment:20260218_0200  →  "47"        │
│  (expira en 13 segundos)                    │
└─────────────────────────────────────────────┘
         ↑
   Todos los VUs incrementan este contador atómicamente.
   Si count > maxPerMinute → la solicitud se omite.
```

```typescript
import { DistributedRateLimiter } from '../../src/patterns/redis-patterns';

export default function() {
  const redis = new RedisHelper();
  const limiter = new DistributedRateLimiter(redis, 'payment-api', 100); // 100 req/min máximo

  if (!(await limiter.allow())) {
    console.log('Límite de tasa alcanzado — omitiendo iteración');
    redis.disconnect();
    return;
  }

  // ... hacer solicitud
  redis.disconnect();
}
```

**Precisión:** ±2% en alta concurrencia (`INCR` atómico garantiza que no se pierdan conteos).

### Patrón 3: Contadores de Estadísticas en Tiempo Real

Contadores atómicos para métricas en vivo durante la ejecución de pruebas, consultables mientras la prueba se ejecuta.

```
┌─────────────────────────────────────────────┐
│              Redis                          │
│  stats:checkout:requests  →  "1247"         │
│  stats:checkout:errors    →  "3"            │
│  stats:checkout:latency_ms →  "312750"      │
└─────────────────────────────────────────────┘
```

```typescript
import { StatsCounter } from '../../src/patterns/redis-patterns';

export default function() {
  const redis = new RedisHelper();
  const stats = new StatsCounter(redis, 'checkout');

  await stats.inc('requests');

  const res = http.get('https://api.example.com/checkout');
  if (res.status !== 200) await stats.inc('errors');
  await stats.incBy('latency_ms', res.timings.duration);

  redis.disconnect();
}

// Consultar estadísticas en vivo desde fuera de la prueba:
// redis-cli get stats:checkout:requests
// → "1247"
```

---

## 4. Flujo de Trabajo Recomendado

```
Paso 1: Preparar archivos de datos
  users.csv, products.json

Paso 2: Cargar en Redis (antes de la prueba)
  node bin/load-redis-data.js --users=./data/users.csv --products=./data/products.json --clear

Paso 3: Ejecutar prueba k6
  k6 run --env REDIS_URL=redis://localhost:6379 my-test.ts

Paso 4: (Opcional) Consultar estadísticas en vivo durante la prueba
  redis-cli get stats:my-test:requests

Paso 5: Limpiar después de la prueba
  node bin/clean-redis-data.js --all
  # o automáticamente vía teardown() en el script de k6
```

### Script de Pre-carga

```bash
# Cargar todos los datos y limpiar claves antiguas
node bin/load-redis-data.js \
  --users=clients/my-service/data/users.csv \
  --products=clients/my-service/data/products.json \
  --clear \
  --redis=redis://localhost:6379

# Salida:
#   ✓ Users: 1000 records found
#   ✓ Products: 250 records found
#   ✓ Cleared 1250 keys with prefix "user:"
#   ✓ Loaded 1000 user records
#   ✓ Loaded 250 product records
#   Total loaded: 1250 keys
```

### Script de Limpieza

```bash
# Eliminar prefijo específico
node bin/clean-redis-data.js --pattern="user:*" --yes

# Eliminar todas las claves gestionadas por el framework
node bin/clean-redis-data.js --all --yes

# Ejecución en seco (mostrar qué se eliminaría)
node bin/clean-redis-data.js --all --dry-run
```

---

## 5. Formatos de Archivos de Datos

### 5.1 CSV (para usuarios, sesiones)

```csv
id,email,password,role
1,alice@example.com,pass123,admin
2,bob@example.com,pass456,user
3,carol@example.com,pass789,user
```

- La primera fila = encabezados de columna (nombres de campo en el hash de Redis)
- Las filas vacías se omiten con una advertencia
- Las columnas faltantes usan cadena vacía (no un error)
- Los caracteres especiales dentro de campos entre comillas se manejan correctamente: `"name with, comma"`

**Análisis en k6 (SharedArray):**
```typescript
import { SharedArray } from 'k6/data';
import { parseCsv } from '../../src/patterns/redis-patterns';

const users = new SharedArray('users', function() {
  return parseCsv(open('./data/users.csv'));
});
// → [{ id: '1', email: 'alice@example.com', password: 'pass123', role: 'admin' }, ...]
```

### 5.2 JSON (para productos, configuraciones)

```json
[
  { "id": "p1", "name": "Widget A", "price": "9.99", "category": "tools" },
  { "id": "p2", "name": "Widget B", "price": "19.99", "category": "tools" }
]
```

- Debe ser un **array** JSON (no un objeto)
- Todos los valores se almacenan como cadenas en Redis (los números se convierten automáticamente)
- Los objetos anidados no están soportados — aplana antes de cargar

**Análisis en k6 (SharedArray):**
```typescript
const products = new SharedArray('products', function() {
  return JSON.parse(open('./data/products.json'));
});
```

---

## 6. Mejores Prácticas

### ✅ HAZ

```typescript
// Usa TTL para datos sensibles (CHK-SEC-105)
await redis.set('token:user123', authToken, 3600); // expira en 1 hora

// Usa claves con namespace para evitar colisiones (CHK-API-346)
await redis.set('user:1:profile', value);     // namespace de usuario
await redis.incr('stats:checkout:requests');  // namespace de estadísticas

// Usa INCR para contadores (atómico — sin condiciones de carrera)
await redis.incr('stats:errors');

// Siempre desconecta en teardown (previene fugas de conexión)
export function teardown() {
  redis.disconnect();
}

// Usa SharedArray para conjuntos de datos grandes (se analiza una vez, se comparte entre VUs)
const users = new SharedArray('users', () => parseCsv(open('./users.csv')));
```

### ❌ NO HAGAS

```typescript
// No uses GET+SET para contadores (condición de carrera bajo VUs concurrentes)
const count = await redis.get('counter');
await redis.set('counter', String(Number(count) + 1)); // ❌ condición de carrera

// No almacenes valores > 1MB (degrada el rendimiento de Redis)
await redis.set('huge:blob', JSON.stringify(massiveObject)); // ❌

// No realices operaciones Redis en el bucle de VU sin desconectar
export default function() {
  const redis = new RedisHelper(); // conecta en cada iteración — ¡costoso!
  // ...
  // falta redis.disconnect() ❌
}

// Mejor: conecta una vez en setup, usa patrón de conexión local al VU
// No uses patrones síncronos en la función default de k6
// Todas las operaciones de redis deben ser esperadas con await
```

### Convenciones de Nombres de Claves

| Prefijo | Propósito | Ejemplo |
|---------|-----------|---------|
| `user:` | Hashes del pool de usuarios | `user:42` |
| `product:` | Hashes de productos | `product:p1` |
| `token:` | Tokens de autenticación (TTL automático 1h) | `token:session-abc` |
| `rate:` | Contadores del limitador de tasa | `rate:payment:20260218_0200` |
| `stats:` | Contadores de estadísticas de prueba | `stats:checkout:requests` |
| `config:` | Valores de configuración en tiempo de ejecución | `config:feature_flags` |

### Límites de Tamaño

| Escenario | Recomendación |
|-----------|---------------|
| Valores de cadena | < 512KB por valor |
| Campos de hash | < 100 campos por hash para rendimiento |
| Listas | Usa `lrange(0, 99)` para paginación con listas grandes |
| Tamaño máximo de valor | Advertencia a 1MB, >10MB no recomendado |

---

## 7. Solución de Problemas

### Error: "xk6-redis binary required"

```
[RedisHelper] Failed to connect to redis://localhost:6379.
Ensure you are using a k6 binary compiled with xk6-redis.
```

**Solución:** Compila el binario personalizado:
```bash
./bin/build-binary.sh
# Luego ejecuta con:
./dist/binaries/my-client/k6-my-client run my-test.ts
```

### Error: "Cannot connect to Redis"

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Opciones de solución:**
```bash
# Opción 1: Iniciar Redis localmente
brew services start redis       # macOS
sudo systemctl start redis      # Linux

# Opción 2: Iniciar Redis vía Docker
docker run -d -p 6379:6379 redis:7-alpine

# Opción 3: Usar perfil de Docker Compose
docker compose --profile redis up -d
```

### Error: "hgetall: WRONGTYPE Operation against wrong key type"

```
[RedisHelper] hgetall("user:1"): key is not a hash type. Use get() for string keys.
```

**Solución:** La clave existe pero fue almacenada como cadena, no como hash. Verifica tu llamada a `load-redis-data.js`. Usa `redis.get(key)` para claves de tipo cadena.

### Error: "Pool is empty. Call load() in setup() first."

El pool de usuarios no fue cargado antes de que `default()` se ejecutara.

**Solución:** Asegúrate de que `setup()` llame a `pool.load(users)` antes de que la prueba comience:
```typescript
export function setup() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:' });
  await pool.load(allUsers); // ← esto debe completarse antes de que default() se ejecute
  redis.disconnect();
}
```

### Error: "File not found: ./data/users.csv" (en load-redis-data.js)

```
Error: File not found: ./data/users.csv
```

**Solución:** Ejecuta `load-redis-data.js` desde el directorio `k6-framework/`, o usa rutas absolutas:
```bash
cd k6-framework
node bin/load-redis-data.js --users=clients/my-service/data/users.csv
```

### Error: "ioredis is not installed"

```
Error: ioredis is not installed. Install it with: npm install ioredis
```

**Solución:**
```bash
cd k6-framework && npm install
# ioredis está listado en las dependencias de package.json
```

### Timeout durante la prueba (operaciones Redis lentas)

- Verifica la memoria de Redis: `redis-cli info memory`
- Verifica el conteo de conexiones: `redis-cli info clients`
- Usa `redis.mget([keys])` en lugar de múltiples llamadas individuales a `get()`
- Evita `lrange(key, 0, -1)` en listas muy grandes — usa paginación
- Asegúrate de usar `SharedArray` para datos analizados en el contexto init (no en el bucle de VU)
