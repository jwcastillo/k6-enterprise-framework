/**
 * Phase 5 / AI-04 (D-19): Local types shim for the chromadb peer dependency.
 * Replaces the @ts-ignore previously at knowledge-base.ts line 14.
 * Keep in sync with the chromadb version pinned in package.json peerDependencies.
 * Extend as the codebase calls new chromadb surface.
 *
 * Identifiers covered (enumerated from src/ai/knowledge-base/knowledge-base.ts):
 *   - ChromaClient (constructor, getCollection, createCollection, listCollections, deleteCollection)
 *   - Collection (upsert, query, get, count)
 *   - IncludeEnum (Documents, Metadatas, Distances, Embeddings)
 */

declare module "chromadb" {
  export enum IncludeEnum {
    Documents = "documents",
    Embeddings = "embeddings",
    Metadatas = "metadatas",
    Distances = "distances",
  }

  export interface UpsertArgs {
    ids: string[];
    documents?: string[];
    embeddings?: number[][];
    metadatas?: Record<string, unknown>[];
  }

  export interface QueryArgs {
    queryTexts?: string[];
    queryEmbeddings?: number[][];
    nResults?: number;
    where?: Record<string, unknown>;
    include?: IncludeEnum[];
  }

  export interface QueryResult {
    ids: string[][];
    documents?: (string | null)[][];
    distances?: number[][];
    metadatas?: (Record<string, unknown> | null)[][];
  }

  export interface GetArgs {
    ids?: string[];
    where?: Record<string, unknown>;
    limit?: number;
    include?: IncludeEnum[];
  }

  export interface GetResult {
    ids: string[];
    documents?: (string | null)[];
    metadatas?: (Record<string, unknown> | null)[];
  }

  export interface Collection {
    upsert(args: UpsertArgs): Promise<void>;
    query(args: QueryArgs): Promise<QueryResult>;
    get(args?: GetArgs): Promise<GetResult>;
    count(): Promise<number>;
  }

  export interface CreateCollectionArgs {
    name: string;
    embeddingFunction?: unknown;
    metadata?: Record<string, unknown>;
  }

  export interface GetCollectionArgs {
    name: string;
  }

  export interface DeleteCollectionArgs {
    name: string;
  }

  export class ChromaClient {
    constructor(opts?: { path?: string });
    heartbeat(): Promise<number>;
    getCollection(args: GetCollectionArgs): Promise<Collection>;
    createCollection(args: CreateCollectionArgs): Promise<Collection>;
    getOrCreateCollection(args: CreateCollectionArgs): Promise<Collection>;
    listCollections(): Promise<Array<{ name: string }>>;
    deleteCollection(args: DeleteCollectionArgs): Promise<void>;
  }
}
