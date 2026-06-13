import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initPagination,
  advancePagination,
  traverseAll,
} from "../../src/patterns/pagination-pattern";
import { SafeResponse, RequestHelper } from "../../src/helpers/request-helper";

// Mock request-helper since it depends on k6/http
vi.mock("../../src/helpers/request-helper", () => {
  class MockRequestHelper {
    get = vi.fn();
    post = vi.fn();
    constructor(_baseUrl: string, _opts?: unknown) {}
  }
  return {
    RequestHelper: MockRequestHelper,
  };
});

function makeSafeResponse(data: unknown[] = [], extra: Record<string, unknown> = {}): SafeResponse {
  const bodyObj = { data, ...extra };
  const body = JSON.stringify(bodyObj);

  return {
    status: 200,
    body,
    headers: {},
    timings: { duration: 50, waiting: 40, receiving: 5, sending: 5 },
    json: vi.fn((selector?: string) => {
      if (!selector) return bodyObj;
      const parts = selector.split(".");
      let val: unknown = bodyObj;
      for (const part of parts) {
        if (val == null || typeof val !== "object") return null;
        val = (val as Record<string, unknown>)[part];
      }
      return val ?? null;
    }),
  };
}

describe("pagination-pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── initPagination ──────────────────────────────────────────────────────

  describe("initPagination", () => {
    it("initializes offset pagination with defaults", () => {
      const state = initPagination({ style: "offset" });
      expect(state).toEqual({
        page: 0,
        hasMore: true,
        nextParams: { limit: 20, offset: 0 },
        itemsCollected: 0,
      });
    });

    it("initializes offset pagination with custom params", () => {
      const state = initPagination({
        style: "offset",
        limitParam: "size",
        offsetParam: "skip",
        pageSize: 50,
      });
      expect(state).toEqual({
        page: 0,
        hasMore: true,
        nextParams: { size: 50, skip: 0 },
        itemsCollected: 0,
      });
    });

    it("initializes page pagination with defaults", () => {
      const state = initPagination({ style: "page" });
      expect(state).toEqual({
        page: 1,
        hasMore: true,
        nextParams: { page: 1, per_page: 20 },
        itemsCollected: 0,
      });
    });

    it("initializes page pagination with custom params", () => {
      const state = initPagination({
        style: "page",
        pageParam: "p",
        sizeParam: "s",
        pageSize: 10,
      });
      expect(state).toEqual({
        page: 1,
        hasMore: true,
        nextParams: { p: 1, s: 10 },
        itemsCollected: 0,
      });
    });

    it("initializes cursor pagination", () => {
      const state = initPagination({ style: "cursor" });
      expect(state).toEqual({
        page: 0,
        hasMore: true,
        nextParams: {},
        itemsCollected: 0,
      });
    });
  });

  // ── advancePagination ──────────────────────────────────────────────────

  describe("advancePagination", () => {
    describe("offset style", () => {
      const config = { style: "offset" as const, pageSize: 2 };

      it("advances offset by items returned", () => {
        const state = {
          page: 0,
          hasMore: true,
          nextParams: { limit: 2, offset: 0 },
          itemsCollected: 0,
        };
        const response = makeSafeResponse(["a", "b"]);

        const next = advancePagination(state, response, config);
        expect(next.page).toBe(1);
        expect(next.hasMore).toBe(true); // items.length === limit
        expect(next.nextParams).toEqual({ limit: 2, offset: 2 });
        expect(next.itemsCollected).toBe(2);
      });

      it("sets hasMore=false when fewer items than pageSize returned", () => {
        const state = {
          page: 1,
          hasMore: true,
          nextParams: { limit: 2, offset: 2 },
          itemsCollected: 2,
        };
        const response = makeSafeResponse(["c"]);

        const next = advancePagination(state, response, config);
        expect(next.hasMore).toBe(false);
        expect(next.itemsCollected).toBe(3);
      });

      it("sets hasMore=false when empty items returned", () => {
        const state = {
          page: 1,
          hasMore: true,
          nextParams: { limit: 2, offset: 2 },
          itemsCollected: 2,
        };
        const response = makeSafeResponse([]);

        const next = advancePagination(state, response, config);
        expect(next.hasMore).toBe(false);
        expect(next.itemsCollected).toBe(2);
      });
    });

    describe("page style", () => {
      const config = { style: "page" as const, pageSize: 2 };

      it("advances page number", () => {
        const state = {
          page: 1,
          hasMore: true,
          nextParams: { page: 1, per_page: 2 },
          itemsCollected: 0,
        };
        const response = makeSafeResponse(["a", "b"]);

        const next = advancePagination(state, response, config);
        expect(next.page).toBe(2);
        expect(next.hasMore).toBe(true);
        expect(next.nextParams).toEqual({ page: 2, per_page: 2 });
        expect(next.itemsCollected).toBe(2);
      });

      it("uses totalPagesPath to determine hasMore", () => {
        const configWithTotal = {
          style: "page" as const,
          pageSize: 2,
          totalPagesPath: "meta.totalPages",
        };
        const state = {
          page: 2,
          hasMore: true,
          nextParams: { page: 2, per_page: 2 },
          itemsCollected: 2,
        };
        const response = makeSafeResponse(["c", "d"], { meta: { totalPages: 3 } });

        const next = advancePagination(state, response, configWithTotal);
        expect(next.hasMore).toBe(true); // page 2 < totalPages 3

        // Now on page 3 (last)
        const state2 = {
          page: 3,
          hasMore: true,
          nextParams: { page: 3, per_page: 2 },
          itemsCollected: 4,
        };
        const response2 = makeSafeResponse(["e"], { meta: { totalPages: 3 } });
        const next2 = advancePagination(state2, response2, configWithTotal);
        expect(next2.hasMore).toBe(false); // page 3 === totalPages 3
      });
    });

    describe("cursor style", () => {
      const config = { style: "cursor" as const };

      it("sets nextParams with cursor when next_cursor is present", () => {
        const state = { page: 0, hasMore: true, nextParams: {}, itemsCollected: 0 };
        const response = makeSafeResponse(["a", "b"], {
          meta: { next_cursor: "cursor_abc" },
        });

        const next = advancePagination(state, response, config);
        expect(next.page).toBe(1);
        expect(next.hasMore).toBe(true);
        expect(next.nextParams).toEqual({ cursor: "cursor_abc" });
        expect(next.itemsCollected).toBe(2);
      });

      it("sets hasMore=false when next_cursor is null", () => {
        const state = {
          page: 1,
          hasMore: true,
          nextParams: { cursor: "cursor_abc" },
          itemsCollected: 2,
        };
        const response = makeSafeResponse(["c"], {
          meta: { next_cursor: null },
        });

        const next = advancePagination(state, response, config);
        expect(next.hasMore).toBe(false);
        expect(next.nextParams).toEqual({});
      });

      it("sets hasMore=false when next_cursor is empty string", () => {
        const state = { page: 0, hasMore: true, nextParams: {}, itemsCollected: 0 };
        const response = makeSafeResponse(["a"], {
          meta: { next_cursor: "" },
        });

        const next = advancePagination(state, response, config);
        expect(next.hasMore).toBe(false);
      });

      it("uses custom cursorParam and nextCursorPath", () => {
        const customConfig = {
          style: "cursor" as const,
          cursorParam: "after",
          nextCursorPath: "pagination.next",
        };
        const state = { page: 0, hasMore: true, nextParams: {}, itemsCollected: 0 };
        const response = makeSafeResponse(["a"], {
          pagination: { next: "tok_xyz" },
        });

        const next = advancePagination(state, response, customConfig);
        expect(next.nextParams).toEqual({ after: "tok_xyz" });
        expect(next.hasMore).toBe(true);
      });
    });

    it("uses custom itemsPath", () => {
      const config = { style: "offset" as const, pageSize: 2, itemsPath: "results" };
      const bodyObj = { results: ["x", "y"] };
      const response: SafeResponse = {
        status: 200,
        body: JSON.stringify(bodyObj),
        headers: {},
        timings: { duration: 50, waiting: 40, receiving: 5, sending: 5 },
        json: vi.fn((selector?: string) => {
          if (!selector) return bodyObj;
          return (bodyObj as Record<string, unknown>)[selector] ?? null;
        }),
      };

      const state = {
        page: 0,
        hasMore: true,
        nextParams: { limit: 2, offset: 0 },
        itemsCollected: 0,
      };
      const next = advancePagination(state, response, config);
      expect(next.itemsCollected).toBe(2);
    });
  });

  // ── traverseAll ──────────────────────────────────────────────────────────

  describe("traverseAll", () => {
    it("collects all items across multiple pages (offset)", () => {
      const client = new RequestHelper("http://test.com");
      const mockGet = vi
        .fn()
        .mockReturnValueOnce(makeSafeResponse([1, 2], {}))
        .mockReturnValueOnce(makeSafeResponse([3], {}));

      (client as unknown as { get: typeof mockGet }).get = mockGet;

      const config = { style: "offset" as const, pageSize: 2 };
      const items = traverseAll<number>(client, "/api/items", config);

      expect(items).toEqual([1, 2, 3]);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it("stops at maxPages", () => {
      const client = new RequestHelper("http://test.com");
      const mockGet = vi.fn(() => makeSafeResponse([1, 2]));
      (client as unknown as { get: typeof mockGet }).get = mockGet;

      const config = { style: "offset" as const, pageSize: 2 };
      const items = traverseAll<number>(client, "/api/items", config, 3);

      expect(mockGet).toHaveBeenCalledTimes(3);
      expect(items).toEqual([1, 2, 1, 2, 1, 2]);
    });

    it("stops when hasMore is false", () => {
      const client = new RequestHelper("http://test.com");
      const mockGet = vi
        .fn()
        .mockReturnValueOnce(makeSafeResponse([1, 2]))
        .mockReturnValueOnce(makeSafeResponse([])); // empty → hasMore=false

      (client as unknown as { get: typeof mockGet }).get = mockGet;

      const config = { style: "offset" as const, pageSize: 2 };
      const items = traverseAll<number>(client, "/api/items", config, 10);

      expect(items).toEqual([1, 2]);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it("works with cursor pagination", () => {
      const client = new RequestHelper("http://test.com");
      const mockGet = vi
        .fn()
        .mockReturnValueOnce(makeSafeResponse(["a", "b"], { meta: { next_cursor: "cur1" } }))
        .mockReturnValueOnce(makeSafeResponse(["c"], { meta: { next_cursor: null } }));

      (client as unknown as { get: typeof mockGet }).get = mockGet;

      const config = { style: "cursor" as const };
      const items = traverseAll<string>(client, "/api/items", config);

      expect(items).toEqual(["a", "b", "c"]);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it("returns empty array when first page is empty", () => {
      const client = new RequestHelper("http://test.com");
      const mockGet = vi.fn().mockReturnValueOnce(makeSafeResponse([]));
      (client as unknown as { get: typeof mockGet }).get = mockGet;

      const config = { style: "offset" as const, pageSize: 20 };
      const items = traverseAll(client, "/api/items", config);

      expect(items).toEqual([]);
      // Should still call get once for the first page
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("defaults maxPages to 10", () => {
      const client = new RequestHelper("http://test.com");
      // Each call returns full page (hasMore stays true)
      const mockGet = vi.fn(() => makeSafeResponse(Array(20).fill("x")));
      (client as unknown as { get: typeof mockGet }).get = mockGet;

      const config = { style: "offset" as const, pageSize: 20 };
      traverseAll(client, "/api/items", config);

      expect(mockGet).toHaveBeenCalledTimes(10);
    });
  });
});
