import { z } from 'zod';
import { buildOperation } from '../operations/index.js';
import { unwrapType } from '../operations/variables.js';
import type {
  ParsedSchema,
  SchemaField,
  SchemaType,
  TypeRef as TypeReference,
} from '../types/index.js';
import type { GraphQLExecutor } from '../mcp/executor.js';

export interface VercelAIToolConfig {
  description: string;
  parameters: z.ZodObject<Record<string, z.ZodType>>;
  execute: (parameters: Record<string, unknown>) => Promise<string>;
}

interface AdapterOptions {
  maxDepth?: number;
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
 * Convert a GraphQL TypeRef to a Zod schema.
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
      return z.array(z.unknown()).optional();
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

  switch (typeName) {
    case 'String':
    case 'ID': {
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
    default: {
      return z.unknown().optional();
    }
  }
};

/**
 * Build a Zod object schema for a field's arguments.
 */
const buildParametersSchema = (
  field: SchemaField,
  schema: ParsedSchema,
): z.ZodObject<Record<string, z.ZodType>> => {
  const shape: Record<string, z.ZodType> = {};

  for (const argument of field.args) {
    const zodType = typeReferenceToZod(argument.type, schema);
    shape[argument.name] = argument.type.kind === 'NON_NULL' ? zodType : zodType.optional();
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
