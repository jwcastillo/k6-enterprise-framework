---
title: "Configuración de Funcionalidades de AI"
sidebar_position: 1
---
# Configuración de Funcionalidades de AI

Los agentes de AI del framework (planner, builder, analyst, reporter, self-healing) requieren una API key de LLM para funcionar. La implementación actual usa `@anthropic-ai/sdk`, pero la resolución de la key es genérica.

## Configuración de API Key

### Orden de Resolución

La API key se resuelve en esta prioridad (gana el primero encontrado):

```
1. Parámetro del constructor  (más alto — override programático)
2. LLM_API_KEY                (recomendado — env var agnóstica al proveedor)
3. ANTHROPIC_API_KEY          (legacy — aún soportado por compatibilidad)
```

### Dónde Definir la Key

#### Opción A: Variable de Entorno (recomendado)

Agrega a tu shell profile (`~/.zshrc`, `~/.bashrc`) o exporta antes de ejecutar:

```bash
export LLM_API_KEY=sk-ant-...
```

#### Opción B: Archivo `.env` del Cliente

Crea o edita `envs/<client>.env` (gitignored):

```bash
# envs/my-team.env
LLM_API_KEY=sk-ant-api03-...
```

Luego ejecuta los tests con:

```bash
k6 run --env-file=envs/my-team.env dist/my-team/scenarios/api/users.js
```

#### Opción C: Programático

Pasa la key directamente al instanciar un agente:

```typescript
import { PlannerAgent } from "../../src/ai/agents/planner-agent";

const planner = new PlannerAgent({
  apiKey: "sk-ant-...",
});
```

### Template

El template de env de referencia está en:

```
envs/_reference.env.example
```

Cópialo para tu cliente y completa los valores:

```bash
cp envs/_reference.env.example envs/my-team.env
```

## Configuración del MCP Server

El proyecto incluye configuración del MCP server en `.mcp.json` (raíz del proyecto). Esto habilita:

1. **MCP server k6-framework** — expone recursos y herramientas del framework a clientes LLM
2. **MCP server Playwright** — habilita automatización de browser para export PDF/PNG

### Setup

Los MCP servers se configuran automáticamente cuando Claude Code abre este proyecto. No se requiere setup adicional más allá de tener el proyecto clonado.

Para usar el MCP server de k6 de forma standalone:

```bash
cd mcp-server && npm install && npm run build
```

## Export PDF/PNG

El export PDF en `bin/slo-report.js` usa **Playwright** (dependencia opcional):

```bash
npm install playwright  # si no está instalado
node bin/slo-report.js --format=pdf --month=2025-01
```

Playwright está listado como `optionalDependency` en `package.json` — no bloqueará `npm install` si falla.

## Archivos Modificados para Soporte de AI Key

| Archivo | Cambio |
|---------|--------|
| `src/ai/agents/planner-agent.ts` | Fallback `LLM_API_KEY` → `ANTHROPIC_API_KEY` |
| `src/ai/agents/builder-agent.ts` | Igual |
| `src/ai/agents/analyst-agent.ts` | Igual |
| `src/ai/agents/reporter-agent.ts` | Igual |
| `src/ai/adaptive/self-healing.ts` | Igual |
| `src/ai/poc/ai-stack-poc.ts` | Igual |
| `envs/_reference.env.example` | Agregado template `LLM_API_KEY` |
| `bin/slo-report.js` | Migrado de Puppeteer a Playwright |
| `.mcp.json` | Creado con MCP servers de k6 + Playwright |
