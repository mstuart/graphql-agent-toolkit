import type { IntrospectionQuery } from 'graphql';
import type { ParsedSchema, SchemaType, SchemaField, SchemaArgument, TypeRef } from '../types/index.js';

function convertTypeRef(introspectionType: {
  kind: string;
  name?: string | null;
  ofType?: unknown;
}): TypeRef {
  return {
    kind: introspectionType.kind as TypeRef['kind'],
    name: introspectionType.name ?? null,
    ofType: introspectionType.ofType
      ? convertTypeRef(
          introspectionType.ofType as { kind: string; name?: string | null; ofType?: unknown },
        )
      : null,
  };
}

function convertArgument(arg: {
  name: string;
  description?: string | null;
  type: { kind: string; name?: string | null; ofType?: unknown };
  defaultValue?: string | null;
}): SchemaArgument {
  return {
    name: arg.name,
    description: arg.description ?? null,
    type: convertTypeRef(arg.type),
    defaultValue: arg.defaultValue ?? null,
  };
}

function convertField(field: {
  name: string;
  description?: string | null;
  type: { kind: string; name?: string | null; ofType?: unknown };
  args?: Array<{
    name: string;
    description?: string | null;
    type: { kind: string; name?: string | null; ofType?: unknown };
    defaultValue?: string | null;
  }>;
  isDeprecated?: boolean;
}): SchemaField {
  return {
    name: field.name,
    description: field.description ?? null,
    type: convertTypeRef(field.type),
    args: (field.args ?? []).map(convertArgument),
    isDeprecated: field.isDeprecated ?? false,
  };
}

export function parseSchema(introspectionResult: IntrospectionQuery): ParsedSchema {
  const schema = introspectionResult.__schema;

  const types = new Map<string, SchemaType>();

  for (const type of schema.types) {
    // Filter out built-in types (prefixed with __)
    if (type.name.startsWith('__')) {
      continue;
    }

    const schemaType: SchemaType = {
      name: type.name,
      kind: type.kind as TypeRef['kind'],
      description: type.description ?? null,
      fields: ('fields' in type && type.fields ? type.fields.map(convertField) : []),
      inputFields: (
        'inputFields' in type && type.inputFields
          ? (type.inputFields as Array<{
              name: string;
              description?: string | null;
              type: { kind: string; name?: string | null; ofType?: unknown };
              defaultValue?: string | null;
            }>).map(convertArgument)
          : []
      ),
      enumValues: (
        'enumValues' in type && type.enumValues
          ? type.enumValues.map((v: { name: string; description?: string | null }) => ({
              name: v.name,
              description: v.description ?? null,
            }))
          : []
      ),
      interfaces: (
        'interfaces' in type && type.interfaces
          ? type.interfaces.map((i: { name: string }) => i.name)
          : []
      ),
      possibleTypes: (
        'possibleTypes' in type && type.possibleTypes
          ? type.possibleTypes.map((t: { name: string }) => t.name)
          : []
      ),
    };

    types.set(type.name, schemaType);
  }

  return {
    queryType: schema.queryType.name,
    mutationType: schema.mutationType?.name ?? null,
    subscriptionType: schema.subscriptionType?.name ?? null,
    types,
  };
}
