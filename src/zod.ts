import { z } from 'zod';
import { unwrapType } from './operations/variables.js';
import type { ParsedSchema, SchemaArgument, TypeRef as TypeReference } from './types/index.js';

const withGraphQLNullability = (zodType: z.ZodType, isNullable: boolean): z.ZodType =>
  isNullable ? zodType.nullish() : zodType;

interface ConversionContext {
  inputObjects: Map<string, z.ZodType>;
  isNullable: boolean;
}

const convertTypeReference = (
  typeReference: TypeReference,
  schema: ParsedSchema,
  { inputObjects, isNullable }: ConversionContext,
): z.ZodType => {
  if (typeReference.kind === 'NON_NULL') {
    if (!typeReference.ofType) {
      return z.unknown();
    }
    return convertTypeReference(typeReference.ofType, schema, { inputObjects, isNullable: false });
  }

  if (typeReference.kind === 'LIST') {
    const itemSchema = typeReference.ofType
      ? convertTypeReference(typeReference.ofType, schema, { inputObjects, isNullable: true })
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
      const cached = inputObjects.get(typeName);
      if (cached) {
        return withGraphQLNullability(cached, isNullable);
      }
      // Reuse the same lazy identity so JSON Schema exporters can emit refs.
      const inputObject = z.lazy(() => {
        const shape: Record<string, z.ZodType> = {};
        for (const field of namedType.inputFields) {
          const fieldSchema = convertTypeReference(field.type, schema, {
            inputObjects,
            isNullable: true,
          });
          shape[field.name] = field.defaultValue === null ? fieldSchema : fieldSchema.optional();
        }
        return z.object(shape);
      });
      inputObjects.set(typeName, inputObject);
      return withGraphQLNullability(inputObject, isNullable);
    }
  }

  switch (typeName) {
    case 'String':
    case 'ID': {
      return withGraphQLNullability(z.string(), isNullable);
    }
    case 'Int': {
      return withGraphQLNullability(
        z.number().int().min(-2_147_483_648).max(2_147_483_647),
        isNullable,
      );
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

/**
Preserve GraphQL nullability while sharing recursive input object schemas.
*/
export const typeReferenceToZod = (
  typeReference: TypeReference,
  schema: ParsedSchema,
  isNullable = true,
): z.ZodType =>
  convertTypeReference(typeReference, schema, { inputObjects: new Map(), isNullable });

/**
A non-null argument with a default may be omitted, but may not be null.
*/
export const argumentToZod = (argument: SchemaArgument, schema: ParsedSchema): z.ZodType => {
  const converted = typeReferenceToZod(argument.type, schema);
  return argument.defaultValue === null ? converted : converted.optional();
};
