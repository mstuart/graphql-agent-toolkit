import { describe, it, expect, vi } from 'vitest';
import { detectPaginationStyle, executePaginated } from '../../src/pagination/handler.js';
import type { ParsedSchema, SchemaType, SchemaField } from '../../src/types/schema.js';
import type { GraphQLExecutor } from '../../src/mcp/executor.js';

const defineType = (types: Map<string, SchemaType>, name: string, type: SchemaType): void => {
  types.set(name, type);
};

const makeField = (
  name: string,
  typeName: string,
  kind: SchemaField['type']['kind'] = 'OBJECT',
): SchemaField => ({
  args: [],
  description: null,
  isDeprecated: false,
  name,
  type: { kind, name: typeName, ofType: null },
});

const makeListField = (
  name: string,
  typeName: string,
  parameters: SchemaField['args'] = [],
): SchemaField => ({
  args: parameters,
  description: null,
  isDeprecated: false,
  name,
  type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: typeName, ofType: null } },
});

const makeArgument = (name: string, typeName = 'Int'): SchemaField['args'][number] => ({
  defaultValue: null,
  description: null,
  name,
  type: { kind: 'SCALAR', name: typeName, ofType: null },
});

const buildRelaySchema = (): ParsedSchema => {
  const types = new Map<string, SchemaType>();

  defineType(types, 'Query', {
    description: null,
    enumValues: [],
    fields: [
      {
        args: [makeArgument('first', 'Int'), makeArgument('after', 'String')],
        description: 'Get users',
        isDeprecated: false,
        name: 'users',
        type: { kind: 'OBJECT', name: 'UserConnection', ofType: null },
      },
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'Query',
    possibleTypes: [],
  });

  defineType(types, 'UserConnection', {
    description: null,
    enumValues: [],
    fields: [makeListField('edges', 'UserEdge'), makeField('pageInfo', 'PageInfo')],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'UserConnection',
    possibleTypes: [],
  });

  defineType(types, 'UserEdge', {
    description: null,
    enumValues: [],
    fields: [makeField('node', 'User'), makeField('cursor', 'String', 'SCALAR')],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'UserEdge',
    possibleTypes: [],
  });

  defineType(types, 'PageInfo', {
    description: null,
    enumValues: [],
    fields: [
      makeField('hasNextPage', 'Boolean', 'SCALAR'),
      makeField('hasPreviousPage', 'Boolean', 'SCALAR'),
      makeField('startCursor', 'String', 'SCALAR'),
      makeField('endCursor', 'String', 'SCALAR'),
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'PageInfo',
    possibleTypes: [],
  });

  defineType(types, 'User', {
    description: null,
    enumValues: [],
    fields: [makeField('id', 'ID', 'SCALAR'), makeField('name', 'String', 'SCALAR')],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'User',
    possibleTypes: [],
  });

  return {
    mutationType: null,
    queryType: 'Query',
    subscriptionType: null,
    types,
  };
};

const buildOffsetSchema = (): ParsedSchema => {
  const types = new Map<string, SchemaType>();

  defineType(types, 'Query', {
    description: null,
    enumValues: [],
    fields: [
      {
        args: [makeArgument('limit', 'Int'), makeArgument('offset', 'Int')],
        description: 'Get users',
        isDeprecated: false,
        name: 'users',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } },
      },
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'Query',
    possibleTypes: [],
  });

  defineType(types, 'User', {
    description: null,
    enumValues: [],
    fields: [makeField('id', 'ID', 'SCALAR'), makeField('name', 'String', 'SCALAR')],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'User',
    possibleTypes: [],
  });

  return {
    mutationType: null,
    queryType: 'Query',
    subscriptionType: null,
    types,
  };
};

describe('detectPaginationStyle', () => {
  it.each([
    {
      expected: 'relay',
      schema: buildRelaySchema,
      typeName: 'UserConnection',
    },
    { expected: 'offset', schema: buildOffsetSchema, typeName: 'User' },
    { expected: 'none', schema: buildRelaySchema, typeName: 'User' },
    {
      expected: 'none',
      schema: buildRelaySchema,
      typeName: 'NonExistent',
    },
  ])('should detect $expected pagination for $typeName', ({ expected, schema, typeName }) => {
    expect(detectPaginationStyle(schema(), typeName)).toBe(expected);
  });
});

describe('executePaginated - Relay', () => {
  it('should collect all pages from relay pagination', async () => {
    const page1Response = JSON.stringify({
      users: {
        edges: [{ node: { id: '1', name: 'Alice' } }, { node: { id: '2', name: 'Bob' } }],
        pageInfo: {
          endCursor: 'cursor2',
          hasNextPage: true,
          startCursor: 'cursor1',
        },
      },
    });

    const page2Response = JSON.stringify({
      users: {
        edges: [{ node: { id: '3', name: 'Charlie' } }],
        pageInfo: {
          endCursor: 'cursor3',
          hasNextPage: false,
          startCursor: 'cursor2',
        },
      },
    });

    const mockExecutor = {
      execute: vi.fn().mockResolvedValueOnce(page1Response).mockResolvedValueOnce(page2Response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($first: Int, $after: String) {
      users(first: $first, after: $after) {
        edges { node { id name } }
        pageInfo { hasNextPage endCursor startCursor }
      }
    }`;

    const result = await executePaginated(
      mockExecutor,
      operation,
      {},
      {
        pageSize: 2,
        style: 'relay',
      },
    );

    expect(result.items).toHaveLength(3);
    expect(result.totalFetched).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(result.cursors).toEqual({ end: 'cursor3', start: 'cursor1' });
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it('should respect maxPages limit for relay pagination', async () => {
    const pageResponse = JSON.stringify({
      users: {
        edges: [{ node: { id: '1', name: 'Alice' } }],
        pageInfo: {
          endCursor: 'cursorN',
          hasNextPage: true,
          startCursor: 'cursor1',
        },
      },
    });

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(pageResponse),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($first: Int, $after: String) {
      users(first: $first, after: $after) {
        edges { node { id name } }
        pageInfo { hasNextPage endCursor startCursor }
      }
    }`;

    const result = await executePaginated(
      mockExecutor,
      operation,
      {},
      {
        maxPages: 3,
        pageSize: 1,
        style: 'relay',
      },
    );

    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
  });
});

describe('executePaginated - Offset', () => {
  it('should collect all pages from offset pagination', async () => {
    const page1Response = JSON.stringify({
      users: [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
    });

    const page2Response = JSON.stringify({
      users: [{ id: '3', name: 'Charlie' }],
    });

    const mockExecutor = {
      execute: vi.fn().mockResolvedValueOnce(page1Response).mockResolvedValueOnce(page2Response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($limit: Int, $offset: Int) {
      users(limit: $limit, offset: $offset) { id name }
    }`;

    const result = await executePaginated(
      mockExecutor,
      operation,
      {},
      {
        pageSize: 2,
        style: 'offset',
      },
    );

    expect(result.items).toHaveLength(3);
    expect(result.totalFetched).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it('should use skip/take when detected in operation', async () => {
    const page1Response = JSON.stringify({
      users: [{ id: '1' }],
    });

    const page2Response = JSON.stringify({
      users: [],
    });

    const mockExecutor = {
      execute: vi.fn().mockResolvedValueOnce(page1Response).mockResolvedValueOnce(page2Response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($skip: Int, $take: Int) {
      users(skip: $skip, take: $take) { id }
    }`;

    const result = await executePaginated(
      mockExecutor,
      operation,
      {},
      {
        pageSize: 1,
        style: 'offset',
      },
    );

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);

    const [firstCall] = vi.mocked(mockExecutor.execute).mock.calls;
    expect(firstCall?.at(1)).toEqual({ skip: 0, take: 1 });
  });

  it('should respect maxPages limit for offset pagination', async () => {
    const pageResponse = JSON.stringify({
      users: [{ id: '1' }, { id: '2' }],
    });

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(pageResponse),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($limit: Int, $offset: Int) {
      users(limit: $limit, offset: $offset) { id }
    }`;

    const result = await executePaginated(
      mockExecutor,
      operation,
      {},
      {
        maxPages: 2,
        pageSize: 2,
        style: 'offset',
      },
    );

    expect(result.items).toHaveLength(4);
    expect(result.hasMore).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
  });
});

describe('executePaginated - Auto', () => {
  it('should auto-detect relay style from operation', async () => {
    const response = JSON.stringify({
      users: {
        edges: [{ node: { id: '1' } }],
        pageInfo: { endCursor: 'c1', hasNextPage: false },
      },
    });

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($first: Int, $after: String) {
      users(first: $first, after: $after) {
        edges { node { id } }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    const result = await executePaginated(
      mockExecutor,
      operation,
      {},
      {
        pageSize: 10,
        style: 'auto',
      },
    );

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it('should fall back to single execution when no pagination detected', async () => {
    const response = JSON.stringify({
      users: [{ id: '1' }, { id: '2' }],
    });

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users { users { id } }`;

    const result = await executePaginated(
      mockExecutor,
      operation,
      {},
      {
        pageSize: 10,
        style: 'auto',
      },
    );

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
  });
});
