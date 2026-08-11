import { buildOperation } from '../operations/index.js';
import { typeReferenceToZod } from '../zod.js';
import type { z } from 'zod';
import type { ParsedSchema, SchemaField } from '../types/index.js';
import type { GraphQLExecutor } from './executor.js';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  execute: (parameters: Record<string, unknown>) => Promise<string>;
}

export interface CreateToolsOptions {
  maxDepth?: number;
  includeDeprecated?: boolean;
}

/**
 * Builds the Zod input schema object for a tool from a field's arguments.
 */
const buildInputSchema = (field: SchemaField, schema: ParsedSchema): Record<string, z.ZodType> => {
  const shape: Record<string, z.ZodType> = {};

  for (const argument of field.args) {
    shape[argument.name] = typeReferenceToZod(argument.type, schema);
  }

  return shape;
};

/**
 * Creates MCP tool definitions from a parsed GraphQL schema.
 */
export const createToolsFromSchema = (
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: CreateToolsOptions,
): McpToolDefinition[] => {
  const maxDepth = options?.maxDepth ?? 2;
  const includeDeprecated = options?.includeDeprecated ?? false;
  const tools: McpToolDefinition[] = [];

  // Process query fields
  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    for (const field of queryType.fields) {
      if (!includeDeprecated && field.isDeprecated) {
        continue;
      }

      const toolName = `query_${field.name}`;
      const description = field.description || `Query ${field.name}`;
      const inputSchema = buildInputSchema(field, schema);

      tools.push({
        description,
        execute: async (parameters: Record<string, unknown>) => {
          const op = buildOperation(schema, field.name, { includeDeprecated, maxDepth });
          return executor.execute(op.operation, parameters);
        },
        inputSchema,
        name: toolName,
      });
    }
  }

  // Process mutation fields
  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      for (const field of mutationType.fields) {
        if (!includeDeprecated && field.isDeprecated) {
          continue;
        }

        const toolName = `mutate_${field.name}`;
        const description = field.description || `Mutation ${field.name}`;
        const inputSchema = buildInputSchema(field, schema);

        tools.push({
          description,
          execute: async (parameters: Record<string, unknown>) => {
            const op = buildOperation(schema, field.name, { includeDeprecated, maxDepth });
            return executor.execute(op.operation, parameters);
          },
          inputSchema,
          name: toolName,
        });
      }
    }
  }

  return tools;
};
