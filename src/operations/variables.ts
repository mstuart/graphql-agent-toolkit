import type { TypeReference } from '../types/index.js';

/**
 * Converts a TypeRef to a GraphQL type string.
 * e.g. NON_NULL(LIST(NON_NULL(OBJECT("User")))) → "[User!]!"
 */
export const typeReferenceToString = (typeReference: TypeReference): string => {
  if (typeReference.kind === 'NON_NULL') {
    if (!typeReference.ofType) {
      return 'Unknown!';
    }
    return `${typeReferenceToString(typeReference.ofType)}!`;
  }

  if (typeReference.kind === 'LIST') {
    if (!typeReference.ofType) {
      return '[Unknown]';
    }
    return `[${typeReferenceToString(typeReference.ofType)}]`;
  }

  return typeReference.name ?? 'Unknown';
};

export { typeReferenceToString as typeRefToString };

/**
 * Checks if a TypeRef is required (NON_NULL at top level).
 */
export const isRequired = (typeReference: TypeReference): boolean =>
  typeReference.kind === 'NON_NULL';

/**
 * Unwraps a TypeRef to get the underlying named type.
 */
export const unwrapType = (typeReference: TypeReference): TypeReference => {
  if (
    (typeReference.kind === 'NON_NULL' || typeReference.kind === 'LIST') &&
    typeReference.ofType
  ) {
    return unwrapType(typeReference.ofType);
  }
  return typeReference;
};
