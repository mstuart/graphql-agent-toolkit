import assert from 'node:assert/strict';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildSchema, introspectionFromSchema, parse, validate, graphqlSync } from 'graphql';
import { parseSchema } from '../src/introspection/parser.js';
import { buildOperation } from '../src/operations/builder.js';
import { createToolsFromSchema } from '../src/mcp/tool-factory.js';
import { createStructuredTools, createLangChainTools } from '../src/adapters/langchain.js';
import { createCrewAITools } from '../src/adapters/crewai.js';
import { createVercelAITools } from '../src/adapters/vercel-ai.js';
import { summarizeResponse, formatForLLM } from '../src/summarizer/summarizer.js';
import type { GraphQLExecutor } from '../src/mcp/executor.js';

const parsed = (sdl: string) => parseSchema(introspectionFromSchema(buildSchema(sdl)));
const executor = () => ({ execute: vi.fn().mockResolvedValue('{}') }) as unknown as GraphQLExecutor;

it('omits nested fields whose required arguments cannot be supplied', () => {
  const source = buildSchema(
    'type Query { user: User } type User { id: ID display(locale:String!):String related(id:ID!):User }',
  );
  const op = buildOperation(parseSchema(introspectionFromSchema(source)), 'user');
  expect(validate(source, parse(op.operation))).toEqual([]);
  expect(op.operation).not.toContain('display');
  expect(op.operation).not.toContain('related');
});
it.each(['result', 'user'])(
  'keeps composite root %s outputs valid even without selectable fields',
  (name) => {
    const source = buildSchema(
      'type Query { result: Search user: User } union Search = User type User { id: ID }',
    );
    const op = buildOperation(parseSchema(introspectionFromSchema(source)), name, { maxDepth: 0 });
    expect(validate(source, parse(op.operation))).toEqual([]);
    expect(op.operation).toContain('__typename');
  },
);
it('mutation tools select mutations when a query uses the same field name', async () => {
  const schema = parsed('type Query { item: String } type Mutation { item: Int }');
  const ex = executor();
  const mcp = createToolsFromSchema(schema, ex).find((tool) => tool.name === 'mutate_item');
  const structured = createStructuredTools(schema, ex).find((tool) => tool.name === 'mutate_item');
  const langchain = createLangChainTools(schema, ex).find((tool) => tool.name === 'mutate_item');
  const crew = createCrewAITools(schema, ex).find((tool) => tool.name === 'mutate_item');
  assert.ok(mcp);
  assert.ok(structured);
  assert.ok(langchain);
  assert.ok(crew);
  await mcp.execute({});
  await structured.func({});
  await langchain.func('{}');
  await crew.func({});
  await createVercelAITools(schema, ex).mutate_item.execute({});
  for (const [operation] of vi.mocked(ex.execute).mock.calls) {
    expect(parse(operation).definitions[0]).toMatchObject({ operation: 'mutation' });
  }
});
it('preserves argument defaults in generated operations and tool schemas', () => {
  const source = buildSchema(
    'type Query { greet(name:String!="friend", options:Options):String } input Options { limit:Int! = 5 }',
  );
  const schema = parseSchema(introspectionFromSchema(source));
  const op = buildOperation(schema, 'greet');
  const result = graphqlSync({
    rootValue: { greet: () => 'ok' },
    schema: source,
    source: op.operation,
    variableValues: {},
  });
  expect(result.errors).toBeUndefined();
  const nameVariable = op.variables.find((variable) => variable.name === 'name');
  assert.ok(nameVariable);
  expect(nameVariable.required).toBe(false);
  const ex = executor();
  const input = z.object(createToolsFromSchema(schema, ex)[0].inputSchema);
  expect(input.safeParse({ options: {} }).success).toBe(true);
  expect(input.safeParse({ name: null }).success).toBe(false);
  expect(createStructuredTools(schema, ex)[0].schema.safeParse({ options: {} }).success).toBe(true);
  expect(
    createVercelAITools(schema, ex).query_greet.parameters.safeParse({ options: {} }).success,
  ).toBe(true);
  expect(createLangChainTools(schema, ex)[0].schema.required ?? []).not.toContain('name');
  expect(createCrewAITools(schema, ex)[0].args_schema.required ?? []).not.toContain('name');
});
it('builds recursive input schemas lazily for Zod-backed tools', () => {
  const schema = parsed(
    'type Query { search(filter:Filter):String } input Filter { term:String and:[Filter!] }',
  );
  const ex = executor();
  const input = { filter: { and: [{ term: 'name' }] } };
  expect(z.object(createToolsFromSchema(schema, ex)[0].inputSchema).safeParse(input).success).toBe(
    true,
  );
  expect(createStructuredTools(schema, ex)[0].schema.safeParse(input).success).toBe(true);
  expect(createVercelAITools(schema, ex).query_search.parameters.safeParse(input).success).toBe(
    true,
  );
});
it('rejects GraphQL Int values outside the signed 32-bit range', () => {
  const schema = parsed('type Query { find(limit:Int):String }');
  const input = z.object(createToolsFromSchema(schema, executor())[0].inputSchema);
  expect(input.safeParse({ limit: 2_147_483_648 }).success).toBe(false);
  expect(input.safeParse({ limit: -2_147_483_649 }).success).toBe(false);
  expect(input.safeParse({ limit: 2_147_483_647 }).success).toBe(true);
  expect(input.safeParse({ limit: -2_147_483_648 }).success).toBe(true);
});
it('summarizes undefined input using the renderer null representation', () => {
  const { summary, metadata } = summarizeResponse(undefined);
  expect(summary).toBeUndefined();
  expect(metadata).toEqual({ originalSize: 0, totalItems: 0, truncated: false });
  expect(formatForLLM(undefined)).toBe('null');
});

it('exports recursive Zod tool inputs as finite JSON Schema references', () => {
  const schema = parsed(
    'type Query { search(filter:Filter):String } input Filter { term:String and:[Filter!] }',
  );
  const input = z.object(createToolsFromSchema(schema, executor())[0].inputSchema);
  const jsonSchema = z.toJSONSchema(input);
  expect(JSON.stringify(jsonSchema)).toContain('$ref');
});
