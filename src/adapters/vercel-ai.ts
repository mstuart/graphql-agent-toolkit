import { z } from 'zod';
import { buildOperation } from '../operations/index.js';
import { typeReferenceToZod } from '../zod.js';
import type { ParsedSchema, SchemaField } from '../types/index.js';
import type { GraphQLExecutor } from '../mcp/executor.js';

export interface VercelAIToolConfig {
  description: string;
  parameters: z.ZodObject<Record<string, z.ZodType>>;
  execute: (parameters: Record<string, unknown>) => Promise<string>;
}

interface AdapterOptions {
  maxDepth?: number;
}

/**
 * Build a Zod object schema for a field's arguments.
 */
const buildParametersSchema = (
  field: SchemaField,
  schema: ParsedSchema,
): z.ZodObject<Record<string, z.ZodType>> => {
  const shape: Record<string, z.ZodType> = {};

  for (const argument of field.args) {
    shape[argument.name] = typeReferenceToZod(argument.type, schema);
  }

  return z.object(shape);
};

/**
 * Create tools compatible with Vercel AI SDK's tool() shape.
 * Returns Record<toolName, { description, parameters: ZodSchema, execute }>.
 */
export const createVercelAITools = (
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): Record<string, VercelAIToolConfig> => {
  const maxDepth = options?.maxDepth ?? 2;
  const tools: Record<string, VercelAIToolConfig> = {};

  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    for (const field of queryType.fields) {
      const toolName = `query_${field.name}`;
      const description = field.description || `Query ${field.name}`;
      const parameters = buildParametersSchema(field, schema);

      tools[toolName] = {
        description,
        execute: async (input: Record<string, unknown>): Promise<string> => {
          const op = buildOperation(schema, field.name, { maxDepth });
          return executor.execute(op.operation, input);
        },
        parameters,
      };
    }
  }

  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      for (const field of mutationType.fields) {
        const toolName = `mutate_${field.name}`;
        const description = field.description || `Mutation ${field.name}`;
        const parameters = buildParametersSchema(field, schema);

        tools[toolName] = {
          description,
          execute: async (input: Record<string, unknown>): Promise<string> => {
            const op = buildOperation(schema, field.name, { maxDepth });
            return executor.execute(op.operation, input);
          },
          parameters,
        };
      }
    }
  }

  return tools;
};
