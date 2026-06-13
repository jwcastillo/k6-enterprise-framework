/**
 * AI-04 (D-16): Tests for KnowledgeBaseManager degraded mode.
 *
 * When ChromaDB is unreachable and K6_AI_REQUIRE_RAG is unset/false,
 * the manager must warn (not throw), set degraded=true, and return null
 * from query-style methods.
 *
 * Phase 5 / 05-05-chromadb-fail-loud
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chromadb so ChromaClient constructor throws (simulates ECONNREFUSED)
vi.mock("chromadb", () => ({
  ChromaClient: class {
    constructor() {
      throw new Error("ECONNREFUSED");
    }
    heartbeat() {
      return Promise.reject(new Error("ECONNREFUSED"));
    }
  },
  IncludeEnum: {
    Documents: "documents",
    Embeddings: "embeddings",
    Metadatas: "metadatas",
    Distances: "distances",
  },
}));

import { KnowledgeBaseManager } from "../../../src/ai/knowledge-base/knowledge-base";

describe("KnowledgeBaseManager — degraded mode (D-16)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Ensure K6_AI_REQUIRE_RAG is NOT set
    delete process.env.K6_AI_REQUIRE_RAG;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.K6_AI_REQUIRE_RAG;
  });

  it("constructs without throwing when ChromaDB is unavailable and K6_AI_REQUIRE_RAG is unset", () => {
    expect(
      () =>
        new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" }),
    ).not.toThrow();
  });

  it("emits console.warn once with the exact D-16 message substring", () => {
    new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" });

    expect(warnSpy).toHaveBeenCalledTimes(1);

    const warnMessage: string = warnSpy.mock.calls[0][0] as string;
    expect(warnMessage).toContain("ChromaDB unavailable at localhost:8000");
    expect(warnMessage).toContain("K6_AI_REQUIRE_RAG=true to fail-hard");
    // Verify the full D-16 canonical string is present
    expect(warnMessage).toBe(
      "[knowledge-base] ChromaDB unavailable at localhost:8000 — RAG disabled, planner running without retrieval context. Set K6_AI_REQUIRE_RAG=true to fail-hard instead.",
    );
  });

  it("isDegraded() returns true after ChromaDB unavailability", () => {
    const manager = new KnowledgeBaseManager({
      chromaHost: "localhost",
      chromaPort: 8000,
      frameworkRoot: "/tmp",
    });
    expect(manager.isDegraded()).toBe(true);
  });

  it("search() resolves to null in degraded mode (no throw)", async () => {
    const manager = new KnowledgeBaseManager({
      chromaHost: "localhost",
      chromaPort: 8000,
      frameworkRoot: "/tmp",
    });
    const result = await manager.search("any query");
    expect(result).toBeNull();
  });

  it("indexFramework() resolves to null in degraded mode (no throw)", async () => {
    const manager = new KnowledgeBaseManager({
      chromaHost: "localhost",
      chromaPort: 8000,
      frameworkRoot: "/tmp",
    });
    const result = await manager.indexFramework();
    expect(result).toBeNull();
  });

  it("indexDocument() resolves without throwing in degraded mode", async () => {
    const manager = new KnowledgeBaseManager({
      chromaHost: "localhost",
      chromaPort: 8000,
      frameworkRoot: "/tmp",
    });
    await expect(
      manager.indexDocument({
        id: "test-doc",
        content: "content",
        type: "doc",
        relativePath: "docs/test.md",
        description: "Test doc",
        contentHash: "abc123",
        lastModified: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });

  it("listCollections() returns null in degraded mode", async () => {
    const manager = new KnowledgeBaseManager({
      chromaHost: "localhost",
      chromaPort: 8000,
      frameworkRoot: "/tmp",
    });
    const result = await manager.listCollections();
    expect(result).toBeNull();
  });
});
