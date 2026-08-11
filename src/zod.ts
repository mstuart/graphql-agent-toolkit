import { z } from 'zod';
import { unwrapType } from './operations/variables.js';
import type { ParsedSchema, TypeRef as TypeReference } from './types/index.js';

const withGraphQLNullability = (zodType: z.ZodType, isNullable: boolean): z.ZodType =>
  isNullable ? zodType.nullish() : zodType;

/**
 * Maps a GraphQL TypeRef to a Zod schema while preserving GraphQL nullability.
 * Nullable GraphQL values accept null or omission. NON_NULL values reject both.
 */
export const typeReferenceToZod = (
  typeReference: TypeReference,
  schema: ParsedSchema,
  isNullable = true,
): z.ZodType => {
  if (typeReference.kind === 'NON_NULL') {
    if (!typeReference.ofType) {
      return z.unknown();
    }
    return typeReferenceToZod(typeReference.ofType, schema, false);
  }

  if (typeReference.kind === 'LIST') {
    const itemSchema = typeReference.ofType
      ? typeReferenceToZod(typeReference.ofType, schema)
      : z.unknown();
    return withGraphQLNullability(z.array(itemSchema), isNullable);
  }

  const unwrapped = unwrapType(typeReference);
  const typeName = unwrapped.name;

  if (typeName) {
    const namedType = schema.types.get(typeName);
    if (namedType && namedType.kind === 'ENUM' && namedType.enumValues.length > 0) {
      const values = namedType.enumValues.map((value) => value.name) as [string, ...string[]];
      return withGraphQLNullability(z.enum(values), isNullable);
    }

    if (namedType && namedType.kind === 'INPUT_OBJECT') {
      const shape: Record<string, z.ZodType> = {};
      for (const field of namedType.inputFields) {
        shape[field.name] = typeReferenceToZod(field.type, schema);
      }
      return withGraphQLNullability(z.object(shape), isNullable);
    }
  }

  switch (typeName) {
    case 'String':
    case 'ID': {
      return withGraphQLNullability(z.string(), isNullable);
    }
    case 'Int': {
      return withGraphQLNullability(z.number().int(), isNullable);
    }
    case 'Float': {
      return withGraphQLNullability(z.number(), isNullable);
    }
    case 'Boolean': {
      return withGraphQLNullability(z.boolean(), isNullable);
    }
    default: {
      return withGraphQLNullability(z.unknown(), isNullable);
    }
  }
};
