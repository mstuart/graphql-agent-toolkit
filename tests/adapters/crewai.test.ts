import { describe, it, expect, vi } from 'vitest';
import { createCrewAITools } from '../../src/adapters/crewai.js';
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
        name: 'posts',
        description: 'List posts',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'Post', ofType: null } },
        args: [makeArg('limit', 'Int'), makeArg('offset', 'Int')],
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
        name: 'deleteUser',
        description: 'Delete a user',
        type: { kind: 'SCALAR', name: 'Boolean', ofType: null },
        args: [makeRequiredArg('id', 'ID')],
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

  types.set('Post', {
    name: 'Post',
    kind: 'OBJECT',
    description: null,
    fields: [
      makeField('id', 'ID', 'SCALAR'),
      makeField('title', 'String', 'SCALAR'),
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

    const userTool = tools.find((t) => t.name === 'query_user')!;
    expect(userTool.args_schema).toBeDefined();
    expect(userTool.args_schema.type).toBe('object');
    expect((userTool as any).schema).toBeUndefined();
  });

  it('should include required args in args_schema', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user')!;
    expect((userTool.args_schema.required as string[])).toContain('id');
    expect((userTool.args_schema.properties as any).id).toEqual({ type: 'string' });
  });

  it('should map optional args correctly', () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    const postsTool = tools.find((t) => t.name === 'query_posts')!;
    const props = postsTool.args_schema.properties as Record<string, any>;
    expect(props.limit).toEqual({ type: 'integer' });
    expect(props.offset).toEqual({ type: 'integer' });
    // No required array since both are optional
    expect(postsTool.args_schema.required).toBeUndefined();
  });

  it('should accept an object as func input (not string)', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    const tools = createCrewAITools(schema, executor);

    const userTool = tools.find((t) => t.name === 'query_user')!;
    const result = await userTool.func({ id: '1' });

    expect(executor.execute).toHaveBeenCalled();
    expect(result).toContain('Alice');
  });

  it('should execute mutations correctly', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor();
    (executor.execute as any).mockResolvedValue(JSON.stringify({ data: { deleteUser: true } }));

    const tools = createCrewAITools(schema, executor);
    const deleteTool = tools.find((t) => t.name === 'mutate_deleteUser')!;

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
