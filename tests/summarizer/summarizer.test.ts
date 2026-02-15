import { describe, it, expect } from 'vitest';
import { summarizeResponse, formatForLLM } from '../../src/summarizer/index.js';

describe('summarizeResponse', () => {
  describe('array truncation', () => {
    it('should truncate arrays to maxItems', () => {
      const data = { users: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
      const result = summarizeResponse(data, { maxItems: 3 });

      const summary = result.summary as Record<string, unknown>;
      const users = summary.users as unknown[];
      expect(users).toHaveLength(3);
      expect(users[0]).toBe(1);
      expect(users[1]).toBe(2);
      expect(users[2]).toBe(3);
    });

    it('should add _meta to truncated arrays when includeMetadata is true', () => {
      const data = { items: [1, 2, 3, 4, 5, 6] };
      const result = summarizeResponse(data, { maxItems: 2, includeMetadata: true });

      const summary = result.summary as Record<string, unknown>;
      const items = summary.items as any;
      expect(items._meta).toEqual({ totalCount: 6, showing: 2 });
    });

    it('should not add _meta when includeMetadata is false', () => {
      const data = { items: [1, 2, 3, 4, 5, 6] };
      const result = summarizeResponse(data, { maxItems: 2, includeMetadata: false });

      const summary = result.summary as Record<string, unknown>;
      const items = summary.items as any;
      expect(items._meta).toBeUndefined();
    });

    it('should not truncate arrays within maxItems limit', () => {
      const data = { items: [1, 2, 3] };
      const result = summarizeResponse(data, { maxItems: 5 });

      const summary = result.summary as Record<string, unknown>;
      const items = summary.items as unknown[];
      expect(items).toHaveLength(3);
    });
  });

  describe('deep nesting cutoff', () => {
    it('should cut off objects at maxDepth', () => {
      const data = {
        level1: {
          level2: {
            level3: {
              level4: { deep: 'value' },
            },
          },
        },
      };
      const result = summarizeResponse(data, { maxDepth: 3 });

      const summary = result.summary as any;
      expect(summary.level1.level2.level3).toBe('{...1 keys}');
    });

    it('should cut off arrays at maxDepth', () => {
      const data = {
        level1: {
          level2: {
            items: [1, 2, 3],
          },
        },
      };
      const result = summarizeResponse(data, { maxDepth: 2 });

      const summary = result.summary as any;
      expect(summary.level1.level2).toBe('{...1 keys}');
    });

    it('should preserve content within maxDepth', () => {
      const data = { a: { b: 'hello' } };
      const result = summarizeResponse(data, { maxDepth: 3 });

      const summary = result.summary as any;
      expect(summary.a.b).toBe('hello');
    });
  });

  describe('string truncation', () => {
    it('should truncate long strings', () => {
      const longString = 'x'.repeat(300);
      const data = { text: longString };
      const result = summarizeResponse(data, { maxStringLength: 100 });

      const summary = result.summary as any;
      expect(summary.text).toBe('x'.repeat(100) + '...');
      expect(summary.text.length).toBe(103); // 100 chars + '...'
    });

    it('should not truncate short strings', () => {
      const data = { text: 'hello' };
      const result = summarizeResponse(data, { maxStringLength: 200 });

      const summary = result.summary as any;
      expect(summary.text).toBe('hello');
    });
  });

  describe('metadata accuracy', () => {
    it('should report correct totalItems for nested arrays', () => {
      const data = {
        users: [{ id: 1 }, { id: 2 }, { id: 3 }],
        posts: [{ id: 10 }, { id: 20 }],
      };
      const result = summarizeResponse(data);

      expect(result.metadata.totalItems).toBe(5);
    });

    it('should set truncated to true when truncation occurs', () => {
      const data = { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
      const result = summarizeResponse(data, { maxItems: 3 });

      expect(result.metadata.truncated).toBe(true);
    });

    it('should set truncated to false when no truncation occurs', () => {
      const data = { name: 'hello', count: 5 };
      const result = summarizeResponse(data);

      expect(result.metadata.truncated).toBe(false);
    });

    it('should report correct originalSize', () => {
      const data = { name: 'test' };
      const result = summarizeResponse(data);

      expect(result.metadata.originalSize).toBe(JSON.stringify(data).length);
    });
  });

  describe('primitive handling', () => {
    it('should pass through numbers', () => {
      const result = summarizeResponse(42);
      expect(result.summary).toBe(42);
    });

    it('should pass through booleans', () => {
      const result = summarizeResponse(true);
      expect(result.summary).toBe(true);
    });

    it('should pass through null', () => {
      const result = summarizeResponse(null);
      expect(result.summary).toBeNull();
    });
  });
});

describe('formatForLLM', () => {
  it('should produce markdown with headers for object keys', () => {
    const data = {
      users: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ],
    };
    const result = formatForLLM(data);

    expect(result).toContain('users');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
  });

  it('should produce bullet points for arrays', () => {
    const data = {
      items: ['apple', 'banana', 'cherry'],
    };
    const result = formatForLLM(data);

    expect(result).toContain('- apple');
    expect(result).toContain('- banana');
    expect(result).toContain('- cherry');
  });

  it('should include "more items" notice for truncated arrays', () => {
    const data = {
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    };
    const result = formatForLLM(data, { maxItems: 3, includeMetadata: true });

    expect(result).toContain('more items');
  });

  it('should handle empty arrays', () => {
    const data = { items: [] };
    const result = formatForLLM(data);

    expect(result).toContain('empty list');
  });

  it('should render nested objects with bold field names', () => {
    const data = {
      users: [{ name: 'Alice', email: 'alice@example.com' }],
    };
    const result = formatForLLM(data);

    expect(result).toContain('**name**');
    expect(result).toContain('**email**');
  });

  it('should handle null values', () => {
    const result = formatForLLM(null);
    expect(result).toBe('null');
  });
});
