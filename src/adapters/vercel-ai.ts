import { z } from 'zod';
import type { ParsedSchema, SchemaField, TypeRef } from '../types/index.js';
import { buildOperation } from '../operations/index.js';
import { unwrapType } from '../operations/variables.js';
import type { GraphQLExecutor } from '../mcp/executor.js';

export interface VercelAIToolConfig {
  description: string;
  parameters: z.ZodObject<Record<string, z.ZodType>>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

interface AdapterOptions {
  maxDepth?: number;
}

/**
 * Convert a GraphQL TypeRef to a Zod schema.
 */
function typeRefToZod(typeRef: TypeRef, schema: ParsedSchema): z.ZodType {
  if (typeRef.kind === 'NON_NULL') {
    if (!typeRef.ofType) return z.unknown();
    return typeRefToZod(typeRef.ofType, schema);
  }

  if (typeRef.kind === 'LIST') {
    if (!typeRef.ofType) return z.array(z.unknown()).optional();
    return z.array(typeRefToZod(typeRef.ofType, schema)).optional();
  }

  const unwrapped = unwrapType(typeRef);
  const typeName = unwrapped.name;

  if (typeName) {
    const namedType = schema.types.get(typeName);
    if (namedType && namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
      const values = namedType.enumValues.map((v) => v.name) as [string, ...string[]];
      return z.enum(values).optional();
    }

    if (namedType && namedType.kind === 'INPUT_OBJECT') {
      const shape: Record<string, z.ZodType> = {};
      for (const field of namedType.inputFields) {
        const fieldSchema = typeRefToZod(field.type, schema);
        if (field.type.kind === 'NON_NULL') {
          shape[field.name] = fieldSchema;
        } else {
          shape[field.name] = fieldSchema.optional();
        }
      }
      return z.object(shape);
    }
  }

  switch (typeName) {
    case 'String':
    case 'ID':
      return z.string().optional();
    case 'Int':
      return z.number().int().optional();
    case 'Float':
      return z.number().optional();
    case 'Boolean':
      return z.boolean().optional();
    default:
      return z.unknown().optional();
  }
}

/**
 * Build a Zod object schema for a field's arguments.
 */
function buildParametersSchema(
  field: SchemaField,
  schema: ParsedSchema,
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const arg of field.args) {
    const zodType = typeRefToZod(arg.type, schema);
    if (arg.type.kind === 'NON_NULL') {
      shape[arg.name] = zodType;
    } else {
      shape[arg.name] = zodType.optional();
    }
  }

  return z.object(shape);
}

/**
 * Create tools compatible with Vercel AI SDK's tool() shape.
 * Returns Record<toolName, { description, parameters: ZodSchema, execute }>.
 */
export function createVercelAITools(
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): Record<string, VercelAIToolConfig> {
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
        parameters,
        execute: async (args: Record<string, unknown>): Promise<string> => {
          const op = buildOperation(schema, field.name, { maxDepth });
          return executor.execute(op.operation, args);
        },
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
          parameters,
          execute: async (args: Record<string, unknown>): Promise<string> => {
            const op = buildOperation(schema, field.name, { maxDepth });
            return executor.execute(op.operation, args);
          },
        };
      }
    }
  }

  return tools;
}
