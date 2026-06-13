#!/usr/bin/env node
/**
 * T-108: CLI para indexacion de la base de conocimiento semantica en ChromaDB
 *
 * Uso:
 *   node bin/ai/index-knowledge-base.js --full
 *   node bin/ai/index-knowledge-base.js --incremental
 *   node bin/ai/index-knowledge-base.js --full --client=acme-corp
 *   node bin/ai/index-knowledge-base.js --stats
 *   node bin/ai/index-knowledge-base.js --search="autenticacion OAuth2" --top-k=5
 *
 * Variables de entorno:
 *   CHROMA_HOST   — host de ChromaDB (default: localhost)
 *   CHROMA_PORT   — puerto de ChromaDB (default: 8000)
 *
 * Prerrequisitos:
 *   docker compose --profile ai up chromadb
 *   npm install chromadb
 *
 * FR-175 | CHK-API-374, CHK-API-375, CHK-API-376
 */

"use strict";

const path = require("path");
const { KnowledgeBaseManager } = require("../../dist/ai/knowledge-base/knowledge-base");

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const flag = args.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.split("=").slice(1).join("=") : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const MODE_FULL = hasFlag("full");
const MODE_INCREMENTAL = hasFlag("incremental");
const MODE_STATS = hasFlag("stats");
const MODE_SEARCH = getArg("search");
const MODE_DELETE = getArg("delete-collection");
const CLIENT_ID = getArg("client");
const TOP_K = parseInt(getArg("top-k") ?? "5", 10);
const VERBOSE = hasFlag("verbose") || hasFlag("v");

if (!MODE_FULL && !MODE_INCREMENTAL && !MODE_STATS && !MODE_SEARCH && !MODE_DELETE) {
  console.error(`
k6 Enterprise Framework — Indexador de Base de Conocimiento (T-108)

Uso:
  node bin/ai/index-knowledge-base.js --full              Re-indexar todo
  node bin/ai/index-knowledge-base.js --incremental       Solo archivos modificados
  node bin/ai/index-knowledge-base.js --stats             Ver estadisticas de colecciones
  node bin/ai/index-knowledge-base.js --search="<query>"  Buscar documentos similares
  node bin/ai/index-knowledge-base.js --delete-collection=<name>  Eliminar coleccion

Opciones:
  --client=<id>    Indexar en coleccion privada del cliente (multi-tenant)
  --top-k=<n>      Numero de resultados en busqueda (default: 5)
  --verbose        Output detallado

Ejemplos:
  node bin/ai/index-knowledge-base.js --full --verbose
  node bin/ai/index-knowledge-base.js --incremental --client=acme-corp
  node bin/ai/index-knowledge-base.js --search="como hacer autenticacion OAuth2"
  node bin/ai/index-knowledge-base.js --stats
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const manager = new KnowledgeBaseManager({
    frameworkRoot: path.resolve(__dirname, "../.."),
  });

  // ── Estadisticas ──────────────────────────────────────────────────────────
  if (MODE_STATS) {
    console.log("\nEstadisticas de la base de conocimiento:\n");
    const collections = await manager.listCollections();
    if (collections.length === 0) {
      console.log("  No hay colecciones indexadas aun.");
      console.log("  Ejecuta: node bin/ai/index-knowledge-base.js --full");
    } else {
      for (const name of collections) {
        const stats = await manager.getCollectionStats(name);
        console.log(`  ${stats.name}: ${stats.count} documentos`);
      }
    }
    console.log();
    return;
  }

  // ── Busqueda ──────────────────────────────────────────────────────────────
  if (MODE_SEARCH) {
    console.log(`\nBuscando: "${MODE_SEARCH}" (top-${TOP_K})\n`);
    const ctx = CLIENT_ID
      ? await manager.searchWithClientContext(MODE_SEARCH, CLIENT_ID, TOP_K)
      : await manager.search(MODE_SEARCH, { topK: TOP_K });

    if (ctx.documents.length === 0) {
      console.log("  Sin resultados. Asegurate de indexar primero con --full.");
    } else {
      console.log(`  Coleccion: ${ctx.collection} (${ctx.totalDocumentsInCollection} docs)`);
      console.log(`  Latencia: ${ctx.searchLatencyMs}ms\n`);
      ctx.documents.forEach((doc, i) => {
        const score = (doc.similarityScore * 100).toFixed(1);
        console.log(`  [${i + 1}] ${doc.metadata.path} (${doc.metadata.type}) — score: ${score}%`);
        console.log(`      ${doc.metadata.description}`);
        if (VERBOSE) {
          console.log(`      Preview: ${doc.content.slice(0, 200).replace(/\n/g, " ")}...`);
        }
        console.log();
      });
    }
    return;
  }

  // ── Eliminar coleccion ────────────────────────────────────────────────────
  if (MODE_DELETE) {
    process.stdout.write(`Eliminando coleccion '${MODE_DELETE}'... `);
    try {
      await manager.deleteCollection(MODE_DELETE);
      console.log("OK");
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Indexacion completa o incremental ─────────────────────────────────────
  const mode = MODE_FULL ? "full" : "incremental";
  const clientLabel = CLIENT_ID ? ` (cliente: ${CLIENT_ID})` : "";
  console.log(`\nIndexando base de conocimiento [${mode}]${clientLabel}...\n`);

  const result = await manager.indexFramework({
    full: MODE_FULL,
    incremental: MODE_INCREMENTAL,
    clientId: CLIENT_ID ?? undefined,
    verbose: VERBOSE,
  });

  // Reporte
  console.log("\n" + "─".repeat(50));
  console.log("Resultado de indexacion:");
  console.log(`  Agregados  : ${result.added}`);
  console.log(`  Actualizados: ${result.updated}`);
  console.log(`  Omitidos   : ${result.skipped}`);
  console.log(`  Errores    : ${result.errors.length}`);
  console.log(`  Duracion   : ${result.durationMs}ms`);

  if (result.errors.length > 0) {
    console.log("\nErrores:");
    result.errors.forEach((e) => console.log(`  ✗ ${e}`));
  }

  console.log("─".repeat(50));
  if (result.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error fatal:", err.message ?? err);
  if (err.code === "ECONNREFUSED") {
    console.error("\nChromaDB no disponible. Asegurate de ejecutar:");
    console.error("  docker compose --profile ai up chromadb");
  }
  process.exit(1);
});
