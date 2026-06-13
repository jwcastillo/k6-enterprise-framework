/**
 * T-112: Fixtures de TestPlan para la suite de validacion del Builder Agent
 *
 * 10+ TestPlans de complejidad variada para medir tasa de exito >= 95% (SC-100).
 */

import type { TestPlan } from "../../../types/ai.d";

const NOW = "2026-02-18T00:00:00.000Z";

const BASE_META = {
  agentVersion: "1.0.0",
  generatedAt: NOW,
  tokensUsed: { inputTokens: 100, outputTokens: 200, totalTokens: 300, estimatedCostUsd: 0.003 },
  confidence: 0.9,
};

// ---------------------------------------------------------------------------
// TP-01: GET simple — health check
// ---------------------------------------------------------------------------
export const TP_01_HEALTH_CHECK: TestPlan = {
  id: "tp-01-health-check",
  name: "health-check-load",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    { url: "/api/health", method: "GET", expectedStatus: 200, _description: "Health endpoint" },
  ],
  testTypes: ["load"],
  trafficModel: {
    executor: "ramping-vus",
    config: {
      stages: [
        { duration: "30s", target: 5 },
        { duration: "1m", target: 10 },
        { duration: "30s", target: 0 },
      ],
    },
    estimatedDurationSeconds: 120,
    thinkTimeSeconds: 1,
  },
  thresholds: { http_req_duration: ["p(95)<300"], http_req_failed: ["rate<0.01"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "none" },
  source: "text",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-02: POST autenticacion con Bearer token
// ---------------------------------------------------------------------------
export const TP_02_AUTH_LOGIN: TestPlan = {
  id: "tp-02-auth-login",
  name: "auth-login-load",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/api/auth/login",
      method: "POST",
      body: { username: "__ENV.TEST_USERNAME", password: "__ENV.TEST_PASSWORD" },
      expectedStatus: 200,
      requiresAuth: false,
      _description: "Login endpoint — retorna JWT token",
    },
    {
      url: "/api/auth/me",
      method: "GET",
      expectedStatus: 200,
      requiresAuth: true,
      _description: "Get current user — requiere Bearer token",
    },
  ],
  testTypes: ["load", "stress"],
  trafficModel: {
    executor: "ramping-vus",
    config: {
      stages: [
        { duration: "1m", target: 20 },
        { duration: "3m", target: 100 },
        { duration: "1m", target: 0 },
      ],
    },
    estimatedDurationSeconds: 300,
    thinkTimeSeconds: 2,
  },
  thresholds: { http_req_duration: ["p(95)<500"], http_req_failed: ["rate<0.01"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "bearer", envVar: "AUTH_TOKEN", _description: "JWT Bearer token" },
  source: "openapi",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-03: CRUD completo de productos
// ---------------------------------------------------------------------------
export const TP_03_CRUD_PRODUCTS: TestPlan = {
  id: "tp-03-crud-products",
  name: "products-crud-load",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    { url: "/api/products", method: "GET", expectedStatus: 200, _description: "Listar productos" },
    {
      url: "/api/products",
      method: "POST",
      body: { name: "Product Test", price: 99.99, category: "test" },
      expectedStatus: 201,
      _description: "Crear producto",
    },
    {
      url: "/api/products/1",
      method: "GET",
      expectedStatus: 200,
      _description: "Obtener producto",
    },
    {
      url: "/api/products/1",
      method: "PUT",
      body: { name: "Updated" },
      expectedStatus: 200,
      _description: "Actualizar producto",
    },
    {
      url: "/api/products/1",
      method: "DELETE",
      expectedStatus: 204,
      _description: "Eliminar producto",
    },
  ],
  testTypes: ["load"],
  trafficModel: {
    executor: "ramping-vus",
    config: {
      stages: [
        { duration: "2m", target: 20 },
        { duration: "5m", target: 50 },
        { duration: "2m", target: 0 },
      ],
    },
    estimatedDurationSeconds: 540,
    thinkTimeSeconds: 1,
  },
  thresholds: { http_req_duration: ["p(95)<800"], http_req_failed: ["rate<0.02"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "bearer", envVar: "API_TOKEN" },
  source: "openapi",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-04: E-commerce multi-paso (checkout flow)
// ---------------------------------------------------------------------------
export const TP_04_ECOMMERCE_CHECKOUT: TestPlan = {
  id: "tp-04-ecommerce-checkout",
  name: "ecommerce-checkout-flow",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/api/catalog",
      method: "GET",
      expectedStatus: 200,
      _description: "Catalogo de productos",
    },
    {
      url: "/api/cart",
      method: "POST",
      body: { productId: "{{product_id}}", quantity: 1 },
      expectedStatus: 200,
      _description: "Agregar al carrito",
    },
    { url: "/api/cart", method: "GET", expectedStatus: 200, _description: "Ver carrito" },
    {
      url: "/api/checkout",
      method: "POST",
      body: { cartId: "{{cart_id}}", paymentMethod: "card" },
      expectedStatus: 201,
      _description: "Realizar checkout",
    },
    {
      url: "/api/orders/{{order_id}}",
      method: "GET",
      expectedStatus: 200,
      _description: "Confirmar orden",
    },
  ],
  testTypes: ["load", "spike"],
  trafficModel: {
    executor: "ramping-vus",
    config: {
      stages: [
        { duration: "2m", target: 50 },
        { duration: "1m", target: 200 }, // spike
        { duration: "30s", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "1m", target: 0 },
      ],
    },
    estimatedDurationSeconds: 390,
    thinkTimeSeconds: 2,
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.05"],
    "http_req_duration{name:checkout}": ["p(99)<2000"],
  },
  dataRequirements: {
    csvFiles: [
      {
        filename: "users.csv",
        columns: ["userId", "email", "token"],
        rowsNeeded: 1000,
        _description: "Usuarios para el test",
      },
    ],
    factories: [],
  },
  authConfig: { type: "bearer", envVar: "USER_TOKEN" },
  source: "text",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-05: OAuth2 con refresh token
// ---------------------------------------------------------------------------
export const TP_05_OAUTH2: TestPlan = {
  id: "tp-05-oauth2",
  name: "oauth2-flow-load",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/oauth/token",
      method: "POST",
      body: {
        grant_type: "password",
        client_id: "__ENV.OAUTH_CLIENT_ID",
        username: "__ENV.USERNAME",
        password: "__ENV.PASSWORD",
      },
      expectedStatus: 200,
      requiresAuth: false,
      _description: "OAuth2 token endpoint",
    },
    {
      url: "/api/protected-resource",
      method: "GET",
      expectedStatus: 200,
      requiresAuth: true,
      _description: "Recurso protegido con OAuth2 token",
    },
  ],
  testTypes: ["load"],
  trafficModel: {
    executor: "constant-arrival-rate",
    config: { rate: 10, timeUnit: "1s", duration: "5m", preAllocatedVUs: 50, maxVUs: 100 },
    estimatedDurationSeconds: 300,
  },
  thresholds: { http_req_duration: ["p(95)<600"], http_req_failed: ["rate<0.01"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "oauth2", tokenUrl: "__ENV.OAUTH_TOKEN_URL", scopes: ["read", "write"] },
  source: "openapi",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-06: GraphQL queries
// ---------------------------------------------------------------------------
export const TP_06_GRAPHQL: TestPlan = {
  id: "tp-06-graphql",
  name: "graphql-api-load",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/graphql",
      method: "POST",
      body: { query: "{ users { id name email } }", variables: {} },
      expectedStatus: 200,
      _description: "GraphQL users query",
    },
    {
      url: "/graphql",
      method: "POST",
      body: {
        query: "mutation CreateUser($input: UserInput!) { createUser(input: $input) { id } }",
        variables: { input: { name: "Test User", email: "test@example.com" } },
      },
      expectedStatus: 200,
      _description: "GraphQL createUser mutation",
    },
  ],
  testTypes: ["load", "stress"],
  trafficModel: {
    executor: "ramping-arrival-rate",
    config: {
      stages: [
        { target: 10, duration: "1m" },
        { target: 50, duration: "3m" },
        { target: 10, duration: "1m" },
      ],
      preAllocatedVUs: 20,
    },
    estimatedDurationSeconds: 300,
    thinkTimeSeconds: 0.5,
  },
  thresholds: { http_req_duration: ["p(95)<1000"], http_req_failed: ["rate<0.01"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "apikey", envVar: "GRAPHQL_API_KEY" },
  source: "natural-language",
  warnings: [
    "GraphQL: verificar error codes en response body (HTTP 200 puede contener errores GraphQL)",
  ],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-07: API publica sin autenticacion (rate-limited)
// ---------------------------------------------------------------------------
export const TP_07_PUBLIC_API: TestPlan = {
  id: "tp-07-public-api",
  name: "public-api-smoke",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    { url: "/api/v1/status", method: "GET", expectedStatus: 200, _description: "API status" },
    {
      url: "/api/v1/countries",
      method: "GET",
      expectedStatus: 200,
      _description: "Lista de paises",
    },
    {
      url: "/api/v1/currencies",
      method: "GET",
      expectedStatus: 200,
      _description: "Lista de monedas",
    },
  ],
  testTypes: ["load"],
  trafficModel: {
    executor: "constant-vus",
    config: { vus: 5, duration: "2m" },
    estimatedDurationSeconds: 120,
    thinkTimeSeconds: 2,
  },
  thresholds: { http_req_duration: ["p(95)<300"], http_req_failed: ["rate<0.005"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "none" },
  source: "text",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-08: Soak test (endurance) — larga duracion
// ---------------------------------------------------------------------------
export const TP_08_SOAK: TestPlan = {
  id: "tp-08-soak",
  name: "api-soak-test",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    { url: "/api/users", method: "GET", expectedStatus: 200, _description: "Listar usuarios" },
    {
      url: "/api/users/profile",
      method: "GET",
      expectedStatus: 200,
      requiresAuth: true,
      _description: "Perfil de usuario",
    },
  ],
  testTypes: ["soak"],
  trafficModel: {
    executor: "ramping-vus",
    config: {
      stages: [
        { duration: "5m", target: 30 },
        { duration: "4h", target: 30 },
        { duration: "5m", target: 0 },
      ],
    },
    estimatedDurationSeconds: 14700,
    thinkTimeSeconds: 3,
  },
  thresholds: {
    http_req_duration: ["p(95)<400"],
    http_req_failed: ["rate<0.005"],
    vus: ["value>25"],
  },
  dataRequirements: {
    csvFiles: [
      {
        filename: "users-soak.csv",
        columns: ["userId", "token"],
        rowsNeeded: 5000,
        _description: "Pool de usuarios para soak",
      },
    ],
    factories: [],
  },
  authConfig: { type: "bearer", envVar: "AUTH_TOKEN" },
  source: "text",
  warnings: ["Soak test: duracion 4h. Ejecutar solo en entorno de staging."],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-09: Breakpoint test — incremento hasta fallo
// ---------------------------------------------------------------------------
export const TP_09_BREAKPOINT: TestPlan = {
  id: "tp-09-breakpoint",
  name: "api-breakpoint",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/api/search",
      method: "GET",
      expectedStatus: 200,
      _description: "Search endpoint (CPU intensive)",
    },
  ],
  testTypes: ["breakpoint"],
  trafficModel: {
    executor: "ramping-arrival-rate",
    config: {
      stages: [
        { target: 10, duration: "1m" },
        { target: 50, duration: "2m" },
        { target: 100, duration: "2m" },
        { target: 200, duration: "2m" },
        { target: 400, duration: "2m" },
      ],
      preAllocatedVUs: 100,
      maxVUs: 500,
    },
    estimatedDurationSeconds: 540,
  },
  thresholds: { http_req_failed: ["rate<0.1"] }, // No umbral de latencia — queremos encontrar el punto de ruptura
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "none" },
  source: "text",
  warnings: [
    "Breakpoint test: ejecutar SOLO en entorno de performance aislado. Puede saturar el servicio.",
  ],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-10: Microservicios con data pool y multi-endpoint
// ---------------------------------------------------------------------------
export const TP_10_MICROSERVICES: TestPlan = {
  id: "tp-10-microservices",
  name: "microservices-integration-load",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/api/users/__userId__",
      method: "GET",
      expectedStatus: 200,
      _description: "User service",
    },
    {
      url: "/api/orders?userId=__userId__",
      method: "GET",
      expectedStatus: 200,
      _description: "Orders service",
    },
    {
      url: "/api/inventory/__productId__",
      method: "GET",
      expectedStatus: 200,
      _description: "Inventory service",
    },
    {
      url: "/api/notifications",
      method: "POST",
      body: { userId: "__userId__", type: "email", message: "Test notification" },
      expectedStatus: 202,
      _description: "Notifications service",
    },
  ],
  testTypes: ["load", "stress"],
  trafficModel: {
    executor: "ramping-vus",
    config: {
      stages: [
        { duration: "2m", target: 25 },
        { duration: "5m", target: 100 },
        { duration: "3m", target: 100 },
        { duration: "2m", target: 0 },
      ],
    },
    estimatedDurationSeconds: 720,
    thinkTimeSeconds: 1,
  },
  thresholds: {
    http_req_duration: ["p(95)<600"],
    http_req_failed: ["rate<0.02"],
    "http_req_duration{service:orders}": ["p(99)<1000"],
  },
  dataRequirements: {
    csvFiles: [
      {
        filename: "users.csv",
        columns: ["userId", "token"],
        rowsNeeded: 500,
        _description: "Usuarios",
      },
      {
        filename: "products.csv",
        columns: ["productId", "name"],
        rowsNeeded: 200,
        _description: "Productos",
      },
    ],
    factories: [],
  },
  authConfig: { type: "bearer", envVar: "API_GATEWAY_TOKEN" },
  source: "openapi",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-11: API key en header custom
// ---------------------------------------------------------------------------
export const TP_11_APIKEY_HEADER: TestPlan = {
  id: "tp-11-apikey-header",
  name: "apikey-header-test",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/v2/data",
      method: "GET",
      headers: { "X-API-Key": "__ENV.API_KEY", Accept: "application/json" },
      expectedStatus: 200,
      _description: "Endpoint con API key en header custom",
    },
  ],
  testTypes: ["load"],
  trafficModel: {
    executor: "constant-arrival-rate",
    config: { rate: 5, timeUnit: "1s", duration: "3m", preAllocatedVUs: 20 },
    estimatedDurationSeconds: 180,
  },
  thresholds: { http_req_duration: ["p(95)<400"], http_req_failed: ["rate<0.01"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "apikey", envVar: "API_KEY" },
  source: "text",
  warnings: [],
  metadata: BASE_META,
};

// ---------------------------------------------------------------------------
// TP-12: Multipart upload (edge case)
// ---------------------------------------------------------------------------
export const TP_12_FILE_UPLOAD: TestPlan = {
  id: "tp-12-file-upload",
  name: "file-upload-load",
  baseUrl: "__ENV.BASE_URL",
  endpoints: [
    {
      url: "/api/files/upload",
      method: "POST",
      body: undefined,
      expectedStatus: 201,
      _description: "Upload de archivo — multipart/form-data",
    },
    {
      url: "/api/files/__fileId__",
      method: "GET",
      expectedStatus: 200,
      _description: "Descargar archivo",
    },
    {
      url: "/api/files/__fileId__",
      method: "DELETE",
      expectedStatus: 204,
      _description: "Eliminar archivo",
    },
  ],
  testTypes: ["load"],
  trafficModel: {
    executor: "ramping-vus",
    config: {
      stages: [
        { duration: "1m", target: 5 },
        { duration: "3m", target: 15 },
        { duration: "1m", target: 0 },
      ],
    },
    estimatedDurationSeconds: 300,
    thinkTimeSeconds: 2,
  },
  thresholds: { http_req_duration: ["p(95)<2000"], http_req_failed: ["rate<0.02"] },
  dataRequirements: { csvFiles: [], factories: [] },
  authConfig: { type: "bearer", envVar: "UPLOAD_TOKEN" },
  source: "text",
  warnings: [
    "Upload test: generacion de archivos en memoria. Ajustar tamano segun capacidad del servicio.",
  ],
  metadata: BASE_META,
};

export const ALL_TEST_PLANS: TestPlan[] = [
  TP_01_HEALTH_CHECK,
  TP_02_AUTH_LOGIN,
  TP_03_CRUD_PRODUCTS,
  TP_04_ECOMMERCE_CHECKOUT,
  TP_05_OAUTH2,
  TP_06_GRAPHQL,
  TP_07_PUBLIC_API,
  TP_08_SOAK,
  TP_09_BREAKPOINT,
  TP_10_MICROSERVICES,
  TP_11_APIKEY_HEADER,
  TP_12_FILE_UPLOAD,
];
