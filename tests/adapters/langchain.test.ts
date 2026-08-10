import assert from 'node:assert/strict';
import { describe, it, expect, vi } from 'vitest';
import { createLangChainTools, createStructuredTools } from '../../src/adapters/langchain.js';
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
        args: [makeArgument('limit', 'Int')],
        description: 'List all users',
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

  defineType(types, 'Mutation', {
    description: null,
    enumValues: [],
    fields: [
      {
        args: [makeRequiredArgument('name', 'String'), makeArgument('email', 'String')],
        description: 'Create a new user',
        isDeprecated: false,
        name: 'createUser',
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

const createMockExecutor = (): GraphQLExecutor =>
  ({
    execute: vi
      .fn()
      .mockResolvedValue(JSON.stringify({ data: { user: { id: '1', name: 'Alice' } } })),
  }) as unknown as GraphQLExecutor;

describe('createLangChainTools', () => {
  it('should generate a tool for each query and mutation field', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor);

    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain('query_user');
    expect(names).toContain('query_users');
    expect(names).toContain('mutate_createUser');
  });

  it('should map field descriptions to tool descriptions', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user');
    expect(userTool?.description).toBe('Fetch a user by ID');
  });

  it('should generate JSON Schema for tool arguments', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user');
    expect(userTool?.schema).toBeDefined();
    expect(userTool?.schema.type).toBe('object');
    expect((userTool?.schema.properties as Record<string, unknown>).id).toBeDefined();
    expect(userTool?.schema.required as string[]).toContain('id');
  });

  it('should execute operations via the executor', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user');

    assert.ok(userTool);
    const result = await userTool.func(JSON.stringify({ id: '1' }));

    expect(executor.execute).toHaveBeenCalled();
    expect(result).toContain('Alice');
  });

  it('should handle empty input string', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor);

    const usersTool = tools.find((t) => t.name === 'query_users');

    assert.ok(usersTool);
    await usersTool.func('');

    expect(executor.execute).toHaveBeenCalled();
  });

  it('should respect maxDepth option', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor, { maxDepth: 1 });

    // Should still create tools regardless of depth
    expect(tools).toHaveLength(3);
  });
});

describe('createStructuredTools', () => {
  it('should generate structured tools with Zod schemas', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createStructuredTools(schema, executor);

    expect(tools).toHaveLength(3);

    const userTool = tools.find((t) => t.name === 'query_user');
    expect(userTool?.schema).toBeDefined();
    // Zod schemas have a parse method
    expect(typeof userTool?.schema.parse).toBe('function');
  });

  it('should accept typed object input, not string', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createStructuredTools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user');

    assert.ok(userTool);
    const result = await userTool.func({ id: '1' });

    expect(executor.execute).toHaveBeenCalled();
    expect(result).toContain('Alice');
  });

  it('should validate input with Zod schema', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createStructuredTools(schema, executor);

    const createUserTool = tools.find((t) => t.name === 'mutate_createUser');

    assert.ok(createUserTool);
    // Should be able to parse valid input
    const parsed = createUserTool.schema.parse({ name: 'Bob' });
    expect(parsed.name).toBe('Bob');
  });
});
