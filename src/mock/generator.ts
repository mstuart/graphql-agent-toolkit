import { unwrapType } from '../operations/variables.js';
import { GraphQLExecutor } from '../mcp/executor.js';
import type { ParsedSchema, SchemaField, TypeReference } from '../types/index.js';

export interface MockConfig {
  seed?: number;
  arrayLength?: number;
  maxDepth?: number;
}

const DEFAULT_ARRAY_LENGTH = 3;
const DEFAULT_MAX_DEPTH = 3;

/**
 * Simple deterministic hash from a string.
 * Returns a positive integer.
 */
const hashString = (input: string, seed = 0): number => {
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    const codePoint = input.codePointAt(index) ?? 0;
    hash = Math.imul(Math.imul(hash, 31) + codePoint, 1);
  }
  return Math.abs(hash);
};

/**
 * Parse @mock(...) directive from a field description.
 * Supports: @mock("string value"), @mock(123), @mock(true), @mock(false)
 */
const parseMockDirective = (description: string | null): unknown | undefined => {
  if (!description) {
    return undefined;
  }

  const match = description.match(/@mock\((?<value>[^)]+)\)/u);
  const rawValue = match?.groups?.value;
  if (!rawValue) {
    return undefined;
  }

  const raw = rawValue.trim();

  // String value: @mock("value") or @mock('value')
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }

  // Number
  const numericValue = Number(raw);
  if (!Number.isNaN(numericValue)) {
    return numericValue;
  }

  // Fallback: return raw string
  return raw;
};

/**
 * Generate a mock scalar value for a given type name and field name.
 */
interface GenerationContext {
  arrayLength: number;
  depth: number;
  index: number;
  maxDepth: number;
  schema: ParsedSchema;
  seed: number;
  visited: Set<string>;
}

const generateScalar = (
  typeName: string,
  fieldName: string,
  { index, seed }: Pick<GenerationContext, 'index' | 'seed'>,
): unknown => {
  const hash = hashString(fieldName, seed);

  switch (typeName) {
    case 'String': {
      return `mock_${fieldName}`;
    }
    case 'Int': {
      return (hash % 1000) + index;
    }
    case 'Float': {
      return Number(((hash % 10_000) / 100 + index * 0.1).toFixed(2));
    }
    case 'Boolean': {
      return index % 2 === 0;
    }
    case 'ID': {
      return `id_${fieldName}_${index}`;
    }
    default: {
      return `mock_${typeName}_${fieldName}`;
    }
  }
};

const generators = {
  forField: (context: GenerationContext, field: SchemaField): unknown =>
    generators.forTypeReference(context, field.type, field.name),

  forType: (context: GenerationContext, typeName: string): Record<string, unknown> => {
    const type = context.schema.types.get(typeName);
    if (!type || type.fields.length === 0) {
      return {};
    }

    const result: Record<string, unknown> = {};

    for (const field of type.fields) {
      // Check for @mock directive in description
      const mockValue = parseMockDirective(field.description);
      if (mockValue !== undefined) {
        result[field.name] = mockValue;
        continue;
      }

      result[field.name] = generators.forField(context, field);
    }

    return result;
  },

  forTypeReference: (
    context: GenerationContext,
    typeReference: TypeReference,
    fieldName: string,
  ): unknown => {
    const { arrayLength, depth, maxDepth, schema, visited } = context;
    // Unwrap NON_NULL
    if (typeReference.kind === 'NON_NULL') {
      if (!typeReference.ofType) {
        return null;
      }
      return generators.forTypeReference(context, typeReference.ofType, fieldName);
    }

    // Handle LIST
    if (typeReference.kind === 'LIST') {
      if (!typeReference.ofType) {
        return [];
      }
      if (depth >= maxDepth) {
        return [];
      }

      const items: unknown[] = [];
      for (let itemIndex = 0; itemIndex < arrayLength; itemIndex += 1) {
        items.push(
          generators.forTypeReference(
            {
              ...context,
              index: itemIndex,
              visited: new Set(visited),
            },
            typeReference.ofType,
            fieldName,
          ),
        );
      }
      return items;
    }

    const unwrapped = unwrapType(typeReference);
    const resolvedTypeName = unwrapped.name;

    if (!resolvedTypeName) {
      return null;
    }

    // Check if it's an enum
    const namedType = schema.types.get(resolvedTypeName);
    if (namedType && namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
      return namedType.enumValues[0].name;
    }

    // Check if it's a scalar
    if (unwrapped.kind === 'SCALAR' || (namedType && namedType.kind === 'SCALAR')) {
      return generateScalar(resolvedTypeName, fieldName, context);
    }

    // It's an object type — recurse if within depth
    if (depth >= maxDepth) {
      return null;
    }

    // Prevent infinite recursion for circular types
    if (visited.has(resolvedTypeName)) {
      return null;
    }

    visited.add(resolvedTypeName);
    const result = generators.forType(
      {
        ...context,
        depth: depth + 1,
        visited: new Set(visited),
      },
      resolvedTypeName,
    );
    visited.delete(resolvedTypeName);

    return result;
  },
};

/**
 * Generate mock data for a specific type in the schema.
 */
export const generateMockData = (
  schema: ParsedSchema,
  typeName: string,
  config?: MockConfig,
): Record<string, unknown> => {
  const seed = config?.seed ?? 0;
  const arrayLength = config?.arrayLength ?? DEFAULT_ARRAY_LENGTH;
  const maxDepth = config?.maxDepth ?? DEFAULT_MAX_DEPTH;

  return generators.forType(
    {
      arrayLength,
      depth: 0,
      index: 0,
      maxDepth,
      schema,
      seed,
      visited: new Set(),
    },
    typeName,
  );
};

/**
 * Extract the root field name from a GraphQL operation string.
 */
const extractRootFieldName = (operation: string): string | null => {
  // Match the first field after the opening brace of the operation
  // e.g., "query UserQuery($id: ID!) {\n  user(id: $id) {\n..."
  const match = operation.match(/\{\s*(?<fieldName>\w+)/u);
  return match?.groups?.fieldName ?? null;
};

/**
 * Find the return type name for a root field.
 */
const findReturnTypeName = (schema: ParsedSchema, fieldName: string): string | null => {
  // Check query type
  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    const field = queryType.fields.find((f) => f.name === fieldName);
    if (field) {
      const unwrapped = unwrapType(field.type);
      return unwrapped.name;
    }
  }

  // Check mutation type
  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      const field = mutationType.fields.find((f) => f.name === fieldName);
      if (field) {
        const unwrapped = unwrapType(field.type);
        return unwrapped.name;
      }
    }
  }

  return null;
};

const isListTypeReference = (typeReference: TypeReference): boolean => {
  if (typeReference.kind === 'LIST') {
    return true;
  }
  if (typeReference.kind === 'NON_NULL' && typeReference.ofType) {
    return isListTypeReference(typeReference.ofType);
  }
  return false;
};

/**
 * Check if a root field returns a list type.
 */
const isListField = (schema: ParsedSchema, fieldName: string): boolean => {
  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    const field = queryType.fields.find((f) => f.name === fieldName);
    if (field) {
      return isListTypeReference(field.type);
    }
  }

  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      const field = mutationType.fields.find((f) => f.name === fieldName);
      if (field) {
        return isListTypeReference(field.type);
      }
    }
  }

  return false;
};

/**
 * Create a mock executor that returns generated data instead of HTTP calls.
 * Implements the same interface as GraphQLExecutor.
 */
export const createMockExecutor = (schema: ParsedSchema, config?: MockConfig): GraphQLExecutor => {
  const mockExecutor = Object.create(GraphQLExecutor.prototype) as GraphQLExecutor;

  // Override the execute method
  (mockExecutor as unknown as Record<string, unknown>).execute = async (
    operation: string,
  ): Promise<string> => {
    // Parse the operation to find the root field name and its return type
    const rootFieldName = extractRootFieldName(operation);
    if (!rootFieldName) {
      return JSON.stringify({ data: null });
    }

    // Find the return type from the schema
    const returnTypeName = findReturnTypeName(schema, rootFieldName);
    if (!returnTypeName) {
      return JSON.stringify({ data: { [rootFieldName]: null } });
    }

    // Check if it's a scalar return type
    const returnType = schema.types.get(returnTypeName);
    if (!returnType || returnType.kind === 'SCALAR') {
      const scalarValue = generateScalar(returnTypeName, rootFieldName, {
        index: 0,
        seed: config?.seed ?? 0,
      });
      return JSON.stringify({ data: { [rootFieldName]: scalarValue } }, null, 2);
    }

    // Check if the field returns a list
    const isList = isListField(schema, rootFieldName);
    if (isList) {
      const arrayLength = config?.arrayLength ?? DEFAULT_ARRAY_LENGTH;
      const items: Record<string, unknown>[] = [];
      for (let index = 0; index < arrayLength; index += 1) {
        items.push(
          generateMockData(schema, returnTypeName, {
            ...config,
            seed: (config?.seed ?? 0) + index,
          }),
        );
      }
      return JSON.stringify({ data: { [rootFieldName]: items } }, null, 2);
    }

    const mockData = generateMockData(schema, returnTypeName, config);
    return JSON.stringify({ data: { [rootFieldName]: mockData } }, null, 2);
  };

  return mockExecutor;
};
