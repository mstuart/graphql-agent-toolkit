import { z } from 'zod';
import type { ParsedSchema, SchemaField, TypeRef } from '../types/index.js';
import { buildOperation } from '../operations/index.js';
import { unwrapType } from '../operations/variables.js';
import type { GraphQLExecutor } from './executor.js';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface CreateToolsOptions {
  maxDepth?: number;
  includeDeprecated?: boolean;
}

/**
 * Maps a GraphQL TypeRef to a Zod schema for validation.
 */
function typeRefToZod(typeRef: TypeRef, schema: ParsedSchema): z.ZodType {
  if (typeRef.kind === 'NON_NULL') {
    if (!typeRef.ofType) return z.unknown();
    return typeRefToZod(typeRef.ofType, schema);
  }

  if (typeRef.kind === 'LIST') {
    if (!typeRef.ofType) return z.array(z.unknown());
    return z.array(typeRefToZod(typeRef.ofType, schema)).optional();
  }

  const unwrapped = unwrapType(typeRef);
  const typeName = unwrapped.name;

  if (typeName) {
    // Check if it's an enum
    const namedType = schema.types.get(typeName);
    if (namedType && namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
      const values = namedType.enumValues.map((v) => v.name) as [string, ...string[]];
      return z.enum(values).optional();
    }

    // Check if it's an input object
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

  // Map scalars
  switch (typeName) {
    case 'String':
      return z.string().optional();
    case 'Int':
      return z.number().int().optional();
    case 'Float':
      return z.number().optional();
    case 'Boolean':
      return z.boolean().optional();
    case 'ID':
      return z.string().optional();
    default:
      return z.unknown().optional();
  }
}

/**
 * Builds the Zod input schema object for a tool from a field's arguments.
 */
function buildInputSchema(
  field: SchemaField,
  schema: ParsedSchema,
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};

  for (const arg of field.args) {
    const zodType = typeRefToZod(arg.type, schema);
    if (arg.type.kind === 'NON_NULL') {
      shape[arg.name] = zodType;
    } else {
      shape[arg.name] = zodType.optional();
    }
  }

  return shape;
}

/**
 * Creates MCP tool definitions from a parsed GraphQL schema.
 */
export function createToolsFromSchema(
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: CreateToolsOptions,
): McpToolDefinition[] {
  const maxDepth = options?.maxDepth ?? 2;
  const includeDeprecated = options?.includeDeprecated ?? false;
  const tools: McpToolDefinition[] = [];

  // Process query fields
  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    for (const field of queryType.fields) {
      if (field.isDeprecated && !includeDeprecated) continue;

      const toolName = `query_${field.name}`;
      const description = field.description || `Query ${field.name}`;
      const inputSchema = buildInputSchema(field, schema);

      tools.push({
        name: toolName,
        description,
        inputSchema,
        execute: async (args: Record<string, unknown>) => {
          const op = buildOperation(schema, field.name, { maxDepth, includeDeprecated });
          return executor.execute(op.operation, args);
        },
      });
    }
  }

  // Process mutation fields
  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      for (const field of mutationType.fields) {
        if (field.isDeprecated && !includeDeprecated) continue;

        const toolName = `mutate_${field.name}`;
        const description = field.description || `Mutation ${field.name}`;
        const inputSchema = buildInputSchema(field, schema);

        tools.push({
          name: toolName,
          description,
          inputSchema,
          execute: async (args: Record<string, unknown>) => {
            const op = buildOperation(schema, field.name, { maxDepth, includeDeprecated });
            return executor.execute(op.operation, args);
          },
        });
      }
    }
  }

  return tools;
}
