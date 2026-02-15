import { describe, it, expect } from 'vitest';
import { SchemaNavigator } from '../../src/semantic/navigator.js';
import { tokenize } from '../../src/semantic/tokenizer.js';
import { parseSchema } from '../../src/introspection/parser.js';
import { mockIntrospectionResult } from '../introspection/fixtures.js';

describe('tokenize', () => {
  it('should split camelCase into words', () => {
    expect(tokenize('createUser')).toEqual(['create', 'user']);
  });

  it('should split PascalCase into words', () => {
    expect(tokenize('UserProfile')).toEqual(['user', 'profile']);
  });

  it('should lowercase all tokens', () => {
    expect(tokenize('ADMIN')).toEqual(['admin']);
  });

  it('should remove stop words', () => {
    const result = tokenize('The user is a person');
    expect(result).toEqual(['user', 'person']);
  });

  it('should handle empty input', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('should split on non-alphanumeric characters', () => {
    expect(tokenize('user_profile')).toEqual(['user', 'profile']);
  });
});

describe('SchemaNavigator', () => {
  const schema = parseSchema(mockIntrospectionResult);
  const navigator = new SchemaNavigator();
  navigator.index(schema);

  it('should return empty results for empty search', () => {
    expect(navigator.search('')).toEqual([]);
  });

  it('should find User type when searching for "user profile"', () => {
    const results = navigator.search('user profile');
    expect(results.length).toBeGreaterThan(0);
    // User should be among the top results
    const userResult = results.find((r) => r.typeName === 'User');
    expect(userResult).toBeDefined();
    // User should be the first or one of the top results
    expect(results[0].typeName).toBe('User');
  });

  it('should find mutation types when searching for "create"', () => {
    const results = navigator.search('create user');
    expect(results.length).toBeGreaterThan(0);
    // Should find CreateUserInput or Mutation
    const typeNames = results.map((r) => r.typeName);
    const hasRelevant = typeNames.includes('CreateUserInput') || typeNames.includes('Mutation');
    expect(hasRelevant).toBe(true);
  });

  it('should find Post type when searching for "blog post"', () => {
    const results = navigator.search('blog post');
    expect(results.length).toBeGreaterThan(0);
    const postResult = results.find((r) => r.typeName === 'Post');
    expect(postResult).toBeDefined();
  });

  it('should find Comment type when searching for "comment"', () => {
    const results = navigator.search('comment');
    expect(results.length).toBeGreaterThan(0);
    const commentResult = results.find((r) => r.typeName === 'Comment');
    expect(commentResult).toBeDefined();
  });

  it('should respect the limit parameter', () => {
    const results = navigator.search('user', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should return scores between 0 and 1', () => {
    const results = navigator.search('user');
    for (const result of results) {
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  describe('getTypeContext', () => {
    it('should return formatted context for User type', () => {
      const context = navigator.getTypeContext('User');
      expect(context).toBeDefined();
      expect(context).toContain('OBJECT User');
      expect(context).toContain('A user in the system');
      expect(context).toContain('Fields:');
      expect(context).toContain('id');
      expect(context).toContain('name');
      expect(context).toContain('email');
    });

    it('should return formatted context for enum type', () => {
      const context = navigator.getTypeContext('UserRole');
      expect(context).toBeDefined();
      expect(context).toContain('ENUM UserRole');
      expect(context).toContain('Enum Values:');
      expect(context).toContain('ADMIN');
      expect(context).toContain('USER');
      expect(context).toContain('MODERATOR');
    });

    it('should return formatted context for input type', () => {
      const context = navigator.getTypeContext('CreateUserInput');
      expect(context).toBeDefined();
      expect(context).toContain('INPUT_OBJECT CreateUserInput');
      expect(context).toContain('Input Fields:');
      expect(context).toContain('name');
      expect(context).toContain('email');
    });

    it('should return null for unknown type', () => {
      const context = navigator.getTypeContext('NonExistent');
      expect(context).toBeNull();
    });

    it('should return null when not indexed', () => {
      const nav = new SchemaNavigator();
      expect(nav.getTypeContext('User')).toBeNull();
    });
  });
});
