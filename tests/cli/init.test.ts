import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockIntrospectionResult } from '../introspection/fixtures.js';

const mockRequest = vi.fn();
vi.mock('graphql-request', () => ({
  GraphQLClient: class MockGraphQLClient {
    request = mockRequest;
  },
}));

const mockWriteFileSync = vi.fn();
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
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
    const { runInit } = await import(/* webpackChunkName: "cli-init" */ '../../src/cli/init.js');

    const config = await runInit({
      endpoint: 'https://example.com/graphql',
    });

    expect(config).toBeDefined();
    expect(config.endpoint).toBe('https://example.com/graphql');
    expect(config.operationDepth).toBe(2);
    expect(config.includeDeprecated).toBe(false);
  });

  it('should replace literal header values with env placeholders in generated config', async () => {
    const { runInit } = await import(/* webpackChunkName: "cli-init" */ '../../src/cli/init.js');
    const environmentName = 'GRAPHQL_AGENT_AUTHORIZATION';
    const authorizationPlaceholder = `Bearer \${${environmentName}}`;

    const config = await runInit({
      endpoint: 'https://example.com/graphql',
      header: ['Authorization: Bearer test123'],
    });

    expect(config.headers).toEqual({ Authorization: authorizationPlaceholder });
  });

  it('should not write literal auth secrets to config files', async () => {
    const { runInit } = await import(/* webpackChunkName: "cli-init" */ '../../src/cli/init.js');
    const environmentName = 'GRAPHQL_AGENT_AUTHORIZATION';
    const authorizationPlaceholder = `Bearer \${${environmentName}}`;

    await runInit({
      endpoint: 'https://example.com/graphql',
      header: ['Authorization: Bearer test123'],
      output: 'test-config.json',
    });

    const writtenConfig = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(writtenConfig).not.toContain('test123');
    expect(writtenConfig).toContain(authorizationPlaceholder);
  });

  it('should write config to file when output is specified', async () => {
    const { runInit } = await import(/* webpackChunkName: "cli-init" */ '../../src/cli/init.js');

    await runInit({
      endpoint: 'https://example.com/graphql',
      output: 'test-config.json',
    });

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'test-config.json',
      expect.stringContaining('"endpoint"'),
    );
  });

  it('should throw on introspection failure', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Connection refused'));

    const { runInit } = await import(/* webpackChunkName: "cli-init" */ '../../src/cli/init.js');

    await expect(runInit({ endpoint: 'https://bad-endpoint.com/graphql' })).rejects.toThrow();
  });
});
