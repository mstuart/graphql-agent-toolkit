import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockIntrospectionResult } from '../introspection/fixtures.js';

const mockRequest = vi.fn();
vi.mock('graphql-request', () => ({
  GraphQLClient: class MockGraphQLClient {
    constructor() {}
    request = mockRequest;
  },
}));

const mockWriteFileSync = vi.fn();
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: mockWriteFileSync,
  };
});

describe('runInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue(mockIntrospectionResult);
  });

  it('should generate a config object from endpoint', async () => {
    const { runInit } = await import('../../src/cli/init.js');

    const config = await runInit({
      endpoint: 'https://example.com/graphql',
    });

    expect(config).toBeDefined();
    expect(config.endpoint).toBe('https://example.com/graphql');
    expect(config.operationDepth).toBe(2);
    expect(config.includeDeprecated).toBe(false);
  });

  it('should include headers in config when provided', async () => {
    const { runInit } = await import('../../src/cli/init.js');

    const config = await runInit({
      endpoint: 'https://example.com/graphql',
      header: ['Authorization: Bearer test123'],
    });

    expect(config.headers).toEqual({ Authorization: 'Bearer test123' });
  });

  it('should write config to file when output is specified', async () => {
    const { runInit } = await import('../../src/cli/init.js');

    await runInit({
      endpoint: 'https://example.com/graphql',
      output: '/tmp/test-config.json',
    });

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/test-config.json',
      expect.stringContaining('"endpoint"'),
    );
  });

  it('should throw on introspection failure', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Connection refused'));

    const { runInit } = await import('../../src/cli/init.js');

    await expect(
      runInit({ endpoint: 'https://bad-endpoint.com/graphql' }),
    ).rejects.toThrow();
  });
});
