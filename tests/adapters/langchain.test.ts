import { describe, it, expect, vi } from 'vitest';
import { createLangChainTools, createStructuredTools } from '../../src/adapters/langchain.js';
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
        name: 'users',
        description: 'List all users',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } },
        args: [makeArg('limit', 'Int')],
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
        name: 'createUser',
        description: 'Create a new user',
        type: { kind: 'OBJECT', name: 'User', ofType: null },
        args: [makeRequiredArg('name', 'String'), makeArg('email', 'String')],
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
    execute: vi.fn().mockResolvedValue(JSON.stringify({ data: { user: { id: '1', name: 'Alice' } } })),
  } as unknown as GraphQLExecutor;
}

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
    expect((userTool?.schema.properties as any).id).toBeDefined();
    expect((userTool?.schema.required as string[])).toContain('id');
  });

  it('should execute operations via the executor', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user')!;
    const result = await userTool.func(JSON.stringify({ id: '1' }));

    expect(executor.execute).toHaveBeenCalled();
    expect(result).toContain('Alice');
  });

  it('should handle empty input string', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createLangChainTools(schema, executor);

    const usersTool = tools.find((t) => t.name === 'query_users')!;
    const result = await usersTool.func('');

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

    const userTool = tools.find((t) => t.name === 'query_user')!;
    const result = await userTool.func({ id: '1' });

    expect(executor.execute).toHaveBeenCalled();
    expect(result).toContain('Alice');
  });

  it('should validate input with Zod schema', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createStructuredTools(schema, executor);

    const createUserTool = tools.find((t) => t.name === 'mutate_createUser')!;
    // Should be able to parse valid input
    const parsed = createUserTool.schema.parse({ name: 'Bob' });
    expect(parsed.name).toBe('Bob');
  });
});
