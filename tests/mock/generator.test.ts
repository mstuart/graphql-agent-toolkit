import { describe, it, expect } from 'vitest';
import { generateMockData, createMockExecutor } from '../../src/mock/index.js';
import type { ParsedSchema, SchemaType, SchemaField } from '../../src/types/schema.js';

function makeField(
  name: string,
  typeName: string,
  kind: string = 'OBJECT',
  args: SchemaField['args'] = [],
  description: string | null = null,
): SchemaField {
  return {
    name,
    description,
    type: { kind: kind as any, name: typeName, ofType: null },
    args,
    isDeprecated: false,
  };
}

function makeListField(name: string, typeName: string, kind: string = 'OBJECT'): SchemaField {
  return {
    name,
    description: null,
    type: { kind: 'LIST', name: null, ofType: { kind: kind as any, name: typeName, ofType: null } },
    args: [],
    isDeprecated: false,
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
        args: [],
        isDeprecated: false,
      },
      {
        name: 'status',
        description: 'Get system status',
        type: { kind: 'SCALAR', name: 'String', ofType: null },
        args: [],
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
      makeField('age', 'Int', 'SCALAR'),
      makeField('score', 'Float', 'SCALAR'),
      makeField('active', 'Boolean', 'SCALAR'),
      makeField('role', 'Role', 'ENUM'),
      {
        name: 'posts',
        description: null,
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'Post', ofType: null } },
        args: [],
        isDeprecated: false,
      },
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
      makeField('published', 'Boolean', 'SCALAR'),
    ],
    inputFields: [],
    enumValues: [],
    interfaces: [],
    possibleTypes: [],
  });

  types.set('Role', {
    name: 'Role',
    kind: 'ENUM',
    description: null,
    fields: [],
    inputFields: [],
    enumValues: [
      { name: 'ADMIN', description: null },
      { name: 'USER', description: null },
      { name: 'GUEST', description: null },
    ],
    interfaces: [],
    possibleTypes: [],
  });

  return {
    queryType: 'Query',
    mutationType: null,
    subscriptionType: null,
    types,
  };
}

describe('generateMockData', () => {
  describe('scalar generation', () => {
    it('should generate mock strings with field name', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      expect(data.name).toBe('mock_name');
    });

    it('should generate mock IDs with field name', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      expect(data.id).toBe('id_id_0');
    });

    it('should generate deterministic Int values', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      expect(typeof data.age).toBe('number');
      expect(Number.isInteger(data.age)).toBe(true);
    });

    it('should generate deterministic Float values', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      expect(typeof data.score).toBe('number');
    });

    it('should generate Boolean values', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      expect(typeof data.active).toBe('boolean');
    });
  });

  describe('enum picking', () => {
    it('should return the first enum value', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      expect(data.role).toBe('ADMIN');
    });
  });

  describe('object recursion', () => {
    it('should generate nested objects', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      expect(data.posts).toBeDefined();
      expect(Array.isArray(data.posts)).toBe(true);
      const posts = data.posts as Record<string, unknown>[];
      expect(posts.length).toBe(3); // default arrayLength
      expect(posts[0].title).toBe('mock_title');
    });
  });

  describe('list generation', () => {
    it('should generate arrays of default length 3', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User');

      const posts = data.posts as unknown[];
      expect(posts).toHaveLength(3);
    });

    it('should respect custom arrayLength', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User', { arrayLength: 5 });

      const posts = data.posts as unknown[];
      expect(posts).toHaveLength(5);
    });
  });

  describe('depth limiting', () => {
    it('should stop list/object recursion at maxDepth 0', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User', { maxDepth: 0 });

      // Scalars are still generated (no depth restriction on scalars)
      expect(data.id).toBe('id_id_0');
      expect(data.name).toBe('mock_name');
      expect(data.role).toBe('ADMIN');
      // But lists at depth 0 are empty because depth >= maxDepth
      const posts = data.posts as unknown[];
      expect(posts).toEqual([]);
    });

    it('should generate shallow objects with maxDepth 1', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'User', { maxDepth: 1 });

      // Scalar fields are generated
      expect(data.id).toBe('id_id_0');
      expect(data.name).toBe('mock_name');
      // List of Post objects at depth 0: items generated, Post scalars within depth
      const posts = data.posts as Record<string, unknown>[];
      expect(posts).toHaveLength(3);
      expect(posts[0].id).toBeDefined();
      expect(posts[0].title).toBeDefined();
    });
  });

  describe('deterministic with seed', () => {
    it('should produce same output with same seed', () => {
      const schema = buildTestSchema();
      const data1 = generateMockData(schema, 'User', { seed: 42 });
      const data2 = generateMockData(schema, 'User', { seed: 42 });

      expect(data1).toEqual(data2);
    });

    it('should produce different output with different seeds', () => {
      const schema = buildTestSchema();
      const data1 = generateMockData(schema, 'User', { seed: 42 });
      const data2 = generateMockData(schema, 'User', { seed: 99 });

      // Strings don't change with seed (they use field name), but numbers do
      expect(data1.age).not.toBe(data2.age);
    });
  });

  describe('@mock in description parsing', () => {
    it('should use @mock directive string value from description', () => {
      const types = new Map<string, SchemaType>();
      types.set('Query', {
        name: 'Query',
        kind: 'OBJECT',
        description: null,
        fields: [
          makeField('item', 'Item', 'OBJECT'),
        ],
        inputFields: [],
        enumValues: [],
        interfaces: [],
        possibleTypes: [],
      });
      types.set('Item', {
        name: 'Item',
        kind: 'OBJECT',
        description: null,
        fields: [
          makeField('title', 'String', 'SCALAR', [], 'The item title @mock("Hello World")'),
          makeField('count', 'Int', 'SCALAR', [], 'Total count @mock(42)'),
          makeField('enabled', 'Boolean', 'SCALAR', [], 'Is enabled @mock(true)'),
        ],
        inputFields: [],
        enumValues: [],
        interfaces: [],
        possibleTypes: [],
      });

      const schema: ParsedSchema = {
        queryType: 'Query',
        mutationType: null,
        subscriptionType: null,
        types,
      };

      const data = generateMockData(schema, 'Item');
      expect(data.title).toBe('Hello World');
      expect(data.count).toBe(42);
      expect(data.enabled).toBe(true);
    });

    it('should use @mock(false) directive', () => {
      const types = new Map<string, SchemaType>();
      types.set('Query', {
        name: 'Query',
        kind: 'OBJECT',
        description: null,
        fields: [makeField('item', 'Item', 'OBJECT')],
        inputFields: [],
        enumValues: [],
        interfaces: [],
        possibleTypes: [],
      });
      types.set('Item', {
        name: 'Item',
        kind: 'OBJECT',
        description: null,
        fields: [
          makeField('active', 'Boolean', 'SCALAR', [], '@mock(false)'),
        ],
        inputFields: [],
        enumValues: [],
        interfaces: [],
        possibleTypes: [],
      });

      const schema: ParsedSchema = {
        queryType: 'Query',
        mutationType: null,
        subscriptionType: null,
        types,
      };

      const data = generateMockData(schema, 'Item');
      expect(data.active).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle non-existent type name', () => {
      const schema = buildTestSchema();
      const data = generateMockData(schema, 'NonExistent');
      expect(data).toEqual({});
    });

    it('should handle type with no fields', () => {
      const types = new Map<string, SchemaType>();
      types.set('Query', {
        name: 'Query',
        kind: 'OBJECT',
        description: null,
        fields: [],
        inputFields: [],
        enumValues: [],
        interfaces: [],
        possibleTypes: [],
      });
      types.set('Empty', {
        name: 'Empty',
        kind: 'OBJECT',
        description: null,
        fields: [],
        inputFields: [],
        enumValues: [],
        interfaces: [],
        possibleTypes: [],
      });

      const schema: ParsedSchema = {
        queryType: 'Query',
        mutationType: null,
        subscriptionType: null,
        types,
      };

      const data = generateMockData(schema, 'Empty');
      expect(data).toEqual({});
    });
  });
});

describe('createMockExecutor', () => {
  it('should return data matching GraphQLExecutor interface', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor(schema);

    const operation = `query UserQuery($id: ID!) {
      user(id: $id) {
        id
        name
        age
      }
    }`;

    const result = await executor.execute(operation, { id: '1' });
    const parsed = JSON.parse(result);

    expect(parsed.data).toBeDefined();
    expect(parsed.data.user).toBeDefined();
    expect(parsed.data.user.id).toBeDefined();
    expect(parsed.data.user.name).toBeDefined();
  });

  it('should return an array for list query fields', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor(schema);

    const operation = `query UsersQuery {
      users {
        id
        name
      }
    }`;

    const result = await executor.execute(operation);
    const parsed = JSON.parse(result);

    expect(parsed.data.users).toBeDefined();
    expect(Array.isArray(parsed.data.users)).toBe(true);
    expect(parsed.data.users.length).toBe(3); // default arrayLength
  });

  it('should return scalar values for scalar return types', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor(schema);

    const operation = `query StatusQuery {
      status
    }`;

    const result = await executor.execute(operation);
    const parsed = JSON.parse(result);

    expect(parsed.data.status).toBeDefined();
    expect(typeof parsed.data.status).toBe('string');
  });

  it('should respect mock config options', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor(schema, { arrayLength: 5 });

    const operation = `query UsersQuery {
      users {
        id
        name
      }
    }`;

    const result = await executor.execute(operation);
    const parsed = JSON.parse(result);

    expect(parsed.data.users.length).toBe(5);
  });

  it('should be deterministic with seed', async () => {
    const schema = buildTestSchema();
    const executor1 = createMockExecutor(schema, { seed: 42 });
    const executor2 = createMockExecutor(schema, { seed: 42 });

    const operation = `query UserQuery($id: ID!) {
      user(id: $id) { id name age }
    }`;

    const result1 = await executor1.execute(operation, { id: '1' });
    const result2 = await executor2.execute(operation, { id: '1' });

    expect(result1).toBe(result2);
  });

  it('should handle unknown root field gracefully', async () => {
    const schema = buildTestSchema();
    const executor = createMockExecutor(schema);

    const operation = `query UnknownQuery {
      nonexistent {
        id
      }
    }`;

    const result = await executor.execute(operation);
    const parsed = JSON.parse(result);

    expect(parsed.data.nonexistent).toBeNull();
  });
});
