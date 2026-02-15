import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLNonNull,
  GraphQLID,
  GraphQLList,
  GraphQLInt,
  graphql,
  getIntrospectionQuery,
} from 'graphql';
import { fetchSchema } from '../../src/introspection/fetcher.js';
import { parseSchema } from '../../src/introspection/parser.js';
import { buildOperation } from '../../src/operations/builder.js';
import { createToolsFromSchema } from '../../src/mcp/tool-factory.js';
import { GraphQLExecutor } from '../../src/mcp/executor.js';
import { SchemaNavigator } from '../../src/semantic/navigator.js';

// Define a small test schema
const UserType: GraphQLObjectType = new GraphQLObjectType({
  name: 'User',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    name: { type: GraphQLString },
    email: { type: new GraphQLNonNull(GraphQLString) },
  }),
});

const testSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      user: {
        type: UserType,
        description: 'Get a user by ID',
        args: {
          id: { type: new GraphQLNonNull(GraphQLID), description: 'The user ID' },
        },
        resolve: (_root, args) => ({
          id: args.id,
          name: 'Test User',
          email: 'test@example.com',
        }),
      },
      users: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(UserType))),
        description: 'List all users',
        args: {
          limit: { type: GraphQLInt, description: 'Max results' },
        },
        resolve: (_root, args) => {
          const limit = args.limit ?? 2;
          return Array.from({ length: limit }, (_, i) => ({
            id: String(i + 1),
            name: `User ${i + 1}`,
            email: `user${i + 1}@example.com`,
          }));
        },
      },
    },
  }),
});

let server: Server;
let serverUrl: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const result = await graphql({
      schema: testSchema,
      source: body.query,
      variableValues: body.variables,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        serverUrl = `http://127.0.0.1:${addr.port}/graphql`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('Full Integration Flow', () => {
  it('should introspect, parse, build operations, create tools, and execute', async () => {
    // Step 1: Introspect
    const introspectionResult = await fetchSchema({ endpoint: serverUrl });
    expect(introspectionResult.__schema).toBeDefined();

    // Step 2: Parse
    const schema = parseSchema(introspectionResult);
    expect(schema.queryType).toBe('Query');
    expect(schema.types.has('User')).toBe(true);
    expect(schema.types.has('Query')).toBe(true);

    const userType = schema.types.get('User')!;
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
    const executor = new GraphQLExecutor(serverUrl);
    const tools = createToolsFromSchema(schema, executor);

    const queryTools = tools.filter((t) => t.name.startsWith('query_'));
    expect(queryTools.map((t) => t.name)).toContain('query_user');
    expect(queryTools.map((t) => t.name)).toContain('query_users');

    // Step 5: Execute a query through a tool
    const userTool = tools.find((t) => t.name === 'query_user')!;
    const result = await userTool.execute({ id: '42' });
    const parsed = JSON.parse(result);

    expect(parsed.user).toBeDefined();
    expect(parsed.user.id).toBe('42');
    expect(parsed.user.name).toBe('Test User');
    expect(parsed.user.email).toBe('test@example.com');
  });

  it('should execute list queries correctly', async () => {
    const introspectionResult = await fetchSchema({ endpoint: serverUrl });
    const schema = parseSchema(introspectionResult);
    const executor = new GraphQLExecutor(serverUrl);
    const tools = createToolsFromSchema(schema, executor);

    const usersTool = tools.find((t) => t.name === 'query_users')!;
    const result = await usersTool.execute({ limit: 3 });
    const parsed = JSON.parse(result);

    expect(parsed.users).toHaveLength(3);
    expect(parsed.users[0].name).toBe('User 1');
    expect(parsed.users[2].name).toBe('User 3');
  });

  it('should support semantic navigation', async () => {
    const introspectionResult = await fetchSchema({ endpoint: serverUrl });
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
