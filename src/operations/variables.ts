import type { TypeRef } from '../types/index.js';

/**
 * Converts a TypeRef to a GraphQL type string.
 * e.g. NON_NULL(LIST(NON_NULL(OBJECT("User")))) → "[User!]!"
 */
export function typeRefToString(typeRef: TypeRef): string {
  if (typeRef.kind === 'NON_NULL') {
    if (!typeRef.ofType) {
      return 'Unknown!';
    }
    return `${typeRefToString(typeRef.ofType)}!`;
  }

  if (typeRef.kind === 'LIST') {
    if (!typeRef.ofType) {
      return '[Unknown]';
    }
    return `[${typeRefToString(typeRef.ofType)}]`;
  }

  return typeRef.name ?? 'Unknown';
}

/**
 * Checks if a TypeRef is required (NON_NULL at top level).
 */
export function isRequired(typeRef: TypeRef): boolean {
  return typeRef.kind === 'NON_NULL';
}

/**
 * Unwraps a TypeRef to get the underlying named type.
 */
export function unwrapType(typeRef: TypeRef): TypeRef {
  if (typeRef.kind === 'NON_NULL' || typeRef.kind === 'LIST') {
    if (typeRef.ofType) {
      return unwrapType(typeRef.ofType);
    }
  }
  return typeRef;
}
