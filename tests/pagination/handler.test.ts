import { describe, it, expect, vi } from 'vitest';
import { detectPaginationStyle, executePaginated } from '../../src/pagination/handler.js';
import type { ParsedSchema, SchemaType, SchemaField } from '../../src/types/schema.js';
import type { GraphQLExecutor } from '../../src/mcp/executor.js';

function makeField(name: string, typeName: string, kind: string = 'OBJECT', args: SchemaField['args'] = []): SchemaField {
  return {
    name,
    description: null,
    type: { kind: kind as any, name: typeName, ofType: null },
    args,
    isDeprecated: false,
  };
}

function makeListField(name: string, typeName: string, args: SchemaField['args'] = []): SchemaField {
  return {
    name,
    description: null,
    type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: typeName, ofType: null } },
    args,
    isDeprecated: false,
  };
}

function makeArg(name: string, typeName: string = 'Int'): SchemaField['args'][number] {
  return {
    name,
    description: null,
    type: { kind: 'SCALAR', name: typeName, ofType: null },
    defaultValue: null,
  };
}

function buildRelaySchema(): ParsedSchema {
  const types = new Map<string, SchemaType>();

  types.set('Query', {
    name: 'Query',
    kind: 'OBJECT',
    description: null,
    fields: [
      {
        name: 'users',
        description: 'Get users',
        type: { kind: 'OBJECT', name: 'UserConnection', ofType: null },
        args: [
          makeArg('first', 'Int'),
          makeArg('after', 'String'),
        ],
        isDeprecated: false,
      },
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  types.set('UserConnection', {
    name: 'UserConnection',
    kind: 'OBJECT',
    description: null,
    fields: [
      makeListField('edges', 'UserEdge'),
      makeField('pageInfo', 'PageInfo'),
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  types.set('UserEdge', {
    name: 'UserEdge',
    kind: 'OBJECT',
    description: null,
    fields: [
      makeField('node', 'User'),
      makeField('cursor', 'String', 'SCALAR'),
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  types.set('PageInfo', {
    name: 'PageInfo',
    kind: 'OBJECT',
    description: null,
    fields: [
      makeField('hasNextPage', 'Boolean', 'SCALAR'),
      makeField('hasPreviousPage', 'Boolean', 'SCALAR'),
      makeField('startCursor', 'String', 'SCALAR'),
      makeField('endCursor', 'String', 'SCALAR'),
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  types.set('User', {
    name: 'User',
    kind: 'OBJECT',
    description: null,
    fields: [
      makeField('id', 'ID', 'SCALAR'),
      makeField('name', 'String', 'SCALAR'),
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  return {
    queryType: 'Query',
    mutationType: null,
    subscriptionType: null,
    types,
  };
}

function buildOffsetSchema(): ParsedSchema {
  const types = new Map<string, SchemaType>();

  types.set('Query', {
    name: 'Query',
    kind: 'OBJECT',
    description: null,
    fields: [
      {
        name: 'users',
        description: 'Get users',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } },
        args: [
          makeArg('limit', 'Int'),
          makeArg('offset', 'Int'),
        ],
        isDeprecated: false,
      },
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  types.set('User', {
    name: 'User',
    kind: 'OBJECT',
    description: null,
    fields: [
      makeField('id', 'ID', 'SCALAR'),
      makeField('name', 'String', 'SCALAR'),
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  return {
    queryType: 'Query',
    mutationType: null,
    subscriptionType: null,
    types,
  };
}

describe('detectPaginationStyle', () => {
  it('should detect Relay pagination style', () => {
    const schema = buildRelaySchema();
    const style = detectPaginationStyle(schema, 'UserConnection');
    expect(style).toBe('relay');
  });

  it('should detect offset pagination style', () => {
    const schema = buildOffsetSchema();
    const style = detectPaginationStyle(schema, 'User');
    expect(style).toBe('offset');
  });

  it('should return none for types without pagination', () => {
    const schema = buildRelaySchema();
    const style = detectPaginationStyle(schema, 'User');
    expect(style).toBe('none');
  });

  it('should return none for non-existent types', () => {
    const schema = buildRelaySchema();
    const style = detectPaginationStyle(schema, 'NonExistent');
    expect(style).toBe('none');
  });
});

describe('executePaginated - Relay', () => {
  it('should collect all pages from relay pagination', async () => {
    const page1Response = JSON.stringify({
      users: {
        edges: [
          { node: { id: '1', name: 'Alice' } },
          { node: { id: '2', name: 'Bob' } },
        ],
        pageInfo: {
          hasNextPage: true,
          endCursor: 'cursor2',
          startCursor: 'cursor1',
        },
      },
    });

    const page2Response = JSON.stringify({
      users: {
        edges: [
          { node: { id: '3', name: 'Charlie' } },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: 'cursor3',
          startCursor: 'cursor2',
        },
      },
    });

    const mockExecutor = {
      execute: vi.fn()
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($first: Int, $after: String) {
      users(first: $first, after: $after) {
        edges { node { id name } }
        pageInfo { hasNextPage endCursor startCursor }
      }
    }`;

    const result = await executePaginated(mockExecutor, operation, {}, {
      style: 'relay',
      pageSize: 2,
    });

    expect(result.items).toHaveLength(3);
    expect(result.totalFetched).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(result.cursors).toEqual({ start: 'cursor1', end: 'cursor3' });
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it('should respect maxPages limit for relay pagination', async () => {
    const pageResponse = JSON.stringify({
      users: {
        edges: [
          { node: { id: '1', name: 'Alice' } },
        ],
        pageInfo: {
          hasNextPage: true,
          endCursor: 'cursorN',
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

    const result = await executePaginated(mockExecutor, operation, {}, {
      style: 'relay',
      pageSize: 1,
      maxPages: 3,
    });

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
      users: [
        { id: '3', name: 'Charlie' },
      ],
    });

    const mockExecutor = {
      execute: vi.fn()
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($limit: Int, $offset: Int) {
      users(limit: $limit, offset: $offset) { id name }
    }`;

    const result = await executePaginated(mockExecutor, operation, {}, {
      style: 'offset',
      pageSize: 2,
    });

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
      execute: vi.fn()
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response),
    } as unknown as GraphQLExecutor;

    const operation = `query Users($skip: Int, $take: Int) {
      users(skip: $skip, take: $take) { id }
    }`;

    const result = await executePaginated(mockExecutor, operation, {}, {
      style: 'offset',
      pageSize: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);

    const firstCall = (mockExecutor.execute as any).mock.calls[0];
    expect(firstCall[1]).toEqual({ skip: 0, take: 1 });
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

    const result = await executePaginated(mockExecutor, operation, {}, {
      style: 'offset',
      pageSize: 2,
      maxPages: 2,
    });

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
        pageInfo: { hasNextPage: false, endCursor: 'c1' },
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

    const result = await executePaginated(mockExecutor, operation, {}, {
      style: 'auto',
      pageSize: 10,
    });

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

    const result = await executePaginated(mockExecutor, operation, {}, {
      style: 'auto',
      pageSize: 10,
    });

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
  });
});
