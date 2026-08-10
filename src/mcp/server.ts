import { isNativeError } from 'node:util/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchSchema } from '../introspection/fetcher.js';
import { parseSchema } from '../introspection/parser.js';
import { GraphQLExecutor } from './executor.js';
import { createToolsFromSchema } from './tool-factory.js';
import type { AgentToolkitConfig } from '../types/index.js';

const packageVersion = process.env.PACKAGE_VERSION || '0.1.0';

export interface AgentToolkitServerOptions {
  serverName?: string;
  serverVersion?: string;
}

/**
 * Creates a fully configured MCP server from a GraphQL endpoint configuration.
 */
export const createAgentToolkitServer = async (
  config: AgentToolkitConfig,
  options?: AgentToolkitServerOptions,
): Promise<McpServer> => {
  const serverName = options?.serverName ?? 'graphql-agent-toolkit';
  const serverVersion = options?.serverVersion ?? packageVersion;

  // Fetch and parse schema
  const introspectionResult = await fetchSchema({
    endpoint: config.endpoint,
    headers: config.headers,
  });
  const schema = parseSchema(introspectionResult);

  // Create executor
  const executor = new GraphQLExecutor(config.endpoint, config.headers);

  // Create tools
  const tools = createToolsFromSchema(schema, executor, {
    includeDeprecated: config.includeDeprecated ?? false,
    maxDepth: config.operationDepth ?? 2,
  });

  // Create MCP server
  const server = new McpServer({
    name: serverName,
    version: serverVersion,
  });

  // Register tools
  for (const tool of tools) {
    const inputSchema = Object.keys(tool.inputSchema).length > 0 ? tool.inputSchema : undefined;

    if (inputSchema) {
      server.tool(tool.name, tool.description, inputSchema, async (parameters) => {
        try {
          const result = await tool.execute(parameters as Record<string, unknown>);
          return {
            content: [{ text: result, type: 'text' as const }],
          };
        } catch (error) {
          const message = isNativeError(error) ? error.message : 'Unknown error';
          return {
            content: [{ text: `Error: ${message}`, type: 'text' as const }],
            isError: true,
          };
        }
      });
    } else {
      server.tool(tool.name, tool.description, async () => {
        try {
          const result = await tool.execute({});
          return {
            content: [{ text: result, type: 'text' as const }],
          };
        } catch (error) {
          const message = isNativeError(error) ? error.message : 'Unknown error';
          return {
            content: [{ text: `Error: ${message}`, type: 'text' as const }],
            isError: true,
          };
        }
      });
    }
  }

  // Register a schema explorer resource
  server.tool(
    'explore_schema',
    'Explore the GraphQL schema — list types, fields, and arguments',
    {
      typeName: z
        .string()
        .optional()
        .describe('Type name to explore. If omitted, lists all types.'),
    },
    async (parameters) => {
      if (parameters.typeName) {
        const type = schema.types.get(parameters.typeName);
        if (!type) {
          return {
            content: [{ text: `Type "${parameters.typeName}" not found.`, type: 'text' as const }],
          };
        }
        return {
          content: [{ text: JSON.stringify(type, null, 2), type: 'text' as const }],
        };
      }

      const typeList = schema.types
        .values()
        .filter((t) => !['SCALAR'].includes(t.kind))
        .map((type) => {
          const description = type.description ? ` — ${type.description}` : '';
          return `${type.kind} ${type.name}${description}`;
        })
        .toArray();

      return {
        content: [{ text: typeList.join('\n'), type: 'text' as const }],
      };
    },
  );

  return server;
};
