import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSchema } from '../../src/introspection/fetcher.js';
import { mockIntrospectionResult } from './fixtures.js';

const mockRequest = vi.fn();

vi.mock('graphql-request', () => {
  return {
    GraphQLClient: class MockGraphQLClient {
      options: Record<string, unknown>;
      constructor(_endpoint: string, options?: Record<string, unknown>) {
        // Store for inspection
        MockGraphQLClient.lastInstance = { endpoint: _endpoint, options };
        this.options = options ?? {};
      }
      request = mockRequest;
      static lastInstance: { endpoint: string; options?: Record<string, unknown> } | null = null;
    },
  };
});

describe('fetchSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch and return introspection result', async () => {
    mockRequest.mockResolvedValueOnce(mockIntrospectionResult);

    const result = await fetchSchema({ endpoint: 'https://example.com/graphql' });

    expect(result).toEqual(mockIntrospectionResult);
    expect(mockRequest).toHaveBeenCalledOnce();
  });

  it('should pass headers to GraphQL client', async () => {
    mockRequest.mockResolvedValueOnce(mockIntrospectionResult);

    await fetchSchema({
      endpoint: 'https://example.com/graphql',
      headers: { Authorization: 'Bearer token123' },
    });

    const { GraphQLClient } = await import('graphql-request');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastInstance = (GraphQLClient as any).lastInstance;
    expect(lastInstance.endpoint).toBe('https://example.com/graphql');
    expect(lastInstance.options).toEqual({
      headers: { Authorization: 'Bearer token123' },
    });
  });

  it('should throw a descriptive error on network failure', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      fetchSchema({ endpoint: 'https://example.com/graphql' }),
    ).rejects.toThrow('Failed to fetch schema from https://example.com/graphql: Network error');
  });

  it('should handle non-Error thrown values', async () => {
    mockRequest.mockRejectedValueOnce('some string error');

    await expect(
      fetchSchema({ endpoint: 'https://example.com/graphql' }),
    ).rejects.toThrow('Failed to fetch schema from https://example.com/graphql: Unknown error');
  });
});
