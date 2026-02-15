import { describe, it, expect, vi } from 'vitest';
import { createVercelAITools } from '../../src/adapters/vercel-ai.js';
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

function makeArg(name: string, typeName: string = 'String'): SchemaField['args'][number] {
  return {
    name,
    description: null,
    type: { kind: 'SCALAR', name: typeName, ofType: null },
    defaultValue: null,
  };
}

function makeRequiredArg(name: string, typeName: string = 'String'): SchemaField['args'][number] {
  return {
    name,
    description: null,
    type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: typeName, ofType: null } },
    defaultValue: null,
  };
}

function buildTestSchema(): ParsedSchema {
  const types = new Map<string, SchemaType>();

  types.set('Query', {
    name: 'Query',
    kind: 'OBJECT',
    description: null,
    fields: [
      {
        name: 'user',
        description: 'Fetch a user by ID',
        type: { kind: 'OBJECT', name: 'User', ofType: null },
        args: [makeRequiredArg('id', 'ID')],
        isDeprecated: false,
      },
      {
        name: 'search',
        description: 'Search items',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } },
        args: [makeRequiredArg('query', 'String'), makeArg('limit', 'Int')],
        isDeprecated: false,
      },
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  types.set('Mutation', {
    name: 'Mutation',
    kind: 'OBJECT',
    description: null,
    fields: [
      {
        name: 'updateUser',
        description: 'Update a user',
        type: { kind: 'OBJECT', name: 'User', ofType: null },
        args: [makeRequiredArg('id', 'ID'), makeArg('name', 'String')],
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
      makeField('email', 'String', 'SCALAR'),
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  return {
    queryType: 'Query',
    mutationType: 'Mutation',
    subscriptionType: null,
    types,
  };
}

function createMockExecutor(): GraphQLExecutor {
  return {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ data: { user: { id: '1', name: 'Alice', email: 'a@b.com' } } })),
  } as unknown as GraphQLExecutor;
}

describe('createVercelAITools', () => {
  it('should return a Record (not array) keyed by tool name', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor);

    expect(typeof tools).toBe('object');
    expect(Array.isArray(tools)).toBe(false);
    expect(Object.keys(tools)).toHaveLength(3);
    expect(tools['query_user']).toBeDefined();
    expect(tools['query_search']).toBeDefined();
    expect(tools['mutate_updateUser']).toBeDefined();
  });

  it('should have description, parameters, and execute on each tool', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor);

    const userTool = tools['query_user'];
    expect(userTool.description).toBe('Fetch a user by ID');
    expect(userTool.parameters).toBeDefined();
    expect(typeof userTool.execute).toBe('function');
  });

  it('should use Zod schemas for parameters', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor);

    const userTool = tools['query_user'];
    // Zod schemas have parse method
    expect(typeof userTool.parameters.parse).toBe('function');
    // Should successfully parse valid input
    const parsed = userTool.parameters.parse({ id: '123' });
    expect(parsed.id).toBe('123');
  });

  it('should include both required and optional parameters', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor);

    const searchTool = tools['query_search'];
    // Required: query; Optional: limit
    const parsed = searchTool.parameters.parse({ query: 'test' });
    expect(parsed.query).toBe('test');

    // With optional param
    const parsedWithLimit = searchTool.parameters.parse({ query: 'test', limit: 10 });
    expect(parsedWithLimit.limit).toBe(10);
  });

  it('should execute operations via the executor', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor);

    const userTool = tools['query_user'];
    const result = await userTool.execute({ id: '1' });

    expect(executor.execute).toHaveBeenCalled();
    expect(result).toContain('Alice');
  });

  it('should execute mutations correctly', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    (executor.execute as any).mockResolvedValue(JSON.stringify({ data: { updateUser: { id: '1', name: 'Updated' } } }));

    const tools = createVercelAITools(schema, executor);
    const updateTool = tools['mutate_updateUser'];
    const result = await updateTool.execute({ id: '1', name: 'Updated' });

    expect(result).toContain('Updated');
  });

  it('should respect maxDepth option', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor, { maxDepth: 1 });

    expect(Object.keys(tools)).toHaveLength(3);
  });

  it('should handle schema with no mutations', () => {
    const types = new Map<string, SchemaType>();
    types.set('Query', {
      name: 'Query',
      kind: 'OBJECT',
      description: null,
      fields: [
        {
          name: 'hello',
          description: 'Say hello',
          type: { kind: 'SCALAR', name: 'String', ofType: null },
          args: [],
          isDeprecated: false,
        },
      ],
      inputFields: [],
      enumValues: [],
      interfaces: [],
      possibleTypes: [],
    });

    const schema: ParsedSchema = {
      queryType: 'Query',
      mutationType: null,
      subscriptionType: null,
      types,
    };

    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor);

    expect(Object.keys(tools)).toHaveLength(1);
    expect(tools['query_hello']).toBeDefined();
  });
});
