import type { ParsedSchema, TypeReference } from '../types/index.js';
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

const unwrapTypeName = (typeReference: TypeReference): string | null => {
  if (
    (typeReference.kind === 'NON_NULL' || typeReference.kind === 'LIST') &&
    typeReference.ofType
  ) {
    return unwrapTypeName(typeReference.ofType);
  }
  return typeReference.name;
};

const hasRelayPagination = (schema: ParsedSchema, typeName: string): boolean => {
  const type = schema.types.get(typeName);
  const edgesField = type?.fields.find((field) => field.name === 'edges');
  const pageInfoField = type?.fields.find((field) => field.name === 'pageInfo');
  if (!(edgesField && pageInfoField)) {
    return false;
  }

  const edgesTypeName = unwrapTypeName(edgesField.type);
  const pageInfoTypeName = unwrapTypeName(pageInfoField.type);
  const edgesType = edgesTypeName ? schema.types.get(edgesTypeName) : undefined;
  const pageInfoType = pageInfoTypeName ? schema.types.get(pageInfoTypeName) : undefined;
  return Boolean(
    edgesType?.fields.some((field) => field.name === 'node') &&
    pageInfoType?.fields.some((field) => field.name === 'hasNextPage') &&
    pageInfoType.fields.some((field) => field.name === 'endCursor'),
  );
};

const hasOffsetPagination = (schema: ParsedSchema, typeName: string): boolean => {
  const queryType = schema.types.get(schema.queryType);
  return (
    queryType?.fields.some((field) => {
      if (unwrapTypeName(field.type) !== typeName) {
        return false;
      }
      const argumentNames = new Set(field.args.map((argument) => argument.name));
      return (
        (argumentNames.has('limit') && argumentNames.has('offset')) ||
        (argumentNames.has('skip') && argumentNames.has('take'))
      );
    }) ?? false
  );
};

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
export const detectPaginationStyle = (
  schema: ParsedSchema,
  typeName: string,
): 'relay' | 'offset' | 'none' => {
  if (hasRelayPagination(schema, typeName)) {
    return 'relay';
  }

  if (hasOffsetPagination(schema, typeName)) {
    return 'offset';
  }

  return 'none';
};

interface PageInfo {
  endCursor?: string | null;
  hasNextPage?: boolean;
  startCursor?: string | null;
}

interface ConnectionData {
  edges: unknown[];
  pageInfo: PageInfo;
}

const findConnectionData = (data: unknown): ConnectionData | null => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const object = data as Record<string, unknown>;
  if (Array.isArray(object.edges) && object.pageInfo && typeof object.pageInfo === 'object') {
    return {
      edges: object.edges,
      pageInfo: object.pageInfo as PageInfo,
    };
  }

  for (const value of Object.values(object)) {
    if (!(value && typeof value === 'object') || Array.isArray(value)) {
      continue;
    }
    const found = findConnectionData(value);
    if (found) {
      return found;
    }
  }

  return null;
};

const extractItems = (data: unknown): unknown[] => {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== 'object') {
    return [];
  }

  for (const value of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === 'object') {
      const items = extractItems(value);
      if (items.length > 0) {
        return items;
      }
    }
  }

  return [];
};

/**
 * Check if operation string looks like a Relay query (has after/first variables and pageInfo).
 */
const isRelayOperation = (operation: string): boolean =>
  operation.includes('$after') && operation.includes('$first') && operation.includes('pageInfo');

/**
 * Check if operation string looks like an offset query (has limit/offset or skip/take).
 */
const isOffsetOperation = (operation: string): boolean =>
  (operation.includes('$limit') && operation.includes('$offset')) ||
  (operation.includes('$skip') && operation.includes('$take'));

interface PaginationExecutionContext {
  executor: GraphQLExecutor;
  maxPages: number;
  operation: string;
  pageSize: number;
  variables: Record<string, unknown>;
}

const executeRelayPaginated = async ({
  executor,
  maxPages,
  operation,
  pageSize,
  variables,
}: PaginationExecutionContext): Promise<PaginatedResult> => {
  const allItems: unknown[] = [];
  let cursor: string | null = null;
  let startCursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore && (pageCount === 0 || Boolean(cursor)) && pageCount < maxPages) {
    const pageVariables: Record<string, unknown> = {
      ...variables,
      first: pageSize,
    };
    if (cursor) {
      pageVariables.after = cursor;
    }

    // Each request depends on the cursor returned by the previous page.
    // eslint-disable-next-line no-await-in-loop
    const resultString = await executor.execute(operation, pageVariables);
    const data = JSON.parse(resultString);

    // Extract edges and pageInfo from the response
    const connectionData = findConnectionData(data);
    if (!connectionData) {
      // Not a valid connection response, return what we have
      break;
    }

    const { edges, pageInfo } = connectionData;
    const { endCursor = null, hasNextPage = false, startCursor: pageStartCursor } = pageInfo;

    if (pageCount === 0 && pageStartCursor) {
      startCursor = pageStartCursor;
    }

    // Extract nodes from edges
    for (const edge of edges) {
      if (edge && typeof edge === 'object' && 'node' in edge) {
        allItems.push((edge as { node: unknown }).node);
      } else {
        allItems.push(edge);
      }
    }

    hasMore = hasNextPage;
    // The cursor is loop-carried state and is also returned to the caller.
    // eslint-disable-next-line sonarjs/no-redundant-assignments
    cursor = endCursor;
    pageCount += 1;
  }

  const result: PaginatedResult = {
    hasMore,
    items: allItems,
    totalFetched: allItems.length,
  };

  if (startCursor || cursor) {
    result.cursors = {
      end: cursor ?? '',
      start: startCursor ?? '',
    };
  }

  return result;
};

const executeOffsetPaginated = async ({
  executor,
  maxPages,
  operation,
  pageSize,
  variables,
}: PaginationExecutionContext): Promise<PaginatedResult> => {
  const allItems: unknown[] = [];
  let currentOffset = 0;
  let hasMore = true;
  let pageCount = 0;

  // Detect whether to use limit/offset or skip/take
  const useSkipTake = operation.includes('$skip') && operation.includes('$take');

  while (hasMore && pageCount < maxPages) {
    const pageVariables: Record<string, unknown> = { ...variables };

    if (useSkipTake) {
      pageVariables.skip = currentOffset;
      pageVariables.take = pageSize;
    } else {
      pageVariables.offset = currentOffset;
      pageVariables.limit = pageSize;
    }

    // Each request depends on the offset advanced by the previous page.
    // eslint-disable-next-line no-await-in-loop
    const resultString = await executor.execute(operation, pageVariables);
    const data = JSON.parse(resultString);
    const items = extractItems(data);

    allItems.push(...items);
    pageCount += 1;

    if (items.length < pageSize) {
      hasMore = false;
    } else {
      currentOffset += pageSize;
    }
  }

  return {
    hasMore,
    items: allItems,
    totalFetched: allItems.length,
  };
};

/**
 * Execute a paginated query, collecting all pages.
 */
export const executePaginated = async (
  ...[executor, operation, variables, config]: [
    GraphQLExecutor,
    string,
    Record<string, unknown>,
    PaginationConfig?,
  ]
): Promise<PaginatedResult> => {
  const style = config?.style ?? 'auto';
  const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;

  if (style === 'relay' || (style === 'auto' && isRelayOperation(operation))) {
    return executeRelayPaginated({ executor, maxPages, operation, pageSize, variables });
  }

  if (style === 'offset' || (style === 'auto' && isOffsetOperation(operation))) {
    return executeOffsetPaginated({ executor, maxPages, operation, pageSize, variables });
  }

  // Fallback: execute once, no pagination
  const resultString = await executor.execute(operation, variables);
  const data = JSON.parse(resultString);
  const items = extractItems(data);
  return {
    hasMore: false,
    items,
    totalFetched: items.length,
  };
};
