/**
 * AI-04 (D-17): Tests for KnowledgeBaseManager strict/fail-loud mode.
 *
 * When K6_AI_REQUIRE_RAG=true and ChromaDB is unreachable, the manager
 * must throw Error with the exact D-17 message.
 * When K6_AI_REQUIRE_RAG=false (explicit false string), it must follow the
 * warn path (D-16), NOT the throw path.
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

describe("KnowledgeBaseManager — fail-loud mode (D-17)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.K6_AI_REQUIRE_RAG = "true";
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.K6_AI_REQUIRE_RAG;
  });

  it("throws when K6_AI_REQUIRE_RAG=true and ChromaDB is unreachable", () => {
    expect(
      () =>
        new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" }),
    ).toThrow();
  });

  it("thrown error message contains 'RAG required', host:port, and 'unreachable'", () => {
    let thrownError: Error | null = null;
    try {
      new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" });
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain("RAG required");
    expect(thrownError!.message).toContain("localhost:8000");
    expect(thrownError!.message).toContain("unreachable");
    // Verify the exact D-17 message
    expect(thrownError!.message).toBe(
      "RAG required (K6_AI_REQUIRE_RAG=true) but ChromaDB at localhost:8000 is unreachable",
    );
  });

  it("does NOT emit console.warn in fail-loud mode (throws instead)", () => {
    try {
      new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" });
    } catch {
      // expected
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("KnowledgeBaseManager — explicit K6_AI_REQUIRE_RAG=false uses warn path (D-16)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.K6_AI_REQUIRE_RAG = "false";
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.K6_AI_REQUIRE_RAG;
  });

  it("constructs without throwing when K6_AI_REQUIRE_RAG='false' (explicit string)", () => {
    expect(
      () =>
        new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" }),
    ).not.toThrow();
  });

  it("emits warn (not throw) when K6_AI_REQUIRE_RAG='false'", () => {
    new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMessage: string = warnSpy.mock.calls[0][0] as string;
    expect(warnMessage).toContain("ChromaDB unavailable at localhost:8000");
  });

  it("isDegraded() returns true when K6_AI_REQUIRE_RAG='false'", () => {
    const manager = new KnowledgeBaseManager({
      chromaHost: "localhost",
      chromaPort: 8000,
      frameworkRoot: "/tmp",
    });
    expect(manager.isDegraded()).toBe(true);
  });
});
