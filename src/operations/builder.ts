import { typeReferenceToString, isRequired, unwrapType } from './variables.js';
import type { ParsedSchema, SchemaField } from '../types/index.js';

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
  operationType?: 'query' | 'mutation';
  includeDeprecated?: boolean;
}

const SCALAR_KINDS = new Set(['SCALAR', 'ENUM']);

const isScalarLike = (schema: ParsedSchema, field: SchemaField): boolean => {
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
};

interface SelectionContext {
  currentDepth: number;
  indentLevel: number;
  isDeprecatedIncluded: boolean;
  maxDepth: number;
  schema: ParsedSchema;
  visited: Set<string>;
}

const buildSelectionSet = (typeName: string, context: SelectionContext): string => {
  const { currentDepth, indentLevel, isDeprecatedIncluded, maxDepth, schema, visited } = context;
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
      .filter((field) => !field.isDeprecated || isDeprecatedIncluded)
      .filter((field) =>
        field.args.every(
          (argument) => !isRequired(argument.type) || argument.defaultValue !== null,
        ),
      )
      .filter((f) => isScalarLike(schema, f));

    if (scalarFields.length === 0) {
      return '';
    }

    const scalarLines = scalarFields.map((field) => `${fieldIndent}${field.name}`).join('\n');
    return `{\n${scalarLines}\n${closingIndent}}`;
  }

  visited.add(typeName);

  const fields = type.fields
    .filter((field) => !field.isDeprecated || isDeprecatedIncluded)
    .filter((field) =>
      field.args.every((argument) => !isRequired(argument.type) || argument.defaultValue !== null),
    );
  const lines: string[] = [];

  for (const field of fields) {
    const unwrapped = unwrapType(field.type);

    if (isScalarLike(schema, field)) {
      lines.push(`${fieldIndent}${field.name}`);
    } else if (unwrapped.name) {
      const nestedSelection = buildSelectionSet(unwrapped.name, {
        ...context,
        currentDepth: currentDepth + 1,
        indentLevel: indentLevel + 1,
        visited: new Set(visited),
      });
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
};

const capitalize = (input: string): string => input.charAt(0).toUpperCase() + input.slice(1);

const resolveRootField = (
  schema: ParsedSchema,
  name: string,
  preferredType?: 'query' | 'mutation',
): { rootField: SchemaField; operationType: 'query' | 'mutation' } => {
  const operationTypes: ('query' | 'mutation')[] = preferredType
    ? [preferredType]
    : ['query', 'mutation'];
  for (const operationType of operationTypes) {
    const rootName = operationType === 'query' ? schema.queryType : schema.mutationType;
    const rootField = rootName
      ? schema.types.get(rootName)?.fields.find((field) => field.name === name)
      : undefined;
    if (rootField) {
      return { operationType, rootField };
    }
  }
  throw new Error(`Field "${name}" not found in schema query or mutation types`);
};

export const buildOperation = (
  schema: ParsedSchema,
  rootFieldName: string,
  options?: BuildOperationOptions,
): GeneratedOperation => {
  const maxDepth = options?.maxDepth ?? 2;
  const isDeprecatedIncluded = options?.includeDeprecated ?? false;

  const { rootField, operationType } = resolveRootField(
    schema,
    rootFieldName,
    options?.operationType,
  );

  const operationName = `${capitalize(rootFieldName)}${capitalize(operationType)}`;

  // Build variable definitions from arguments
  const variables: VariableDefinition[] = rootField.args.map((argument) => ({
    description: argument.description,
    name: argument.name,
    required: isRequired(argument.type) && argument.defaultValue === null,
    type: typeReferenceToString(argument.type),
  }));

  // Build the variable definitions string for the operation
  const variableDefinitions = variables
    .map((variable, index) => {
      const defaultValue = rootField.args[index]?.defaultValue;
      const suffix = typeof defaultValue === 'string' ? ` = ${defaultValue}` : '';
      return `$${variable.name}: ${variable.type}${suffix}`;
    })
    .join(', ');
  const variableDefs = variables.length > 0 ? `(${variableDefinitions})` : '';

  // Build argument passing string
  const argumentAssignments = rootField.args
    .map((argument) => `${argument.name}: $${argument.name}`)
    .join(', ');
  const argumentsPassing = rootField.args.length > 0 ? `(${argumentAssignments})` : '';

  // Build selection set based on return type
  const unwrapped = unwrapType(rootField.type);
  const nestedSelection =
    !isScalarLike(schema, rootField) && unwrapped.name
      ? buildSelectionSet(unwrapped.name, {
          currentDepth: 0,
          indentLevel: 1,
          isDeprecatedIncluded,
          maxDepth,
          schema,
          visited: new Set(),
        })
      : '';
  const selectionSet = isScalarLike(schema, rootField)
    ? ''
    : ` ${nestedSelection || '{ __typename }'}`;

  const operation = `${operationType} ${operationName}${variableDefs} {\n  ${rootFieldName}${argumentsPassing}${selectionSet}\n}`;

  return {
    operation,
    operationName,
    operationType,
    variables,
  };
};
