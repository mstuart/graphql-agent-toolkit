import type { ParsedSchema } from '../types/index.js';
import type { GraphQLExecutor } from '../mcp/executor.js';

export interface PaginationConfig {
  style: 'relay' | 'offset' | 'auto';
  pageSize: number;
  maxPages?: number;
}

export interface PaginatedResult<T = unknown> {
  items: T[];
  totalFetched: number;
  hasMore: boolean;
  cursors?: { start: string; end: string };
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10;

/**
 * Auto-detect pagination style from a type's fields.
 *
 * Relay: The type has an `edges` field whose unwrapped type has a `node` field,
 *        AND a `pageInfo` field whose type has `hasNextPage` and `endCursor`.
 *
 * Offset: The type (or its parent query field) has `limit`/`offset` or `skip`/`take` args.
 *         We detect this by looking for fields on the Query type that return this typeName
 *         and have offset-style arguments.
 */
export function detectPaginationStyle(
  schema: ParsedSchema,
  typeName: string,
): 'relay' | 'offset' | 'none' {
  const type = schema.types.get(typeName);
  if (!type) return 'none';

  // Check for Relay pattern: edges { node } + pageInfo { hasNextPage, endCursor }
  const edgesField = type.fields.find((f) => f.name === 'edges');
  const pageInfoField = type.fields.find((f) => f.name === 'pageInfo');

  if (edgesField && pageInfoField) {
    // Verify edges has node
    const edgesTypeName = unwrapTypeName(edgesField.type);
    if (edgesTypeName) {
      const edgesType = schema.types.get(edgesTypeName);
      if (edgesType) {
        const hasNode = edgesType.fields.some((f) => f.name === 'node');
        if (hasNode) {
          // Verify pageInfo has hasNextPage and endCursor
          const pageInfoTypeName = unwrapTypeName(pageInfoField.type);
          if (pageInfoTypeName) {
            const pageInfoType = schema.types.get(pageInfoTypeName);
            if (pageInfoType) {
              const hasNextPage = pageInfoType.fields.some((f) => f.name === 'hasNextPage');
              const hasEndCursor = pageInfoType.fields.some((f) => f.name === 'endCursor');
              if (hasNextPage && hasEndCursor) {
                return 'relay';
              }
            }
          }
        }
      }
    }
  }

  // Check for offset pattern: look at query fields that return this type
  // and check if they have limit/offset or skip/take args
  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    for (const field of queryType.fields) {
      const returnTypeName = unwrapTypeName(field.type);
      if (returnTypeName === typeName) {
        const argNames = field.args.map((a) => a.name);
        const hasLimitOffset =
          argNames.includes('limit') && argNames.includes('offset');
        const hasSkipTake =
          argNames.includes('skip') && argNames.includes('take');
        if (hasLimitOffset || hasSkipTake) {
          return 'offset';
        }
      }
    }
  }

  return 'none';
}

/**
 * Execute a paginated query, collecting all pages.
 */
export async function executePaginated(
  executor: GraphQLExecutor,
  operation: string,
  variables: Record<string, unknown>,
  config?: PaginationConfig,
): Promise<PaginatedResult> {
  const style = config?.style ?? 'auto';
  const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;

  if (style === 'relay' || (style === 'auto' && isRelayOperation(operation))) {
    return executeRelayPaginated(executor, operation, variables, pageSize, maxPages);
  }

  if (style === 'offset' || (style === 'auto' && isOffsetOperation(operation))) {
    return executeOffsetPaginated(executor, operation, variables, pageSize, maxPages);
  }

  // Fallback: execute once, no pagination
  const resultStr = await executor.execute(operation, variables);
  const data = JSON.parse(resultStr);
  const items = extractItems(data);
  return {
    items,
    totalFetched: items.length,
    hasMore: false,
  };
}

/**
 * Check if operation string looks like a Relay query (has after/first variables and pageInfo).
 */
function isRelayOperation(operation: string): boolean {
  return (
    operation.includes('$after') &&
    operation.includes('$first') &&
    operation.includes('pageInfo')
  );
}

/**
 * Check if operation string looks like an offset query (has limit/offset or skip/take).
 */
function isOffsetOperation(operation: string): boolean {
  return (
    (operation.includes('$limit') && operation.includes('$offset')) ||
    (operation.includes('$skip') && operation.includes('$take'))
  );
}

async function executeRelayPaginated(
  executor: GraphQLExecutor,
  operation: string,
  variables: Record<string, unknown>,
  pageSize: number,
  maxPages: number,
): Promise<PaginatedResult> {
  const allItems: unknown[] = [];
  let cursor: string | null = null;
  let startCursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore && pageCount < maxPages) {
    const vars: Record<string, unknown> = {
      ...variables,
      first: pageSize,
    };
    if (cursor) {
      vars.after = cursor;
    }

    const resultStr = await executor.execute(operation, vars);
    const data = JSON.parse(resultStr);

    // Extract edges and pageInfo from the response
    const connectionData = findConnectionData(data);
    if (!connectionData) {
      // Not a valid connection response, return what we have
      break;
    }

    const { edges, pageInfo } = connectionData;

    if (pageCount === 0 && pageInfo.startCursor) {
      startCursor = pageInfo.startCursor;
    }

    // Extract nodes from edges
    for (const edge of edges) {
      if (edge && typeof edge === 'object' && 'node' in edge) {
        allItems.push((edge as { node: unknown }).node);
      } else {
        allItems.push(edge);
      }
    }

    hasMore = pageInfo.hasNextPage ?? false;
    cursor = pageInfo.endCursor ?? null;
    pageCount++;

    if (!hasMore || !cursor) break;
  }

  const result: PaginatedResult = {
    items: allItems,
    totalFetched: allItems.length,
    hasMore,
  };

  if (startCursor || cursor) {
    result.cursors = {
      start: startCursor ?? '',
      end: cursor ?? '',
    };
  }

  return result;
}

async function executeOffsetPaginated(
  executor: GraphQLExecutor,
  operation: string,
  variables: Record<string, unknown>,
  pageSize: number,
  maxPages: number,
): Promise<PaginatedResult> {
  const allItems: unknown[] = [];
  let currentOffset = 0;
  let hasMore = true;
  let pageCount = 0;

  // Detect whether to use limit/offset or skip/take
  const useSkipTake =
    operation.includes('$skip') && operation.includes('$take');

  while (hasMore && pageCount < maxPages) {
    const vars: Record<string, unknown> = { ...variables };

    if (useSkipTake) {
      vars.skip = currentOffset;
      vars.take = pageSize;
    } else {
      vars.offset = currentOffset;
      vars.limit = pageSize;
    }

    const resultStr = await executor.execute(operation, vars);
    const data = JSON.parse(resultStr);
    const items = extractItems(data);

    allItems.push(...items);
    pageCount++;

    if (items.length < pageSize) {
      hasMore = false;
    } else {
      currentOffset += pageSize;
    }
  }

  return {
    items: allItems,
    totalFetched: allItems.length,
    hasMore,
  };
}

interface PageInfo {
  hasNextPage?: boolean;
  endCursor?: string | null;
  startCursor?: string | null;
}

interface ConnectionData {
  edges: unknown[];
  pageInfo: PageInfo;
}

/**
 * Recursively find connection data (edges + pageInfo) in a response object.
 */
function findConnectionData(data: unknown): ConnectionData | null {
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Check if this object directly has edges and pageInfo
  if (Array.isArray(obj.edges) && obj.pageInfo && typeof obj.pageInfo === 'object') {
    return {
      edges: obj.edges,
      pageInfo: obj.pageInfo as PageInfo,
    };
  }

  // Recurse into object properties
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = findConnectionData(value);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Extract array items from a GraphQL response, searching for the first array value.
 */
function extractItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const items = extractItems(value);
      if (items.length > 0) return items;
    }
  }

  return [];
}

/**
 * Unwrap a TypeRef to get the named type.
 */
function unwrapTypeName(typeRef: { kind: string; name: string | null; ofType: unknown | null }): string | null {
  if (typeRef.kind === 'NON_NULL' || typeRef.kind === 'LIST') {
    if (typeRef.ofType) {
      return unwrapTypeName(typeRef.ofType as { kind: string; name: string | null; ofType: unknown | null });
    }
    return null;
  }
  return typeRef.name;
}
