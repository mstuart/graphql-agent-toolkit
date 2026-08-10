import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLNonNull,
  GraphQLID,
  GraphQLList,
  GraphQLInt,
  graphql,
} from 'graphql';
import { fetchSchema } from '../../src/introspection/fetcher.js';
import { parseSchema } from '../../src/introspection/parser.js';
import { buildOperation } from '../../src/operations/builder.js';
import { createToolsFromSchema } from '../../src/mcp/tool-factory.js';
import { GraphQLExecutor } from '../../src/mcp/executor.js';
import { SchemaNavigator } from '../../src/semantic/navigator.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Define a small test schema
const UserType: GraphQLObjectType = new GraphQLObjectType({
  fields: () => ({
    email: { type: new GraphQLNonNull(GraphQLString) },
    id: { type: new GraphQLNonNull(GraphQLID) },
    name: { type: GraphQLString },
  }),
  name: 'User',
});

const testSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    fields: {
      user: {
        args: {
          id: { description: 'The user ID', type: new GraphQLNonNull(GraphQLID) },
        },
        description: 'Get a user by ID',
        resolve: (_root, parameters) => ({
          email: 'test@example.com',
          id: parameters.id,
          name: 'Test User',
        }),
        type: UserType,
      },
      users: {
        args: {
          limit: { description: 'Max results', type: GraphQLInt },
        },
        description: 'List all users',
        resolve: (_root, parameters) => {
          const limit = parameters.limit ?? 2;
          return Array.from({ length: limit }, (_, index) => ({
            email: `user${index + 1}@example.com`,
            id: String(index + 1),
            name: `User ${index + 1}`,
          }));
        },
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserType))),
      },
    },
    name: 'Query',
  }),
});

const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString());

  const result = await graphql({
    schema: testSchema,
    source: body.query,
    variableValues: body.variables,
  });

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(result));
};

const server = createServer(handleRequest);
const serverState = { url: '' };

beforeAll(async () => {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not provide a TCP address');
  }
  serverState.url = `http://127.0.0.1:${address.port}/graphql`;
});

afterAll(async () => {
  const closed = once(server, 'close');
  server.close();
  await closed;
});

describe('Full Integration Flow', () => {
  it('should introspect, parse, build operations, create tools, and execute', async () => {
    // Step 1: Introspect
    const introspectionResult = await fetchSchema({ endpoint: serverState.url });
    expect(introspectionResult.__schema).toBeDefined();

    // Step 2: Parse
    const schema = parseSchema(introspectionResult);
    expect(schema.queryType).toBe('Query');
    expect(schema.types.has('User')).toBe(true);
    expect(schema.types.has('Query')).toBe(true);

    const userType = schema.types.get('User');

    assert.ok(userType);
    expect(userType.fields.map((f) => f.name)).toContain('id');
    expect(userType.fields.map((f) => f.name)).toContain('name');
    expect(userType.fields.map((f) => f.name)).toContain('email');

    // Step 3: Build an operation
    const userOp = buildOperation(schema, 'user');
    expect(userOp.operationType).toBe('query');
    expect(userOp.operation).toContain('user(id: $id)');
    expect(userOp.variables).toHaveLength(1);
    expect(userOp.variables[0].name).toBe('id');

    const usersOp = buildOperation(schema, 'users');
    expect(usersOp.operationType).toBe('query');
    expect(usersOp.operation).toContain('users');

    // Step 4: Create tools
    const executor = new GraphQLExecutor(serverState.url);
    const tools = createToolsFromSchema(schema, executor);

    const queryTools = tools.filter((t) => t.name.startsWith('query_'));
    expect(queryTools.map((t) => t.name)).toContain('query_user');
    expect(queryTools.map((t) => t.name)).toContain('query_users');

    // Step 5: Execute a query through a tool
    const userTool = tools.find((t) => t.name === 'query_user');
    assert.ok(userTool);
    const result = await userTool.execute({ id: '42' });
    const parsed = JSON.parse(result);

    expect(parsed.user).toBeDefined();
    expect(parsed.user.id).toBe('42');
    expect(parsed.user.name).toBe('Test User');
    expect(parsed.user.email).toBe('test@example.com');
  });

  it('should execute list queries correctly', async () => {
    const introspectionResult = await fetchSchema({ endpoint: serverState.url });
    const schema = parseSchema(introspectionResult);
    const executor = new GraphQLExecutor(serverState.url);
    const tools = createToolsFromSchema(schema, executor);

    const usersTool = tools.find((t) => t.name === 'query_users');

    assert.ok(usersTool);
    const result = await usersTool.execute({ limit: 3 });
    const parsed = JSON.parse(result);

    expect(parsed.users).toHaveLength(3);
    expect(parsed.users[0].name).toBe('User 1');
    expect(parsed.users[2].name).toBe('User 3');
  });

  it('should support semantic navigation', async () => {
    const introspectionResult = await fetchSchema({ endpoint: serverState.url });
    const schema = parseSchema(introspectionResult);

    const navigator = new SchemaNavigator();
    navigator.index(schema);

    const results = navigator.search('user');
    expect(results.length).toBeGreaterThan(0);

    const userResult = results.find((r) => r.typeName === 'User');
    expect(userResult).toBeDefined();

    const context = navigator.getTypeContext('User');
    expect(context).toContain('OBJECT User');
    expect(context).toContain('id');
    expect(context).toContain('name');
    expect(context).toContain('email');
  });
});
