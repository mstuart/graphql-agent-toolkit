import assert from 'node:assert/strict';
import { describe, it, expect, vi } from 'vitest';
import { createCrewAITools } from '../../src/adapters/crewai.js';
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
        args: [makeArgument('limit', 'Int'), makeArgument('offset', 'Int')],
        description: 'List posts',
        isDeprecated: false,
        name: 'posts',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'Post', ofType: null } },
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
        args: [makeRequiredArgument('id', 'ID')],
        description: 'Delete a user',
        isDeprecated: false,
        name: 'deleteUser',
        type: { kind: 'SCALAR', name: 'Boolean', ofType: null },
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
    fields: [makeField('id', 'ID', 'SCALAR'), makeField('name', 'String', 'SCALAR')],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'User',
    possibleTypes: [],
  });

  defineType(types, 'Post', {
    description: null,
    enumValues: [],
    fields: [makeField('id', 'ID', 'SCALAR'), makeField('title', 'String', 'SCALAR')],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'Post',
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
    .mockResolvedValue(JSON.stringify({ data: { user: { id: '1', name: 'Alice' } } })),
});

describe('createCrewAITools', () => {
  it('should generate tools for all query and mutation fields', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain('query_user');
    expect(names).toContain('query_posts');
    expect(names).toContain('mutate_deleteUser');
  });

  it('should use args_schema property (not schema)', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user');

    assert.ok(userTool);
    expect(userTool.args_schema).toBeDefined();
    expect(userTool.args_schema.type).toBe('object');
    expect('schema' in userTool).toBe(false);
  });

  it('should include required args in args_schema', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user');

    assert.ok(userTool);
    expect(userTool.args_schema.required as string[]).toContain('id');
    expect((userTool.args_schema.properties as Record<string, unknown>).id).toEqual({
      type: 'string',
    });
  });

  it('should map optional args correctly', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    const postsTool = tools.find((t) => t.name === 'query_posts');

    assert.ok(postsTool);
    const properties = postsTool.args_schema.properties as Record<string, unknown>;
    expect(properties.limit).toEqual({ type: 'integer' });
    expect(properties.offset).toEqual({ type: 'integer' });
    // No required array since both are optional
    expect(postsTool.args_schema.required).toBeUndefined();
  });

  it('should accept an object as func input (not string)', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user');

    assert.ok(userTool);
    const result = await userTool.func({ id: '1' });

    expect(executor.execute).toHaveBeenCalled();
    expect(result).toContain('Alice');
  });

  it('should execute mutations correctly', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    executor.execute.mockResolvedValue(JSON.stringify({ data: { deleteUser: true } }));

    const tools = createCrewAITools(schema, executor);
    const deleteTool = tools.find((t) => t.name === 'mutate_deleteUser');
    assert.ok(deleteTool);

    expect(deleteTool.description).toBe('Delete a user');
    const result = await deleteTool.func({ id: '1' });
    expect(result).toContain('true');
  });

  it('should respect maxDepth option', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor, { maxDepth: 1 });

    expect(tools).toHaveLength(3);
  });
});
