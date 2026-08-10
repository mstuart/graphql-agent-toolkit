import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSchema } from '../../src/introspection/fetcher.js';
import { mockIntrospectionResult } from './fixtures.js';

const mockRequest = vi.fn();
const clientState: {
  last: { endpoint: string; options?: Record<string, unknown> } | null;
} = { last: null };

vi.mock('graphql-request', () => ({
  GraphQLClient: class MockGraphQLClient {
    request = mockRequest;
    options: Record<string, unknown>;
    constructor(_endpoint: string, options?: Record<string, unknown>) {
      // Store for inspection
      clientState.last = { endpoint: _endpoint, options };
      this.options = options ?? {};
    }
  },
}));

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

    expect(clientState.last?.endpoint).toBe('https://example.com/graphql');
    expect(clientState.last?.options).toEqual({
      headers: { Authorization: 'Bearer token123' },
    });
  });

  it('should throw a descriptive error on network failure', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchSchema({ endpoint: 'https://example.com/graphql' })).rejects.toThrow(
      'Failed to fetch schema from https://example.com/graphql: Network error',
    );
  });

  it('should handle non-Error thrown values', async () => {
    mockRequest.mockRejectedValueOnce('some string error');

    await expect(fetchSchema({ endpoint: 'https://example.com/graphql' })).rejects.toThrow(
      'Failed to fetch schema from https://example.com/graphql: Unknown error',
    );
  });
});
