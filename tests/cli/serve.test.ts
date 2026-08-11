import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runServe } from '../../src/cli/serve.js';

const { mockConnect, mockCreateAgentToolkitServer } = vi.hoisted(() => {
  const connect = vi.fn();
  return {
    mockConnect: connect,
    mockCreateAgentToolkitServer: vi.fn().mockResolvedValue({ connect }),
  };
});

vi.mock('../../src/mcp/server.js', () => ({
  createAgentToolkitServer: mockCreateAgentToolkitServer,
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

describe('runServe', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.GRAPHQL_AGENT_AUTHORIZATION;
  });

  it('should expand env placeholders from config headers before creating the server', async () => {
    process.env.GRAPHQL_AGENT_AUTHORIZATION = 'secret-token';
    const directory = mkdtempSync(path.join(tmpdir(), 'gat-'));
    const configPath = path.join(directory, 'config.json');
    const environmentName = 'GRAPHQL_AGENT_AUTHORIZATION';
    const authorizationPlaceholder = `Bearer \${${environmentName}}`;
    writeFileSync(
      configPath,
      JSON.stringify({
        endpoint: 'https://example.com/graphql',
        headers: { Authorization: authorizationPlaceholder },
      }),
    );

    await runServe({ config: configPath });

    expect(mockCreateAgentToolkitServer).toHaveBeenCalledWith({
      endpoint: 'https://example.com/graphql',
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(mockConnect).toHaveBeenCalledOnce();
  });
});
