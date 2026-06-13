/** T-017: Patron de paginacion — traversal de APIs paginadas */

import { SafeResponse } from "@types-k6/safe-response";
import { RequestHelper } from "../helpers/request-helper";

export type PaginationStyle = "offset" | "cursor" | "page" | "link-header";

export interface OffsetPaginationConfig {
  style: "offset";
  limitParam?: string; // default "limit"
  offsetParam?: string; // default "offset"
  pageSize?: number; // default 20
  totalPath?: string; // JSON path to total count, e.g. "meta.total"
  itemsPath?: string; // JSON path to items array, e.g. "data"
}

export interface CursorPaginationConfig {
  style: "cursor";
  cursorParam?: string; // default "cursor"
  nextCursorPath?: string; // JSON path to next cursor, e.g. "meta.next_cursor"
  itemsPath?: string;
}

export interface PagePaginationConfig {
  style: "page";
  pageParam?: string; // default "page"
  sizeParam?: string; // default "per_page"
  pageSize?: number; // default 20
  totalPagesPath?: string;
  itemsPath?: string;
}

export type PaginationConfig =
  | OffsetPaginationConfig
  | CursorPaginationConfig
  | PagePaginationConfig;

export interface PaginationState {
  page: number;
  hasMore: boolean;
  nextParams: Record<string, string | number>;
  itemsCollected: number;
}

/** Initialize pagination state for the first request */
export function initPagination(config: PaginationConfig): PaginationState {
  switch (config.style) {
    case "offset":
      return {
        page: 0,
        hasMore: true,
        nextParams: {
          [config.limitParam ?? "limit"]: config.pageSize ?? 20,
          [config.offsetParam ?? "offset"]: 0,
        },
        itemsCollected: 0,
      };
    case "page":
      return {
        page: 1,
        hasMore: true,
        nextParams: {
          [config.pageParam ?? "page"]: 1,
          [config.sizeParam ?? "per_page"]: config.pageSize ?? 20,
        },
        itemsCollected: 0,
      };
    case "cursor":
      return { page: 0, hasMore: true, nextParams: {}, itemsCollected: 0 };
  }
}

/** Update pagination state after receiving a response */
export function advancePagination(
  state: PaginationState,
  response: SafeResponse,
  config: PaginationConfig
): PaginationState {
  const itemsPath = config.itemsPath ?? "data";
  const items = response.json<unknown[]>(itemsPath) ?? [];
  const itemsCollected = state.itemsCollected + items.length;

  switch (config.style) {
    case "offset": {
      const limit = (config as OffsetPaginationConfig).pageSize ?? 20;
      const offsetKey = (config as OffsetPaginationConfig).offsetParam ?? "offset";
      const limitKey = (config as OffsetPaginationConfig).limitParam ?? "limit";
      const newOffset = (state.nextParams[offsetKey] as number) + items.length;
      const hasMore = items.length === limit;
      return {
        page: state.page + 1,
        hasMore,
        nextParams: { [limitKey]: limit, [offsetKey]: newOffset },
        itemsCollected,
      };
    }
    case "page": {
      const pageKey = (config as PagePaginationConfig).pageParam ?? "page";
      const sizeKey = (config as PagePaginationConfig).sizeParam ?? "per_page";
      const size = (config as PagePaginationConfig).pageSize ?? 20;
      const totalPagesPath = (config as PagePaginationConfig).totalPagesPath;
      let hasMore = items.length === size;
      if (totalPagesPath) {
        const totalPages = response.json<number>(totalPagesPath) ?? 0;
        hasMore = state.page < totalPages;
      }
      return {
        page: state.page + 1,
        hasMore,
        nextParams: { [pageKey]: state.page + 1, [sizeKey]: size },
        itemsCollected,
      };
    }
    case "cursor": {
      const cursorPath = (config as CursorPaginationConfig).nextCursorPath ?? "meta.next_cursor";
      const cursorKey = (config as CursorPaginationConfig).cursorParam ?? "cursor";
      const nextCursor = response.json<string | null>(cursorPath);
      return {
        page: state.page + 1,
        hasMore: nextCursor != null && nextCursor !== "",
        nextParams: nextCursor ? { [cursorKey]: nextCursor } : {},
        itemsCollected,
      };
    }
  }
}

/**
 * Traverse all pages of a paginated API endpoint, collecting all items.
 * Stops when hasMore=false or maxPages is reached.
 */
export function traverseAll<T = unknown>(
  client: RequestHelper,
  path: string,
  config: PaginationConfig,
  maxPages = 10
): T[] {
  const allItems: T[] = [];
  let state = initPagination(config);
  const itemsPath = config.itemsPath ?? "data";

  while (state.hasMore && state.page < maxPages) {
    const params: Record<string, string | number | boolean | null | undefined> = state.nextParams;
    const res = client.get(path, params);
    const items = res.json<T[]>(itemsPath) ?? [];
    allItems.push(...items);
    state = advancePagination(state, res, config);
  }

  return allItems;
}
