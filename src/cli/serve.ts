import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentToolkitServer } from '../mcp/server.js';
import type { AgentToolkitConfig } from '../types/index.js';

export interface ServeOptions {
  config?: string;
  endpoint?: string;
  header?: string[];
}

export async function runServe(options: ServeOptions): Promise<void> {
  let config: AgentToolkitConfig;

  if (options.config) {
    try {
      const raw = readFileSync(options.config, 'utf-8');
      config = JSON.parse(raw) as AgentToolkitConfig;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error reading config file: ${message}`);
      process.exit(1);
    }
  } else if (options.endpoint) {
    const headers: Record<string, string> = {};
    if (options.header) {
      for (const h of options.header) {
        const colonIdx = h.indexOf(':');
        if (colonIdx !== -1) {
          headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
        }
      }
    }
    config = {
      endpoint: options.endpoint,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  } else {
    console.error('Error: Either --config or --endpoint must be specified.');
    process.exit(1);
  }

  console.error(`Starting MCP server for endpoint: ${config.endpoint}`);

  try {
    const server = await createAgentToolkitServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP server running on stdio');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error starting server: ${message}`);
    process.exit(1);
  }
}
