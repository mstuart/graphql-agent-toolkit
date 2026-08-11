import { z } from 'zod';
import { buildOperation } from '../operations/index.js';
import { typeReferenceToZod } from '../zod.js';
import { unwrapType } from '../operations/variables.js';
import type {
  ParsedSchema,
  SchemaField,
  SchemaType,
  TypeRef as TypeReference,
} from '../types/index.js';
import type { GraphQLExecutor } from '../mcp/executor.js';

export interface LangChainToolConfig {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  func: (input: string) => Promise<string>;
}

export interface StructuredToolConfig {
  name: string;
  description: string;
  schema: z.ZodObject<Record<string, z.ZodType>>;
  func: (input: Record<string, unknown>) => Promise<string>;
}

interface AdapterOptions {
  maxDepth?: number;
}

type JsonSchemaConverter = (
  typeReference: TypeReference,
  schema: ParsedSchema,
) => Record<string, unknown>;

const namedTypeToJsonSchema = (
  namedType: SchemaType,
  schema: ParsedSchema,
  convertType: JsonSchemaConverter,
): Record<string, unknown> | undefined => {
  if (namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
    return { enum: namedType.enumValues.map((value) => value.name), type: 'string' };
  }

  if (namedType.kind !== 'INPUT_OBJECT') {
    return undefined;
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of namedType.inputFields) {
    properties[field.name] = convertType(field.type, schema);
    if (field.type.kind === 'NON_NULL') {
      required.push(field.name);
    }
  }
  const result: Record<string, unknown> = { properties, type: 'object' };
  if (required.length > 0) {
    result.required = required;
  }
  return result;
};

/**
 * Convert a GraphQL TypeRef to a JSON Schema representation.
 */
const typeReferenceToJsonSchema = (
  typeReference: TypeReference,
  schema: ParsedSchema,
): Record<string, unknown> => {
  if (typeReference.kind === 'NON_NULL') {
    if (!typeReference.ofType) {
      return { type: 'string' };
    }
    return typeReferenceToJsonSchema(typeReference.ofType, schema);
  }

  if (typeReference.kind === 'LIST') {
    if (!typeReference.ofType) {
      return { items: {}, type: 'array' };
    }
    return { items: typeReferenceToJsonSchema(typeReference.ofType, schema), type: 'array' };
  }

  const unwrapped = unwrapType(typeReference);
  const typeName = unwrapped.name;

  if (typeName) {
    const namedType = schema.types.get(typeName);
    if (namedType) {
      const namedSchema = namedTypeToJsonSchema(namedType, schema, typeReferenceToJsonSchema);
      if (namedSchema) {
        return namedSchema;
      }
    }
  }

  switch (typeName) {
    case 'String':
    case 'ID': {
      return { type: 'string' };
    }
    case 'Int': {
      return { type: 'integer' };
    }
    case 'Float': {
      return { type: 'number' };
    }
    case 'Boolean': {
      return { type: 'boolean' };
    }
    default: {
      return {};
    }
  }
};

/**
 * Build JSON Schema for a field's arguments.
 */
const buildJsonSchema = (field: SchemaField, schema: ParsedSchema): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const argument of field.args) {
    properties[argument.name] = typeReferenceToJsonSchema(argument.type, schema);
    if (argument.type.kind === 'NON_NULL') {
      required.push(argument.name);
    }
  }

  const result: Record<string, unknown> = {
    properties,
    type: 'object',
  };
  if (required.length > 0) {
    result.required = required;
  }
  return result;
};

/**
 * Build a Zod object schema for a field's arguments.
 */
const buildZodSchema = (
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
 * Collect all query/mutation fields from the schema.
 */
const collectRootFields = (
  schema: ParsedSchema,
): { field: SchemaField; operationType: 'query' | 'mutation' }[] => {
  const result: { field: SchemaField; operationType: 'query' | 'mutation' }[] = [];

  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    for (const field of queryType.fields) {
      result.push({ field, operationType: 'query' });
    }
  }

  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      for (const field of mutationType.fields) {
        result.push({ field, operationType: 'mutation' });
      }
    }
  }

  return result;
};

/**
 * Create tools compatible with LangChain's Tool pattern.
 * Each tool's func accepts a JSON string input and returns a JSON string.
 */
export const createLangChainTools = (
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): LangChainToolConfig[] => {
  const maxDepth = options?.maxDepth ?? 2;
  const rootFields = collectRootFields(schema);

  return rootFields.map(({ field, operationType }) => {
    const toolName = operationType === 'query' ? `query_${field.name}` : `mutate_${field.name}`;
    const description =
      field.description || `${operationType === 'query' ? 'Query' : 'Mutation'} ${field.name}`;
    const jsonSchema = buildJsonSchema(field, schema);

    return {
      description,
      func: async (input: string): Promise<string> => {
        const variables = input ? JSON.parse(input) : {};
        const op = buildOperation(schema, field.name, { maxDepth });
        return executor.execute(op.operation, variables);
      },
      name: toolName,
      schema: jsonSchema,
    };
  });
};

/**
 * Create tools compatible with LangChain's StructuredTool pattern.
 * Each tool's func accepts a typed object and returns a JSON string.
 */
export const createStructuredTools = (
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): StructuredToolConfig[] => {
  const maxDepth = options?.maxDepth ?? 2;
  const rootFields = collectRootFields(schema);

  return rootFields.map(({ field, operationType }) => {
    const toolName = operationType === 'query' ? `query_${field.name}` : `mutate_${field.name}`;
    const description =
      field.description || `${operationType === 'query' ? 'Query' : 'Mutation'} ${field.name}`;
    const zodSchema = buildZodSchema(field, schema);

    return {
      description,
      func: async (input: Record<string, unknown>): Promise<string> => {
        const op = buildOperation(schema, field.name, { maxDepth });
        return executor.execute(op.operation, input);
      },
      name: toolName,
      schema: zodSchema,
    };
  });
};
