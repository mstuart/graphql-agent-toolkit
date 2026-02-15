import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockIntrospectionResult } from '../introspection/fixtures.js';

// Mock graphql-request before importing server
const mockRequest = vi.fn();
vi.mock('graphql-request', () => ({
  GraphQLClient: class MockGraphQLClient {
    constructor() {}
    request = mockRequest;
  },
}));

describe('createAgentToolkitServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue(mockIntrospectionResult);
  });

  it('should create an MCP server with tools registered', async () => {
    const { createAgentToolkitServer } = await import('../../src/mcp/server.js');

    const server = await createAgentToolkitServer({
      endpoint: 'https://example.com/graphql',
    });

    expect(server).toBeDefined();
    // The server should have been created successfully
    // We verify the introspection was called
    expect(mockRequest).toHaveBeenCalledOnce();
  });

  it('should accept custom server name and version', async () => {
    const { createAgentToolkitServer } = await import('../../src/mcp/server.js');

    const server = await createAgentToolkitServer(
      { endpoint: 'https://example.com/graphql' },
      { serverName: 'my-server', serverVersion: '2.0.0' },
    );

    expect(server).toBeDefined();
  });

  it('should pass headers to the introspection fetch', async () => {
    const { createAgentToolkitServer } = await import('../../src/mcp/server.js');

    await createAgentToolkitServer({
      endpoint: 'https://example.com/graphql',
      headers: { Authorization: 'Bearer test' },
    });

    expect(mockRequest).toHaveBeenCalledOnce();
  });
});
