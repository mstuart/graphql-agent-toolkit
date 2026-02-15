import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentToolkitConfig } from '../types/index.js';
import { fetchSchema } from '../introspection/fetcher.js';
import { parseSchema } from '../introspection/parser.js';
import { GraphQLExecutor } from './executor.js';
import { createToolsFromSchema } from './tool-factory.js';

const packageVersion = process.env.PACKAGE_VERSION || '0.1.0';

export interface AgentToolkitServerOptions {
  serverName?: string;
  serverVersion?: string;
}

/**
 * Creates a fully configured MCP server from a GraphQL endpoint configuration.
 */
export async function createAgentToolkitServer(
  config: AgentToolkitConfig,
  options?: AgentToolkitServerOptions,
): Promise<McpServer> {
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
    maxDepth: config.operationDepth ?? 2,
    includeDeprecated: config.includeDeprecated ?? false,
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
      server.tool(
        tool.name,
        tool.description,
        inputSchema,
        async (args) => {
          try {
            const result = await tool.execute(args as Record<string, unknown>);
            return {
              content: [{ type: 'text' as const, text: result }],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
              content: [{ type: 'text' as const, text: `Error: ${message}` }],
              isError: true,
            };
          }
        },
      );
    } else {
      server.tool(
        tool.name,
        tool.description,
        async () => {
          try {
            const result = await tool.execute({});
            return {
              content: [{ type: 'text' as const, text: result }],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
              content: [{ type: 'text' as const, text: `Error: ${message}` }],
              isError: true,
            };
          }
        },
      );
    }
  }

  // Register a schema explorer resource
  server.tool(
    'explore_schema',
    'Explore the GraphQL schema — list types, fields, and arguments',
    {
      typeName: z.string().optional().describe('Type name to explore. If omitted, lists all types.'),
    },
    async (args) => {
      if (args.typeName) {
        const type = schema.types.get(args.typeName);
        if (!type) {
          return {
            content: [{ type: 'text' as const, text: `Type "${args.typeName}" not found.` }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(type, null, 2) }],
        };
      }

      const typeList = Array.from(schema.types.values())
        .filter((t) => !['SCALAR'].includes(t.kind))
        .map((t) => `${t.kind} ${t.name}${t.description ? ` — ${t.description}` : ''}`);

      return {
        content: [{ type: 'text' as const, text: typeList.join('\n') }],
      };
    },
  );

  return server;
}
