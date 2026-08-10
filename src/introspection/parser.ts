import type { IntrospectionQuery } from 'graphql';
import type {
  ParsedSchema,
  SchemaType,
  SchemaField,
  SchemaArgument,
  TypeReference,
} from '../types/index.js';

const convertTypeReference = (introspectionType: {
  kind: string;
  name?: string | null;
  ofType?: unknown;
}): TypeReference => ({
  kind: introspectionType.kind as TypeReference['kind'],
  name: introspectionType.name ?? null,
  ofType: introspectionType.ofType
    ? convertTypeReference(
        introspectionType.ofType as { kind: string; name?: string | null; ofType?: unknown },
      )
    : null,
});

const convertArgument = (argument: {
  name: string;
  description?: string | null;
  type: { kind: string; name?: string | null; ofType?: unknown };
  defaultValue?: string | null;
}): SchemaArgument => ({
  defaultValue: argument.defaultValue ?? null,
  description: argument.description ?? null,
  name: argument.name,
  type: convertTypeReference(argument.type),
});

const convertField = (field: {
  name: string;
  description?: string | null;
  type: { kind: string; name?: string | null; ofType?: unknown };
  args?: readonly {
    name: string;
    description?: string | null;
    type: { kind: string; name?: string | null; ofType?: unknown };
    defaultValue?: string | null;
  }[];
  isDeprecated?: boolean;
}): SchemaField => ({
  args: (field.args ?? []).map(convertArgument),
  description: field.description ?? null,
  isDeprecated: field.isDeprecated ?? false,
  name: field.name,
  type: convertTypeReference(field.type),
});

export const parseSchema = (introspectionResult: IntrospectionQuery): ParsedSchema => {
  const schema = introspectionResult.__schema;

  const types = new Map<string, SchemaType>();

  for (const type of schema.types) {
    // Filter out built-in types (prefixed with __)
    if (type.name.startsWith('__')) {
      continue;
    }

    const schemaType: SchemaType = {
      description: type.description ?? null,
      enumValues:
        'enumValues' in type && type.enumValues
          ? type.enumValues.map((v: { name: string; description?: string | null }) => ({
              description: v.description ?? null,
              name: v.name,
            }))
          : [],
      fields: 'fields' in type && type.fields ? type.fields.map(convertField) : [],
      inputFields:
        'inputFields' in type && type.inputFields
          ? (
              type.inputFields as {
                name: string;
                description?: string | null;
                type: { kind: string; name?: string | null; ofType?: unknown };
                defaultValue?: string | null;
              }[]
            ).map(convertArgument)
          : [],
      interfaces:
        'interfaces' in type && type.interfaces
          ? type.interfaces.map((index: { name: string }) => index.name)
          : [],
      kind: type.kind as TypeReference['kind'],
      name: type.name,
      possibleTypes:
        'possibleTypes' in type && type.possibleTypes
          ? type.possibleTypes.map((t: { name: string }) => t.name)
          : [],
    };

    types.set(type.name, schemaType);
  }

  return {
    mutationType: schema.mutationType?.name ?? null,
    queryType: schema.queryType.name,
    subscriptionType: schema.subscriptionType?.name ?? null,
    types,
  };
};
