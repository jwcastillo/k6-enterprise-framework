/**
 * T-108: Base de conocimiento semantica — modulo de gestion
 *
 * Gestiona indexacion, busqueda por similitud y actualizacion incremental
 * de documentos en ChromaDB. Soporta:
 *   - Indexacion de scripts .ts, docs .md, helpers
 *   - Colecciones separadas por cliente (aislamiento multi-tenant, CHK-SEC-115)
 *   - Busqueda por similitud en lenguaje natural
 *   - Re-indexacion completa e incremental
 *
 * FR-175 | CHK-API-374, CHK-API-375, CHK-API-376, CHK-SEC-115
 *
 * AI-04 (D-16..D-19): Removed ts-ignore; local chromadb.d.ts shim resolves the type.
 * ChromaDB unavailability now emits explicit warn (default) or throws (K6_AI_REQUIRE_RAG=true).
 */

import { ChromaClient, Collection, IncludeEnum } from "chromadb";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { RAGContext, RAGDocument } from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type DocumentType = "script" | "doc" | "helper" | "pattern";

export interface KnowledgeDocument {
  id: string;
  content: string;
  type: DocumentType;
  /** Path relativo a la raiz del framework */
  relativePath: string;
  description: string;
  /** Hash SHA-256 del contenido para indexacion incremental */
  contentHash: string;
  /** ID del cliente si es documento privado (multi-tenant) */
  clientId?: string;
  /** Timestamp de ultima modificacion */
  lastModified: string;
}

export interface IndexOptions {
  /** Re-indexar todos los archivos ignorando cambios */
  full?: boolean;
  /** Solo indexar archivos modificados desde ultima indexacion */
  incremental?: boolean;
  /** ID del cliente para coleccion privada */
  clientId?: string;
  /** Mostrar output verbose */
  verbose?: boolean;
}

export interface IndexResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

export interface SearchOptions {
  topK?: number;
  /** Filtrar por tipo de documento */
  type?: DocumentType;
  /** Solo buscar en coleccion del cliente (multi-tenant) */
  clientId?: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Nombre de coleccion global (documentos publicos del framework) */
const GLOBAL_COLLECTION = "k6-framework-global";
/** Prefijo para colecciones privadas de clientes */
const CLIENT_COLLECTION_PREFIX = "k6-client-";
/** Longitud maxima de chunk para documentos grandes */
const MAX_CHUNK_SIZE = 2000;
/** Overlap entre chunks en caracteres */
const CHUNK_OVERLAP = 200;

// ---------------------------------------------------------------------------
// KnowledgeBaseManager
// ---------------------------------------------------------------------------

export class KnowledgeBaseManager {
  private readonly chroma: ChromaClient | null;
  private readonly frameworkRoot: string;
  /** AI-04 (D-16): true when ChromaDB is unavailable and operating in degraded mode */
  private degraded: boolean = false;

  constructor(options?: { chromaHost?: string; chromaPort?: number; frameworkRoot?: string }) {
    const host = options?.chromaHost ?? process.env.CHROMA_HOST ?? "localhost";
    const port = options?.chromaPort ?? parseInt(process.env.CHROMA_PORT ?? "8000", 10);
    this.frameworkRoot = options?.frameworkRoot ?? path.resolve(__dirname, "../../../..");

    try {
      this.chroma = new ChromaClient({ path: `http://${host}:${port}` });
    } catch (err) {
      this.chroma = null;
      this.handleChromaUnavailable(host, port, err);
    }
  }

  /**
   * AI-04 (D-16/D-17): Handle ChromaDB unavailability.
   * - Default: emit exact D-16 warning and set degraded = true.
   * - K6_AI_REQUIRE_RAG=true: throw exact D-17 error.
   * Warning message contains only host + port — no prompts, embeddings, or API keys (T-05-20).
   */
  private handleChromaUnavailable(host: string, port: number, _err: unknown): void {
    const requireRag = process.env.K6_AI_REQUIRE_RAG === "true";
    if (requireRag) {
      throw new Error(
        `RAG required (K6_AI_REQUIRE_RAG=true) but ChromaDB at ${host}:${port} is unreachable`
      );
    }
    this.degraded = true;
    console.warn(
      `[knowledge-base] ChromaDB unavailable at ${host}:${port} — RAG disabled, planner running without retrieval context. Set K6_AI_REQUIRE_RAG=true to fail-hard instead.`
    );
  }

  /**
   * AI-04 (D-22 / T-05-22): Expose degraded state for programmatic branching
   * by upstream callers (Planner, AnomalyDetector).
   */
  public isDegraded(): boolean {
    return this.degraded;
  }

  // -------------------------------------------------------------------------
  // Indexacion
  // -------------------------------------------------------------------------

  /**
   * Indexar documentos del framework en ChromaDB.
   * CHK-API-374: indexa scripts .ts de helpers, patterns, reference scenarios.
   * CHK-API-375: indexa documentacion .md de docs/.
   */
  async indexFramework(options: IndexOptions = {}): Promise<IndexResult | null> {
    if (this.degraded) return null;

    const start = Date.now();
    const result: IndexResult = { added: 0, updated: 0, skipped: 0, errors: [], durationMs: 0 };

    const collectionName = options.clientId
      ? `${CLIENT_COLLECTION_PREFIX}${options.clientId}`
      : GLOBAL_COLLECTION;

    const collection = await this.getOrCreateCollection(collectionName);
    const existingIds = options.incremental
      ? await this.getExistingIds(collection)
      : new Set<string>();

    const documents = await this.gatherDocuments(options.clientId);

    for (const doc of documents) {
      try {
        if (options.incremental && existingIds.has(doc.id)) {
          // Verificar si el contenido cambio (hash diferente)
          const existing = await this.getDocumentHash(collection, doc.id);
          if (existing === doc.contentHash) {
            result.skipped++;
            if (options.verbose) console.log(`  skip ${doc.relativePath}`);
            continue;
          }
          result.updated++;
        } else {
          result.added++;
        }

        const embedding = generateEmbedding(doc.content);
        await collection.upsert({
          ids: [doc.id],
          documents: [doc.content],
          embeddings: [embedding],
          metadatas: [
            {
              type: doc.type,
              relativePath: doc.relativePath,
              description: doc.description,
              contentHash: doc.contentHash,
              lastModified: doc.lastModified,
              clientId: doc.clientId ?? "",
            },
          ],
        });

        if (options.verbose) console.log(`  index ${doc.relativePath}`);
      } catch (err) {
        result.errors.push(`${doc.relativePath}: ${err}`);
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  /**
   * Indexar un documento individual (para actualizaciones en tiempo real).
   */
  async indexDocument(doc: KnowledgeDocument, clientId?: string): Promise<void> {
    if (this.degraded) return;

    const collectionName = clientId ? `${CLIENT_COLLECTION_PREFIX}${clientId}` : GLOBAL_COLLECTION;
    const collection = await this.getOrCreateCollection(collectionName);
    const embedding = generateEmbedding(doc.content);

    await collection.upsert({
      ids: [doc.id],
      documents: [doc.content],
      embeddings: [embedding],
      metadatas: [
        {
          type: doc.type,
          relativePath: doc.relativePath,
          description: doc.description,
          contentHash: doc.contentHash,
          lastModified: doc.lastModified,
          clientId: doc.clientId ?? "",
        },
      ],
    });
  }

  // -------------------------------------------------------------------------
  // Busqueda (RAG)
  // -------------------------------------------------------------------------

  /**
   * Buscar documentos por similitud semantica.
   * CHK-API-376: retorna top-K documentos mas relevantes.
   * CHK-SEC-115: busca en coleccion del cliente (no mezcla con otros clientes).
   * Returns null when operating in degraded mode (D-16 API contract preserved).
   */
  async search(query: string, options: SearchOptions = {}): Promise<RAGContext | null> {
    if (this.degraded) return null;

    const start = Date.now();
    const topK = options.topK ?? 5;

    const collectionName = options.clientId
      ? `${CLIENT_COLLECTION_PREFIX}${options.clientId}`
      : GLOBAL_COLLECTION;

    let collection: Collection;
    try {
      collection = await this.chroma!.getCollection({ name: collectionName });
    } catch {
      // Coleccion no existe aun — retornar contexto vacio
      return {
        query,
        collection: collectionName,
        documents: [],
        searchLatencyMs: Date.now() - start,
        totalDocumentsInCollection: 0,
      };
    }

    const totalDocs = await collection.count();
    const queryEmbedding = generateEmbedding(query);

    const whereFilter = options.type ? { type: options.type } : undefined;

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(topK, totalDocs || 1),
      include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
      ...(whereFilter ? { where: whereFilter } : {}),
    });

    const documents: RAGDocument[] = (results.ids[0] ?? []).map((id: string, i: number) => {
      const meta = (results.metadatas?.[0]?.[i] ?? {}) as Record<string, string>;
      const distance = (results.distances?.[0]?.[i] ?? 1) as number;
      // Convertir distancia coseno [0,2] a score [0,1] (1 = identico)
      const similarityScore = Math.max(0, 1 - distance / 2);

      return {
        id,
        content: (results.documents?.[0]?.[i] ?? "") as string,
        similarityScore,
        metadata: {
          type: (meta.type ?? "doc") as DocumentType,
          path: meta.relativePath ?? "",
          description: meta.description ?? "",
          clientId: meta.clientId || undefined,
        },
      };
    });

    return {
      query,
      collection: collectionName,
      documents,
      searchLatencyMs: Date.now() - start,
      totalDocumentsInCollection: totalDocs,
    };
  }

  /**
   * Buscar en coleccion global Y en coleccion privada del cliente,
   * mezclando resultados (global primero, luego privados).
   * CHK-SEC-115: nunca mezcla privados de distintos clientes.
   * Returns null when operating in degraded mode (D-16 API contract preserved).
   */
  async searchWithClientContext(
    query: string,
    clientId: string,
    topK = 5
  ): Promise<RAGContext | null> {
    if (this.degraded) return null;

    const [globalCtx, clientCtx] = await Promise.all([
      this.search(query, { topK }),
      this.search(query, { topK, clientId }),
    ]);

    // In degraded mode search() returns null — guard here (shouldn't happen since
    // degraded is checked above, but TypeScript narrowing requires the check).
    if (globalCtx === null || clientCtx === null) return null;

    // Mezclar: priorizar documentos del cliente (mas especificos)
    const seen = new Set<string>();
    const merged: RAGDocument[] = [];

    for (const doc of [...clientCtx.documents, ...globalCtx.documents]) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        merged.push(doc);
      }
    }

    return {
      query,
      collection: `${clientId}+global`,
      documents: merged.slice(0, topK),
      searchLatencyMs: globalCtx.searchLatencyMs + clientCtx.searchLatencyMs,
      totalDocumentsInCollection:
        globalCtx.totalDocumentsInCollection + clientCtx.totalDocumentsInCollection,
    };
  }

  // -------------------------------------------------------------------------
  // Gestion de colecciones
  // -------------------------------------------------------------------------

  async listCollections(): Promise<string[] | null> {
    if (this.degraded) return null;
    const collections = await this.chroma!.listCollections();
    return collections.map((c: { name: string }) => c.name);
  }

  async deleteCollection(collectionName: string): Promise<void> {
    if (this.degraded) return;
    await this.chroma!.deleteCollection({ name: collectionName });
  }

  async getCollectionStats(
    collectionName: string
  ): Promise<{ name: string; count: number } | null> {
    if (this.degraded) return null;
    const collection = await this.chroma!.getCollection({ name: collectionName });
    return { name: collectionName, count: await collection.count() };
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  private async getOrCreateCollection(name: string): Promise<Collection> {
    try {
      return await this.chroma!.getCollection({ name });
    } catch {
      return await this.chroma!.createCollection({
        name,
        metadata: {
          description: `k6 Enterprise Framework knowledge base: ${name}`,
          createdAt: new Date().toISOString(),
        },
      });
    }
  }

  private async getExistingIds(collection: Collection): Promise<Set<string>> {
    const total = await collection.count();
    if (total === 0) return new Set();
    const result = await collection.get({ include: [] as IncludeEnum[] });
    return new Set(result.ids);
  }

  private async getDocumentHash(collection: Collection, id: string): Promise<string | null> {
    try {
      const result = await collection.get({
        ids: [id],
        include: [IncludeEnum.Metadatas],
      });
      const meta = result.metadatas?.[0] as Record<string, string> | undefined;
      return meta?.contentHash ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Recopilar todos los documentos del framework para indexacion.
   * CHK-API-374: helpers + patterns + reference scenarios
   * CHK-API-375: documentacion docs/
   */
  private async gatherDocuments(clientId?: string): Promise<KnowledgeDocument[]> {
    const docs: KnowledgeDocument[] = [];

    const scanDirs: Array<{ dir: string; type: DocumentType; descPrefix: string }> = [
      { dir: "src/helpers", type: "helper", descPrefix: "Helper" },
      { dir: "src/patterns", type: "pattern", descPrefix: "Pattern" },
      { dir: "src/core", type: "helper", descPrefix: "Core" },
      { dir: "clients/_reference/scenarios", type: "script", descPrefix: "Reference scenario" },
      { dir: "docs", type: "doc", descPrefix: "Documentation" },
    ];

    for (const { dir, type, descPrefix } of scanDirs) {
      const absDir = path.join(this.frameworkRoot, dir);
      if (!fs.existsSync(absDir)) continue;

      const files = findFiles(absDir, type === "doc" ? [".md"] : [".ts", ".js"]);
      for (const filePath of files) {
        const relativePath = path.relative(this.frameworkRoot, filePath);
        const content = fs.readFileSync(filePath, "utf-8");
        const stat = fs.statSync(filePath);

        // Dividir archivos grandes en chunks con overlap
        const chunks = chunkText(content, MAX_CHUNK_SIZE, CHUNK_OVERLAP);

        for (let i = 0; i < chunks.length; i++) {
          const chunkSuffix = chunks.length > 1 ? `-chunk${i}` : "";
          const id = `${clientId ? clientId + "-" : ""}${relativePath.replace(/[^a-zA-Z0-9]/g, "-")}${chunkSuffix}`;

          docs.push({
            id,
            content: chunks[i],
            type,
            relativePath,
            description: `${descPrefix}: ${path.basename(filePath)}${chunks.length > 1 ? ` (parte ${i + 1}/${chunks.length})` : ""}`,
            contentHash: sha256(chunks[i]),
            clientId,
            lastModified: stat.mtime.toISOString(),
          });
        }
      }
    }

    return docs;
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Generar embedding simplificado (reemplazar con API de embeddings en produccion) */
export function generateEmbedding(text: string, dim = 128): number[] {
  const vec = new Array(dim).fill(0);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    vec[i % dim] += normalized.charCodeAt(i) / 1000;
  }
  // Normalizar a vector unitario
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Dividir texto en chunks con overlap */
export function chunkText(text: string, maxSize: number, overlap: number): string[] {
  if (text.length <= maxSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

/** Encontrar archivos recursivamente con extensiones dadas */
function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      results.push(...findFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/** SHA-256 de un string */
function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
