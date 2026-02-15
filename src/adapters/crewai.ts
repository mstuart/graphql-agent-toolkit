import type { ParsedSchema, SchemaField, TypeRef } from '../types/index.js';
import { buildOperation } from '../operations/index.js';
import { unwrapType } from '../operations/variables.js';
import type { GraphQLExecutor } from '../mcp/executor.js';

export interface CrewAIToolConfig {
  name: string;
  description: string;
  args_schema: Record<string, unknown>;
  func: (args: Record<string, unknown>) => Promise<string>;
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
 * Build JSON Schema for a field's arguments, using CrewAI conventions.
 */
function buildArgsSchema(
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
 * Create tools compatible with CrewAI's tool interface.
 * CrewAI uses args_schema (JSON Schema) and func takes a dict.
 */
export function createCrewAITools(
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): CrewAIToolConfig[] {
  const maxDepth = options?.maxDepth ?? 2;
  const tools: CrewAIToolConfig[] = [];

  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    for (const field of queryType.fields) {
      const toolName = `query_${field.name}`;
      const description = field.description || `Query ${field.name}`;
      const argsSchema = buildArgsSchema(field, schema);

      tools.push({
        name: toolName,
        description,
        args_schema: argsSchema,
        func: async (args: Record<string, unknown>): Promise<string> => {
          const op = buildOperation(schema, field.name, { maxDepth });
          return executor.execute(op.operation, args);
        },
      });
    }
  }

  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      for (const field of mutationType.fields) {
        const toolName = `mutate_${field.name}`;
        const description = field.description || `Mutation ${field.name}`;
        const argsSchema = buildArgsSchema(field, schema);

        tools.push({
          name: toolName,
          description,
          args_schema: argsSchema,
          func: async (args: Record<string, unknown>): Promise<string> => {
            const op = buildOperation(schema, field.name, { maxDepth });
            return executor.execute(op.operation, args);
          },
        });
      }
    }
  }

  return tools;
}
