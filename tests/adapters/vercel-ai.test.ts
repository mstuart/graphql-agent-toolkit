import { describe, it, expect, vi } from 'vitest';
import { createVercelAITools } from '../../src/adapters/vercel-ai.js';
import type { ParsedSchema, SchemaType, SchemaField } from '../../src/types/schema.js';

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

const makeArgument = (name: string, typeName = 'String'): SchemaField['args'][number] => ({
  defaultValue: null,
  description: null,
  name,
  type: { kind: 'SCALAR', name: typeName, ofType: null },
});

const makeRequiredArgument = (name: string, typeName = 'String'): SchemaField['args'][number] => ({
  defaultValue: null,
  description: null,
  name,
  type: {
    kind: 'NON_NULL',
    name: null,
    ofType: { kind: 'SCALAR', name: typeName, ofType: null },
  },
});

const buildTestSchema = (): ParsedSchema => {
  const types = new Map<string, SchemaType>();

  defineType(types, 'Query', {
    description: null,
    enumValues: [],
    fields: [
      {
        args: [makeRequiredArgument('id', 'ID')],
        description: 'Fetch a user by ID',
        isDeprecated: false,
        name: 'user',
        type: { kind: 'OBJECT', name: 'User', ofType: null },
      },
      {
        args: [makeRequiredArgument('query', 'String'), makeArgument('limit', 'Int')],
        description: 'Search items',
        isDeprecated: false,
        name: 'search',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } },
      },
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'Query',
    possibleTypes: [],
  });

  defineType(types, 'Mutation', {
    description: null,
    enumValues: [],
    fields: [
      {
        args: [makeRequiredArgument('id', 'ID'), makeArgument('name', 'String')],
        description: 'Update a user',
        isDeprecated: false,
        name: 'updateUser',
        type: { kind: 'OBJECT', name: 'User', ofType: null },
      },
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'Mutation',
    possibleTypes: [],
  });

  defineType(types, 'User', {
    description: null,
    enumValues: [],
    fields: [
      makeField('id', 'ID', 'SCALAR'),
      makeField('name', 'String', 'SCALAR'),
      makeField('email', 'String', 'SCALAR'),
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'User',
    possibleTypes: [],
  });

  return {
    mutationType: 'Mutation',
    queryType: 'Query',
    subscriptionType: null,
    types,
  };
};

const createMockExecutor = () => ({
  execute: vi
    .fn()
    .mockResolvedValue(
      JSON.stringify({ data: { user: { email: 'a@b.com', id: '1', name: 'Alice' } } }),
    ),
});

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
    const parsedWithLimit = searchTool.parameters.parse({ limit: 10, query: 'test' });
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
    executor.execute.mockResolvedValue(
      JSON.stringify({ data: { updateUser: { id: '1', name: 'Updated' } } }),
    );

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
    const types = new Map<string, SchemaType>([
      [
        'Query',
        {
          description: null,
          enumValues: [],
          fields: [
            {
              args: [],
              description: 'Say hello',
              isDeprecated: false,
              name: 'hello',
              type: { kind: 'SCALAR', name: 'String', ofType: null },
            },
          ],
          inputFields: [],
          interfaces: [],
          kind: 'OBJECT',
          name: 'Query',
          possibleTypes: [],
        },
      ],
    ]);

    const schema: ParsedSchema = {
      mutationType: null,
      queryType: 'Query',
      subscriptionType: null,
      types,
    };

    const executor = createMockExecutor();
    const tools = createVercelAITools(schema, executor);

    expect(Object.keys(tools)).toHaveLength(1);
    expect(tools['query_hello']).toBeDefined();
  });
});
