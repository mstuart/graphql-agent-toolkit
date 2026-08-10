import { buildOperation } from '../operations/index.js';
import { unwrapType } from '../operations/variables.js';
import type {
  ParsedSchema,
  SchemaField,
  SchemaType,
  TypeRef as TypeReference,
} from '../types/index.js';
import type { GraphQLExecutor } from '../mcp/executor.js';

export interface CrewAIToolConfig {
  name: string;
  description: string;
  args_schema: Record<string, unknown>;
  func: (parameters: Record<string, unknown>) => Promise<string>;
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
 * Build JSON Schema for a field's arguments, using CrewAI conventions.
 */
const buildArgumentsSchema = (
  field: SchemaField,
  schema: ParsedSchema,
): Record<string, unknown> => {
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
 * Create tools compatible with CrewAI's tool interface.
 * CrewAI uses args_schema (JSON Schema) and func takes a dict.
 */
export const createCrewAITools = (
  schema: ParsedSchema,
  executor: GraphQLExecutor,
  options?: AdapterOptions,
): CrewAIToolConfig[] => {
  const maxDepth = options?.maxDepth ?? 2;
  const tools: CrewAIToolConfig[] = [];

  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    for (const field of queryType.fields) {
      const toolName = `query_${field.name}`;
      const description = field.description || `Query ${field.name}`;
      const argumentsSchema = buildArgumentsSchema(field, schema);

      tools.push({
        args_schema: argumentsSchema,
        description,
        func: async (parameters: Record<string, unknown>): Promise<string> => {
          const op = buildOperation(schema, field.name, { maxDepth });
          return executor.execute(op.operation, parameters);
        },
        name: toolName,
      });
    }
  }

  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      for (const field of mutationType.fields) {
        const toolName = `mutate_${field.name}`;
        const description = field.description || `Mutation ${field.name}`;
        const argumentsSchema = buildArgumentsSchema(field, schema);

        tools.push({
          args_schema: argumentsSchema,
          description,
          func: async (parameters: Record<string, unknown>): Promise<string> => {
            const op = buildOperation(schema, field.name, { maxDepth });
            return executor.execute(op.operation, parameters);
          },
          name: toolName,
        });
      }
    }
  }

  return tools;
};
