import { describe, it, expect, vi } from 'vitest';
import { createToolsFromSchema } from '../../src/mcp/tool-factory.js';
import { parseSchema } from '../../src/introspection/parser.js';
import { mockIntrospectionResult } from '../introspection/fixtures.js';
import { GraphQLExecutor } from '../../src/mcp/executor.js';

describe('createToolsFromSchema', () => {
  const schema = parseSchema(mockIntrospectionResult);

  // Create a mock executor
  const mockExecutor = {
    execute: vi.fn().mockResolvedValue('{"data": "test"}'),
  } as unknown as GraphQLExecutor;

  it('should create tools for query fields', () => {
    const tools = createToolsFromSchema(schema, mockExecutor);

    const queryTools = tools.filter((t) => t.name.startsWith('query_'));
    // Query has: user, users, posts (oldField is deprecated)
    expect(queryTools.length).toBe(3);
    expect(queryTools.map((t) => t.name)).toContain('query_user');
    expect(queryTools.map((t) => t.name)).toContain('query_users');
    expect(queryTools.map((t) => t.name)).toContain('query_posts');
  });

  it('should exclude deprecated fields by default', () => {
    const tools = createToolsFromSchema(schema, mockExecutor);
    const queryTools = tools.filter((t) => t.name.startsWith('query_'));
    expect(queryTools.map((t) => t.name)).not.toContain('query_oldField');
  });

  it('should include deprecated fields when option is set', () => {
    const tools = createToolsFromSchema(schema, mockExecutor, { includeDeprecated: true });
    const queryTools = tools.filter((t) => t.name.startsWith('query_'));
    expect(queryTools.map((t) => t.name)).toContain('query_oldField');
  });

  it('should create tools for mutation fields', () => {
    const tools = createToolsFromSchema(schema, mockExecutor);

    const mutationTools = tools.filter((t) => t.name.startsWith('mutate_'));
    expect(mutationTools.length).toBe(2);
    expect(mutationTools.map((t) => t.name)).toContain('mutate_createUser');
    expect(mutationTools.map((t) => t.name)).toContain('mutate_deleteUser');
  });

  it('should create input schemas with correct Zod types for arguments', () => {
    const tools = createToolsFromSchema(schema, mockExecutor);

    const userTool = tools.find((t) => t.name === 'query_user')!;
    expect(userTool.inputSchema).toBeDefined();
    expect('id' in userTool.inputSchema).toBe(true);
  });

  it('should use field description as tool description', () => {
    const tools = createToolsFromSchema(schema, mockExecutor);

    const userTool = tools.find((t) => t.name === 'query_user')!;
    expect(userTool.description).toBe('Fetch a user by ID');
  });

  it('should execute tool with executor', async () => {
    const tools = createToolsFromSchema(schema, mockExecutor);

    const userTool = tools.find((t) => t.name === 'query_user')!;
    const result = await userTool.execute({ id: '123' });
    expect(result).toBe('{"data": "test"}');
    expect(mockExecutor.execute).toHaveBeenCalled();
  });

  it('should create correct total number of tools', () => {
    const tools = createToolsFromSchema(schema, mockExecutor);
    // 3 queries (excluding deprecated) + 2 mutations = 5
    expect(tools.length).toBe(5);
  });
});
