import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentToolkitServer } from 'graphql-agent-toolkit';

const endpoint = process.env.GRAPHQL_ENDPOINT;

if (!endpoint) {
  throw new Error('Set GRAPHQL_ENDPOINT before running this example.');
}

const token = process.env.GRAPHQL_AUTH_TOKEN;

const server = await createAgentToolkitServer({
  endpoint,
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  operationDepth: 2,
});

await server.connect(new StdioServerTransport());
