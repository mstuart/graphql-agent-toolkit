import { describe, it, expect } from 'vitest';
import { parseSchema } from '../../src/introspection/parser.js';
import { mockIntrospectionResult } from './fixtures.js';

describe('parseSchema', () => {
  const parsed = parseSchema(mockIntrospectionResult);

  it('should set the query type name', () => {
    expect(parsed.queryType).toBe('Query');
  });

  it('should set the mutation type name', () => {
    expect(parsed.mutationType).toBe('Mutation');
  });

  it('should set subscription type to null when absent', () => {
    expect(parsed.subscriptionType).toBeNull();
  });

  it('should filter out introspection types (__ prefix)', () => {
    const typeNames = Array.from(parsed.types.keys());
    const introspectionTypes = typeNames.filter((n) => n.startsWith('__'));
    expect(introspectionTypes).toHaveLength(0);
  });

  it('should include user-defined types', () => {
    expect(parsed.types.has('Query')).toBe(true);
    expect(parsed.types.has('User')).toBe(true);
    expect(parsed.types.has('Post')).toBe(true);
    expect(parsed.types.has('Comment')).toBe(true);
    expect(parsed.types.has('CreateUserInput')).toBe(true);
    expect(parsed.types.has('UserRole')).toBe(true);
  });

  it('should include scalar types', () => {
    expect(parsed.types.has('String')).toBe(true);
    expect(parsed.types.has('Int')).toBe(true);
    expect(parsed.types.has('Boolean')).toBe(true);
    expect(parsed.types.has('ID')).toBe(true);
  });

  it('should parse Query fields correctly', () => {
    const queryType = parsed.types.get('Query')!;
    expect(queryType.fields).toHaveLength(4);

    const userField = queryType.fields.find((f) => f.name === 'user')!;
    expect(userField.description).toBe('Fetch a user by ID');
    expect(userField.args).toHaveLength(1);
    expect(userField.args[0].name).toBe('id');
    expect(userField.args[0].type.kind).toBe('NON_NULL');
  });

  it('should parse field arguments with defaults', () => {
    const queryType = parsed.types.get('Query')!;
    const usersField = queryType.fields.find((f) => f.name === 'users')!;
    const limitArg = usersField.args.find((a) => a.name === 'limit')!;
    expect(limitArg.defaultValue).toBe('10');
  });

  it('should parse deprecated fields', () => {
    const queryType = parsed.types.get('Query')!;
    const oldField = queryType.fields.find((f) => f.name === 'oldField')!;
    expect(oldField.isDeprecated).toBe(true);
  });

  it('should parse input object types', () => {
    const inputType = parsed.types.get('CreateUserInput')!;
    expect(inputType.kind).toBe('INPUT_OBJECT');
    expect(inputType.inputFields).toHaveLength(3);
    expect(inputType.inputFields[0].name).toBe('name');
  });

  it('should parse enum types', () => {
    const enumType = parsed.types.get('UserRole')!;
    expect(enumType.kind).toBe('ENUM');
    expect(enumType.enumValues).toHaveLength(3);
    expect(enumType.enumValues.map((v) => v.name)).toContain('ADMIN');
  });

  it('should parse nested type references correctly', () => {
    const queryType = parsed.types.get('Query')!;
    const usersField = queryType.fields.find((f) => f.name === 'users')!;
    // [User!]!
    expect(usersField.type.kind).toBe('NON_NULL');
    expect(usersField.type.ofType?.kind).toBe('LIST');
    expect(usersField.type.ofType?.ofType?.kind).toBe('NON_NULL');
    expect(usersField.type.ofType?.ofType?.ofType?.kind).toBe('OBJECT');
    expect(usersField.type.ofType?.ofType?.ofType?.name).toBe('User');
  });
});
