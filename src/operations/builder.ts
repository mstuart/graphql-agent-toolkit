import type { ParsedSchema, SchemaField, SchemaType } from '../types/index.js';
import { typeRefToString, isRequired, unwrapType } from './variables.js';

export interface VariableDefinition {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface GeneratedOperation {
  operation: string;
  operationName: string;
  variables: VariableDefinition[];
  operationType: 'query' | 'mutation';
}

export interface BuildOperationOptions {
  maxDepth?: number;
  includeDeprecated?: boolean;
}

const SCALAR_KINDS = new Set(['SCALAR', 'ENUM']);

function isScalarLike(schema: ParsedSchema, field: SchemaField): boolean {
  const unwrapped = unwrapType(field.type);
  if (SCALAR_KINDS.has(unwrapped.kind)) {
    return true;
  }
  // Check if the named type exists and is scalar/enum
  if (unwrapped.name) {
    const namedType = schema.types.get(unwrapped.name);
    if (namedType && SCALAR_KINDS.has(namedType.kind)) {
      return true;
    }
  }
  return false;
}

function buildSelectionSet(
  schema: ParsedSchema,
  typeName: string,
  currentDepth: number,
  maxDepth: number,
  visited: Set<string>,
  includeDeprecated: boolean,
  indentLevel: number = 2,
): string {
  if (currentDepth >= maxDepth) {
    return '';
  }

  const type = schema.types.get(typeName);
  if (!type || type.fields.length === 0) {
    return '';
  }

  const fieldIndent = '  '.repeat(indentLevel + 1);
  const closingIndent = '  '.repeat(indentLevel);

  // Prevent infinite recursion
  if (visited.has(typeName)) {
    // Only include scalar fields to break the cycle
    const scalarFields = type.fields
      .filter((f) => !f.isDeprecated || includeDeprecated)
      .filter((f) => isScalarLike(schema, f));

    if (scalarFields.length === 0) {
      return '';
    }

    return `{\n${scalarFields.map((f) => `${fieldIndent}${f.name}`).join('\n')}\n${closingIndent}}`;
  }

  visited.add(typeName);

  const fields = type.fields.filter((f) => !f.isDeprecated || includeDeprecated);
  const lines: string[] = [];

  for (const field of fields) {
    const unwrapped = unwrapType(field.type);

    if (isScalarLike(schema, field)) {
      lines.push(`${fieldIndent}${field.name}`);
    } else if (unwrapped.name) {
      const nestedSelection = buildSelectionSet(
        schema,
        unwrapped.name,
        currentDepth + 1,
        maxDepth,
        new Set(visited),
        includeDeprecated,
        indentLevel + 1,
      );
      if (nestedSelection) {
        lines.push(`${fieldIndent}${field.name} ${nestedSelection}`);
      }
    }
  }

  visited.delete(typeName);

  if (lines.length === 0) {
    return '';
  }

  return `{\n${lines.join('\n')}\n${closingIndent}}`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function buildOperation(
  schema: ParsedSchema,
  rootFieldName: string,
  options?: BuildOperationOptions,
): GeneratedOperation {
  const maxDepth = options?.maxDepth ?? 2;
  const includeDeprecated = options?.includeDeprecated ?? false;

  // Look up the field in query type first, then mutation type
  let operationType: 'query' | 'mutation' = 'query';
  let rootField: SchemaField | undefined;

  const queryType = schema.types.get(schema.queryType);
  if (queryType) {
    rootField = queryType.fields.find((f) => f.name === rootFieldName);
  }

  if (!rootField && schema.mutationType) {
    const mutationType = schema.types.get(schema.mutationType);
    if (mutationType) {
      rootField = mutationType.fields.find((f) => f.name === rootFieldName);
      if (rootField) {
        operationType = 'mutation';
      }
    }
  }

  if (!rootField) {
    throw new Error(`Field "${rootFieldName}" not found in schema query or mutation types`);
  }

  const operationName = `${capitalize(rootFieldName)}${capitalize(operationType)}`;

  // Build variable definitions from arguments
  const variables: VariableDefinition[] = rootField.args.map((arg) => ({
    name: arg.name,
    type: typeRefToString(arg.type),
    required: isRequired(arg.type),
    description: arg.description,
  }));

  // Build the variable definitions string for the operation
  const varDefs = variables.length > 0
    ? `(${variables.map((v) => `$${v.name}: ${v.type}`).join(', ')})`
    : '';

  // Build argument passing string
  const argsPassing = rootField.args.length > 0
    ? `(${rootField.args.map((a) => `${a.name}: $${a.name}`).join(', ')})`
    : '';

  // Build selection set based on return type
  const unwrapped = unwrapType(rootField.type);
  let selectionSet = '';

  if (!isScalarLike(schema, rootField) && unwrapped.name) {
    selectionSet = ` ${buildSelectionSet(
      schema,
      unwrapped.name,
      0,
      maxDepth,
      new Set(),
      includeDeprecated,
      1,
    )}`;
  }

  const operation = `${operationType} ${operationName}${varDefs} {\n  ${rootFieldName}${argsPassing}${selectionSet}\n}`;

  return {
    operation,
    operationName,
    variables,
    operationType,
  };
}
