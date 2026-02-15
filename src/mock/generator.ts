import type { ParsedSchema, SchemaType, SchemaField, TypeRef } from '../types/index.js';
import { unwrapType } from '../operations/variables.js';
import { GraphQLExecutor } from '../mcp/executor.js';
import { buildOperation } from '../operations/index.js';

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
function hashString(str: string, seed: number = 0): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

/**
 * Parse @mock(...) directive from a field description.
 * Supports: @mock("string value"), @mock(123), @mock(true), @mock(false)
 */
function parseMockDirective(description: string | null): unknown | undefined {
  if (!description) return undefined;

  const match = description.match(/@mock\(([^)]+)\)/);
  if (!match) return undefined;

  const raw = match[1].trim();

  // String value: @mock("value") or @mock('value')
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number
  const num = Number(raw);
  if (!isNaN(num)) return num;

  // Fallback: return raw string
  return raw;
}

/**
 * Generate a mock scalar value for a given type name and field name.
 */
function generateScalar(
  typeName: string,
  fieldName: string,
  index: number,
  seed: number,
): unknown {
  const hash = hashString(fieldName, seed);

  switch (typeName) {
    case 'String':
      return `mock_${fieldName}`;
    case 'Int':
      return (hash % 1000) + index;
    case 'Float':
      return parseFloat(((hash % 10000) / 100 + index * 0.1).toFixed(2));
    case 'Boolean':
      return index % 2 === 0;
    case 'ID':
      return `id_${fieldName}_${index}`;
    default:
      return `mock_${typeName}_${fieldName}`;
  }
}

/**
 * Generate mock data for a specific type in the schema.
 */
export function generateMockData(
  schema: ParsedSchema,
  typeName: string,
  config?: MockConfig,
): Record<string, unknown> {
  const seed = config?.seed ?? 0;
  const arrayLength = config?.arrayLength ?? DEFAULT_ARRAY_LENGTH;
  const maxDepth = config?.maxDepth ?? DEFAULT_MAX_DEPTH;

  return generateForType(schema, typeName, 0, maxDepth, arrayLength, seed, 0, new Set());
}

function generateForType(
  schema: ParsedSchema,
  typeName: string,
  depth: number,
  maxDepth: number,
  arrayLength: number,
  seed: number,
  index: number,
  visited: Set<string>,
): Record<string, unknown> {
  const type = schema.types.get(typeName);
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

    result[field.name] = generateForField(
      schema,
      field,
      depth,
      maxDepth,
      arrayLength,
      seed,
      index,
      visited,
    );
  }

  return result;
}

function generateForField(
  schema: ParsedSchema,
  field: SchemaField,
  depth: number,
  maxDepth: number,
  arrayLength: number,
  seed: number,
  index: number,
  visited: Set<string>,
): unknown {
  return generateForTypeRef(
    schema,
    field.type,
    field.name,
    depth,
    maxDepth,
    arrayLength,
    seed,
    index,
    visited,
  );
}

function generateForTypeRef(
  schema: ParsedSchema,
  typeRef: TypeRef,
  fieldName: string,
  depth: number,
  maxDepth: number,
  arrayLength: number,
  seed: number,
  index: number,
  visited: Set<string>,
): unknown {
  // Unwrap NON_NULL
  if (typeRef.kind === 'NON_NULL') {
    if (!typeRef.ofType) return null;
    return generateForTypeRef(
      schema,
      typeRef.ofType,
      fieldName,
      depth,
      maxDepth,
      arrayLength,
      seed,
      index,
      visited,
    );
  }

  // Handle LIST
  if (typeRef.kind === 'LIST') {
    if (!typeRef.ofType) return [];
    if (depth >= maxDepth) return [];

    const items: unknown[] = [];
    for (let i = 0; i < arrayLength; i++) {
      items.push(
        generateForTypeRef(
          schema,
          typeRef.ofType,
          fieldName,
          depth,
          maxDepth,
          arrayLength,
          seed,
          i,
          new Set(visited),
        ),
      );
    }
    return items;
  }

  const unwrapped = unwrapType(typeRef);
  const resolvedTypeName = unwrapped.name;

  if (!resolvedTypeName) return null;

  // Check if it's an enum
  const namedType = schema.types.get(resolvedTypeName);
  if (namedType && namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
    return namedType.enumValues[0].name;
  }

  // Check if it's a scalar
  if (
    unwrapped.kind === 'SCALAR' ||
    (namedType && namedType.kind === 'SCALAR')
  ) {
    return generateScalar(resolvedTypeName, fieldName, index, seed);
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
  const result = generateForType(
    schema,
    resolvedTypeName,
    depth + 1,
    maxDepth,
    arrayLength,
    seed,
    index,
    new Set(visited),
  );
  visited.delete(resolvedTypeName);

  return result;
}

/**
 * Create a mock executor that returns generated data instead of HTTP calls.
 * Implements the same interface as GraphQLExecutor.
 */
export function createMockExecutor(
  schema: ParsedSchema,
  config?: MockConfig,
): GraphQLExecutor {
  const mockExecutor = Object.create(GraphQLExecutor.prototype) as GraphQLExecutor;

  // Override the execute method
  (mockExecutor as any).execute = async (
    operation: string,
    _variables?: Record<string, unknown>,
    _additionalHeaders?: Record<string, string>,
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
      const scalarValue = generateScalar(returnTypeName, rootFieldName, 0, config?.seed ?? 0);
      return JSON.stringify({ data: { [rootFieldName]: scalarValue } }, null, 2);
    }

    // Check if the field returns a list
    const isList = isListField(schema, rootFieldName);
    if (isList) {
      const arrayLength = config?.arrayLength ?? DEFAULT_ARRAY_LENGTH;
      const items: Record<string, unknown>[] = [];
      for (let i = 0; i < arrayLength; i++) {
        items.push(generateMockData(schema, returnTypeName, { ...config, seed: (config?.seed ?? 0) + i }));
      }
      return JSON.stringify({ data: { [rootFieldName]: items } }, null, 2);
    }

    const mockData = generateMockData(schema, returnTypeName, config);
    return JSON.stringify({ data: { [rootFieldName]: mockData } }, null, 2);
  };

  return mockExecutor;
}

/**
 * Extract the root field name from a GraphQL operation string.
 */
function extractRootFieldName(operation: string): string | null {
  // Match the first field after the opening brace of the operation
  // e.g., "query UserQuery($id: ID!) {\n  user(id: $id) {\n..."
  const match = operation.match(/(?:query|mutation|subscription)\s+\w*[^{]*\{\s*(\w+)/);
  if (match) return match[1];

  // Try simpler pattern: "{ fieldName"
  const simpleMatch = operation.match(/\{\s*(\w+)/);
  return simpleMatch ? simpleMatch[1] : null;
}

/**
 * Find the return type name for a root field.
 */
function findReturnTypeName(schema: ParsedSchema, fieldName: string): string | null {
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
}

/**
 * Check if a root field returns a list type.
 */
function isListField(schema: ParsedSchema, fieldName: string): boolean {
  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    const field = queryType.fields.find((f) => f.name === fieldName);
    if (field) return isListTypeRef(field.type);
  }

  if (schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      const field = mutationType.fields.find((f) => f.name === fieldName);
      if (field) return isListTypeRef(field.type);
    }
  }

  return false;
}

function isListTypeRef(typeRef: TypeRef): boolean {
  if (typeRef.kind === 'LIST') return true;
  if (typeRef.kind === 'NON_NULL' && typeRef.ofType) return isListTypeRef(typeRef.ofType);
  return false;
}
