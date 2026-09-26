/**
 * chromadb is an optional peer dependency and is not installed in this repo.
 * Importing the knowledge base (and therefore any agent) must not fail; the
 * manager degrades with a warning, or throws when K6_AI_REQUIRE_RAG=true.
 * No vi.mock("chromadb") here on purpose: this exercises the real resolution.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { KnowledgeBaseManager } from "../../../src/ai/knowledge-base/knowledge-base";

describe("KnowledgeBaseManager without the chromadb package", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.K6_AI_REQUIRE_RAG;
  });

  it("degrades with one warning instead of failing at import time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kb = new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" });
    expect(kb.isDegraded()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await kb.search("anything")).toBeNull();
  });

  it("still fails hard when K6_AI_REQUIRE_RAG=true", () => {
    process.env.K6_AI_REQUIRE_RAG = "true";
    expect(
      () => new KnowledgeBaseManager({ chromaHost: "localhost", chromaPort: 8000, frameworkRoot: "/tmp" })
    ).toThrow(/RAG required/);
  });
});
