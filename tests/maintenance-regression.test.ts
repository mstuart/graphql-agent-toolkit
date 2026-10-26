import { expect, it, vi } from 'vitest';
import { buildSchema, introspectionFromSchema } from 'graphql';
import { parseSchema } from '../src/introspection/parser.js';
import { executePaginated } from '../src/pagination/handler.js';
import { createMockExecutor, generateMockData } from '../src/mock/generator.js';
import { summarizeResponse } from '../src/summarizer/summarizer.js';
import type { GraphQLExecutor } from '../src/mcp/executor.js';

const schema = parseSchema(
  introspectionFromSchema(
    buildSchema('type Query { users: [User] user: User } type User { name: String }'),
  ),
);

it.each(['offset', 'skip'])('starts pagination at the supplied %s', async (key) => {
  const execute = vi.fn().mockResolvedValue('{"users":[]}');
  const operation =
    key === 'skip' ? 'query($skip:Int,$take:Int){users}' : 'query($offset:Int,$limit:Int){users}';
  await executePaginated(
    { execute } as unknown as GraphQLExecutor,
    operation,
    { [key]: 40 },
    { pageSize: 20, style: 'offset' },
  );
  expect(execute.mock.calls[0][1][key]).toBe(40);
});

it('rejects invalid pagination bounds before making a request', async () => {
  const execute = vi.fn().mockResolvedValue('{"users":[]}');
  const executor = { execute } as unknown as GraphQLExecutor;
  await expect(
    executePaginated(executor, '{users}', {}, { pageSize: 0, style: 'offset' }),
  ).rejects.toThrow(RangeError);
  await expect(
    executePaginated(executor, '{users}', {}, { maxPages: NaN, pageSize: 20, style: 'offset' }),
  ).rejects.toThrow(RangeError);
  expect(execute).not.toHaveBeenCalled();
});

it('stops when a Relay server repeats a cursor', async () => {
  const execute = vi
    .fn()
    .mockResolvedValue(
      '{"users":{"edges":[{"node":{"name":"A"}}],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}',
    );
  const result = await executePaginated(
    { execute } as unknown as GraphQLExecutor,
    '{users}',
    {},
    { maxPages: 5, pageSize: 1, style: 'relay' },
  );
  expect(execute).toHaveBeenCalledTimes(2);
  expect(result.hasMore).toBe(true);
});

it('uses the actual root field and the response alias in mock operations', async () => {
  const executor = createMockExecutor(schema);
  const result = JSON.parse(await executor.execute('{ alias: user { name } }'));
  expect(result.data.alias).toEqual({ name: 'mock_name' });
});

it('rejects mock sizes that can overrun or skip generation', () => {
  expect(() => generateMockData(schema, 'User', { arrayLength: 1.5 })).toThrow(RangeError);
  expect(() => createMockExecutor(schema, { arrayLength: -1 })).toThrow(RangeError);
});

it('preserves own prototype-named JSON fields when summarizing', () => {
  const data = JSON.parse('{"__proto__":{"name":"kept"},"name":"other"}');
  const { summary } = summarizeResponse(data);
  expect(Object.getPrototypeOf(summary)).toBe(Object.prototype);
  expect(Object.hasOwn(summary as object, '__proto__')).toBe(true);
  expect(JSON.stringify(summary)).toBe(JSON.stringify(data));
});
