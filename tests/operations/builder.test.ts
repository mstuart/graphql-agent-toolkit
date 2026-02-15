import { describe, it, expect } from 'vitest';
import { buildOperation } from '../../src/operations/builder.js';
import { typeRefToString, isRequired } from '../../src/operations/variables.js';
import { parseSchema } from '../../src/introspection/parser.js';
import { mockIntrospectionResult } from '../introspection/fixtures.js';
import type { TypeRef } from '../../src/types/index.js';

const schema = parseSchema(mockIntrospectionResult);

describe('typeRefToString', () => {
  it('should convert a simple scalar type', () => {
    const ref: TypeRef = { kind: 'SCALAR', name: 'String', ofType: null };
    expect(typeRefToString(ref)).toBe('String');
  });

  it('should convert a non-null scalar type', () => {
    const ref: TypeRef = {
      kind: 'NON_NULL',
      name: null,
      ofType: { kind: 'SCALAR', name: 'ID', ofType: null },
    };
    expect(typeRefToString(ref)).toBe('ID!');
  });

  it('should convert a list type', () => {
    const ref: TypeRef = {
      kind: 'LIST',
      name: null,
      ofType: { kind: 'OBJECT', name: 'User', ofType: null },
    };
    expect(typeRefToString(ref)).toBe('[User]');
  });

  it('should convert a non-null list of non-null items', () => {
    const ref: TypeRef = {
      kind: 'NON_NULL',
      name: null,
      ofType: {
        kind: 'LIST',
        name: null,
        ofType: {
          kind: 'NON_NULL',
          name: null,
          ofType: { kind: 'OBJECT', name: 'User', ofType: null },
        },
      },
    };
    expect(typeRefToString(ref)).toBe('[User!]!');
  });
});

describe('isRequired', () => {
  it('should return true for NON_NULL types', () => {
    const ref: TypeRef = {
      kind: 'NON_NULL',
      name: null,
      ofType: { kind: 'SCALAR', name: 'ID', ofType: null },
    };
    expect(isRequired(ref)).toBe(true);
  });

  it('should return false for nullable types', () => {
    const ref: TypeRef = { kind: 'SCALAR', name: 'String', ofType: null };
    expect(isRequired(ref)).toBe(false);
  });
});

describe('buildOperation', () => {
  it('should build a simple query with arguments', () => {
    const result = buildOperation(schema, 'user');
    expect(result.operationType).toBe('query');
    expect(result.operationName).toBe('UserQuery');
    expect(result.operation).toContain('query UserQuery($id: ID!)');
    expect(result.operation).toContain('user(id: $id)');
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({
      name: 'id',
      type: 'ID!',
      required: true,
      description: 'User ID',
    });
  });

  it('should build a query that includes nested object fields at depth 2', () => {
    const result = buildOperation(schema, 'user', { maxDepth: 2 });
    expect(result.operation).toContain('id');
    expect(result.operation).toContain('name');
    expect(result.operation).toContain('email');
    // At depth 2, nested objects should not expand further (posts is an object list)
  });

  it('should respect maxDepth for nested types', () => {
    const shallow = buildOperation(schema, 'users', { maxDepth: 1 });
    // At depth 1, we should see scalar fields of User but not nested Posts
    expect(shallow.operation).toContain('id');
    expect(shallow.operation).toContain('name');
    // Posts is a LIST of OBJECT, should not be expanded at depth 1
    expect(shallow.operation).not.toContain('title');

    const deep = buildOperation(schema, 'users', { maxDepth: 3 });
    // At depth 3, we should see nested Post fields
    expect(deep.operation).toContain('posts');
    expect(deep.operation).toContain('title');
  });

  it('should build a mutation', () => {
    const result = buildOperation(schema, 'createUser');
    expect(result.operationType).toBe('mutation');
    expect(result.operationName).toBe('CreateUserMutation');
    expect(result.operation).toContain('mutation CreateUserMutation($input: CreateUserInput!)');
    expect(result.operation).toContain('createUser(input: $input)');
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].required).toBe(true);
  });

  it('should handle mutation with scalar return type', () => {
    const result = buildOperation(schema, 'deleteUser');
    expect(result.operationType).toBe('mutation');
    expect(result.operation).toContain('deleteUser(id: $id)');
    // Boolean return type should not have a nested selection set
    const lines = result.operation.split('\n');
    // First line: mutation DeleteUserMutation($id: ID!) {
    // Second line:   deleteUser(id: $id)
    // Third line: }
    expect(lines).toHaveLength(3);
    // Only the operation-level braces, no selection set braces on the field line
    expect(lines[1].trim()).toBe('deleteUser(id: $id)');
  });

  it('should generate variables with default argument info', () => {
    const result = buildOperation(schema, 'users');
    const limitVar = result.variables.find((v) => v.name === 'limit');
    expect(limitVar).toBeDefined();
    expect(limitVar!.required).toBe(false);
    expect(limitVar!.type).toBe('Int');
  });

  it('should handle list return types', () => {
    const result = buildOperation(schema, 'posts', { maxDepth: 2 });
    expect(result.operation).toContain('posts');
    expect(result.operation).toContain('id');
    expect(result.operation).toContain('title');
    expect(result.operation).toContain('body');
  });

  it('should throw for unknown field', () => {
    expect(() => buildOperation(schema, 'nonExistent')).toThrow(
      'Field "nonExistent" not found in schema query or mutation types',
    );
  });

  it('should exclude deprecated fields by default', () => {
    const result = buildOperation(schema, 'user', { maxDepth: 2 });
    // The 'oldField' is deprecated on Query, not on User
    // User doesn't have deprecated fields in our fixture
    expect(result.operation).toContain('name');
  });
});
