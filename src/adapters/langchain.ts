import { z } from 'zod';
import type { ParsedSchema, SchemaField, TypeRef } from '../types/index.js';
import { buildOperation } from '../operations/index.js';
import { unwrapType } from '../operations/variables.js';
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
  schema: z.ZodObject<any>;
  func: (input: Record<string, unknown>) => Promise<string>;
}

interface AdapterOptions {
  maxDepth?: number;
}

/**
 * Convert a GraphQL TypeRef to a JSON Schema representation.
 */
function typeRefToJsonSchema(typeRef: TypeRef, schema: ParsedSchema): Record<string, unknown> {
  if (typeRef.kind === 'NON_NULL') {
    if (!typeRef.ofType) return { type: 'string' };
    return typeRefToJsonSchema(typeRef.ofType, schema);
  }

  if (typeRef.kind === 'LIST') {
    if (!typeRef.ofType) return { type: 'array', items: {} };
    return { type: 'array', items: typeRefToJsonSchema(typeRef.ofType, schema) };
  }

  const unwrapped = unwrapType(typeRef);
  const typeName = unwrapped.name;

  if (typeName) {
    const namedType = schema.types.get(typeName);
    if (namedType && namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
      return { type: 'string', enum: namedType.enumValues.map((v) => v.name) };
    }

    if (namedType && namedType.kind === 'INPUT_OBJECT') {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const field of namedType.inputFields) {
        properties[field.name] = typeRefToJsonSchema(field.type, schema);
        if (field.type.kind === 'NON_NULL') {
          required.push(field.name);
        }
      }
      const result: Record<string, unknown> = { type: 'object', properties };
      if (required.length > 0) result.required = required;
      return result;
    }
  }

  switch (typeName) {
    case 'String':
    case 'ID':
      return { type: 'string' };
    case 'Int':
      return { type: 'integer' };
    case 'Float':
      return { type: 'number' };
    case 'Boolean':
      return { type: 'boolean' };
    default:
      return {};
  }
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
 * Build JSON Schema for a field's arguments.
 */
function buildJsonSchema(
  field: SchemaField,
  schema: ParsedSchema,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const arg of field.args) {
    properties[arg.name] = typeRefToJsonSchema(arg.type, schema);
    if (arg.type.kind === 'NON_NULL') {
      required.push(arg.name);
    }
  }

  const result: Record<string, unknown> = {
    type: 'object',
    properties,
  };
  if (required.length > 0) result.required = required;
  return result;
}

/**
 * Build a Zod object schema for a field's arguments.
 */
function buildZodSchema(
  field: SchemaField,
  schema: ParsedSchema,
): z.ZodObject<any> {
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
 * Collect all query/mutation fields from the schema.
 */
function collectRootFields(
  schema: ParsedSchema,
): Array<{ field: SchemaField; operationType: 'query' | 'mutation' }> {
  const result: Array<{ field: SchemaField; operationType: 'query' | 'mutation' }> = [];

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
}

/**
 * Create tools compatible with LangChain's Tool pattern.
 * Each tool's func accepts a JSON string input and returns a JSON string.
 */
export function createLangChainTools(
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): LangChainToolConfig[] {
  const maxDepth = options?.maxDepth ?? 2;
  const rootFields = collectRootFields(schema);

  return rootFields.map(({ field, operationType }) => {
    const toolName = operationType === 'query' ? `query_${field.name}` : `mutate_${field.name}`;
    const description = field.description || `${operationType === 'query' ? 'Query' : 'Mutation'} ${field.name}`;
    const jsonSchema = buildJsonSchema(field, schema);

    return {
      name: toolName,
      description,
      schema: jsonSchema,
      func: async (input: string): Promise<string> => {
        const variables = input ? JSON.parse(input) : {};
        const op = buildOperation(schema, field.name, { maxDepth });
        return executor.execute(op.operation, variables);
      },
    };
  });
}

/**
 * Create tools compatible with LangChain's StructuredTool pattern.
 * Each tool's func accepts a typed object and returns a JSON string.
 */
export function createStructuredTools(
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): StructuredToolConfig[] {
  const maxDepth = options?.maxDepth ?? 2;
  const rootFields = collectRootFields(schema);

  return rootFields.map(({ field, operationType }) => {
    const toolName = operationType === 'query' ? `query_${field.name}` : `mutate_${field.name}`;
    const description = field.description || `${operationType === 'query' ? 'Query' : 'Mutation'} ${field.name}`;
    const zodSchema = buildZodSchema(field, schema);

    return {
      name: toolName,
      description,
      schema: zodSchema,
      func: async (input: Record<string, unknown>): Promise<string> => {
        const op = buildOperation(schema, field.name, { maxDepth });
        return executor.execute(op.operation, input);
      },
    };
  });
}
