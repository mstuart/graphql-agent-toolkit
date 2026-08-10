import { z } from 'zod';
import { buildOperation } from '../operations/index.js';
import { unwrapType } from '../operations/variables.js';
import type {
  ParsedSchema,
  SchemaField,
  SchemaType,
  TypeRef as TypeReference,
} from '../types/index.js';
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

type ZodSchemaConverter = (typeReference: TypeReference, schema: ParsedSchema) => z.ZodType;

const namedTypeToZod = (
  namedType: SchemaType,
  schema: ParsedSchema,
  convertType: ZodSchemaConverter,
): z.ZodType | undefined => {
  if (namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
    const values = namedType.enumValues.map((value) => value.name) as [string, ...string[]];
    return z.enum(values).optional();
  }

  if (namedType.kind !== 'INPUT_OBJECT') {
    return undefined;
  }

  const shape: Record<string, z.ZodType> = {};
  for (const field of namedType.inputFields) {
    const fieldSchema = convertType(field.type, schema);
    shape[field.name] = field.type.kind === 'NON_NULL' ? fieldSchema : fieldSchema.optional();
  }
  return z.object(shape);
};

/**
 * Maps a GraphQL TypeRef to a Zod schema for validation.
 */
const typeReferenceToZod = (typeReference: TypeReference, schema: ParsedSchema): z.ZodType => {
  if (typeReference.kind === 'NON_NULL') {
    if (!typeReference.ofType) {
      return z.unknown();
    }
    return typeReferenceToZod(typeReference.ofType, schema);
  }

  if (typeReference.kind === 'LIST') {
    if (!typeReference.ofType) {
      return z.array(z.unknown());
    }
    return z.array(typeReferenceToZod(typeReference.ofType, schema)).optional();
  }

  const unwrapped = unwrapType(typeReference);
  const typeName = unwrapped.name;

  if (typeName) {
    const namedType = schema.types.get(typeName);
    if (namedType) {
      const namedSchema = namedTypeToZod(namedType, schema, typeReferenceToZod);
      if (namedSchema) {
        return namedSchema;
      }
    }
  }

  // Map scalars
  switch (typeName) {
    case 'String': {
      return z.string().optional();
    }
    case 'Int': {
      return z.number().int().optional();
    }
    case 'Float': {
      return z.number().optional();
    }
    case 'Boolean': {
      return z.boolean().optional();
    }
    case 'ID': {
      return z.string().optional();
    }
    default: {
      return z.unknown().optional();
    }
  }
};

/**
 * Builds the Zod input schema object for a tool from a field's arguments.
 */
const buildInputSchema = (field: SchemaField, schema: ParsedSchema): Record<string, z.ZodType> => {
  const shape: Record<string, z.ZodType> = {};

  for (const argument of field.args) {
    const zodType = typeReferenceToZod(argument.type, schema);
    shape[argument.name] = argument.type.kind === 'NON_NULL' ? zodType : zodType.optional();
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
