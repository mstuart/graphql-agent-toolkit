import { describe, it, expect } from 'vitest';
import { generateMockData, createMockExecutor } from '../../src/mock/index.js';
import type { ParsedSchema, SchemaType, SchemaField } from '../../src/types/schema.js';

const defineType = (types: Map<string, SchemaType>, name: string, type: SchemaType): void => {
  types.set(name, type);
};

interface FieldOptions {
  description?: string | null;
  kind?: SchemaField['type']['kind'];
  parameters?: SchemaField['args'];
}

const makeField = (
  name: string,
  typeName: string,
  { description = null, kind = 'OBJECT', parameters = [] }: FieldOptions = {},
): SchemaField => ({
  args: parameters,
  description,
  isDeprecated: false,
  name,
  type: { kind, name: typeName, ofType: null },
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
        args: [],
        description: 'List all users',
        isDeprecated: false,
        name: 'users',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } },
      },
      {
        args: [],
        description: 'Get system status',
        isDeprecated: false,
        name: 'status',
        type: { kind: 'SCALAR', name: 'String', ofType: null },
      },
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'Query',
    possibleTypes: [],
  });

  defineType(types, 'User', {
    description: null,
    enumValues: [],
    fields: [
      makeField('id', 'ID', { kind: 'SCALAR' }),
      makeField('name', 'String', { kind: 'SCALAR' }),
      makeField('age', 'Int', { kind: 'SCALAR' }),
      makeField('score', 'Float', { kind: 'SCALAR' }),
      makeField('active', 'Boolean', { kind: 'SCALAR' }),
      makeField('role', 'Role', { kind: 'ENUM' }),
      {
        args: [],
        description: null,
        isDeprecated: false,
        name: 'posts',
        type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'Post', ofType: null } },
      },
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'User',
    possibleTypes: [],
  });

  defineType(types, 'Post', {
    description: null,
    enumValues: [],
    fields: [
      makeField('id', 'ID', { kind: 'SCALAR' }),
      makeField('title', 'String', { kind: 'SCALAR' }),
      makeField('published', 'Boolean', { kind: 'SCALAR' }),
    ],
    inputFields: [],
    interfaces: [],
    kind: 'OBJECT',
    name: 'Post',
    possibleTypes: [],
  });

  defineType(types, 'Role', {
    description: null,
    enumValues: [
      { description: null, name: 'ADMIN' },
      { description: null, name: 'USER' },
      { description: null, name: 'GUEST' },
    ],
    fields: [],
    inputFields: [],
    interfaces: [],
    kind: 'ENUM',
    name: 'Role',
    possibleTypes: [],
  });

  return {
    mutationType: null,
    queryType: 'Query',
    subscriptionType: null,
    types,
  };
};

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
      expect(Number.isSafeInteger(data.age)).toBe(true);
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
      // default arrayLength
      expect(posts).toHaveLength(3);
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
      defineType(types, 'Query', {
        description: null,
        enumValues: [],
        fields: [makeField('item', 'Item', { kind: 'OBJECT' })],
        inputFields: [],
        interfaces: [],
        kind: 'OBJECT',
        name: 'Query',
        possibleTypes: [],
      });
      defineType(types, 'Item', {
        description: null,
        enumValues: [],
        fields: [
          makeField('title', 'String', {
            description: 'The item title @mock("Hello World")',
            kind: 'SCALAR',
          }),
          makeField('count', 'Int', {
            description: 'Total count @mock(42)',
            kind: 'SCALAR',
          }),
          makeField('enabled', 'Boolean', {
            description: 'Is enabled @mock(true)',
            kind: 'SCALAR',
          }),
        ],
        inputFields: [],
        interfaces: [],
        kind: 'OBJECT',
        name: 'Item',
        possibleTypes: [],
      });

      const schema: ParsedSchema = {
        mutationType: null,
        queryType: 'Query',
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
      defineType(types, 'Query', {
        description: null,
        enumValues: [],
        fields: [makeField('item', 'Item', { kind: 'OBJECT' })],
        inputFields: [],
        interfaces: [],
        kind: 'OBJECT',
        name: 'Query',
        possibleTypes: [],
      });
      defineType(types, 'Item', {
        description: null,
        enumValues: [],
        fields: [
          makeField('active', 'Boolean', {
            description: '@mock(false)',
            kind: 'SCALAR',
          }),
        ],
        inputFields: [],
        interfaces: [],
        kind: 'OBJECT',
        name: 'Item',
        possibleTypes: [],
      });

      const schema: ParsedSchema = {
        mutationType: null,
        queryType: 'Query',
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
      const types = new Map<string, SchemaType>([
        [
          'Query',
          {
            description: null,
            enumValues: [],
            fields: [],
            inputFields: [],
            interfaces: [],
            kind: 'OBJECT',
            name: 'Query',
            possibleTypes: [],
          },
        ],
        [
          'Empty',
          {
            description: null,
            enumValues: [],
            fields: [],
            inputFields: [],
            interfaces: [],
            kind: 'OBJECT',
            name: 'Empty',
            possibleTypes: [],
          },
        ],
      ]);

      const schema: ParsedSchema = {
        mutationType: null,
        queryType: 'Query',
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
    // default arrayLength
    expect(parsed.data.users).toHaveLength(3);
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

    expect(parsed.data.users).toHaveLength(5);
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
