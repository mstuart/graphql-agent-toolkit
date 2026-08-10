export interface SchemaField {
  name: string;
  description: string | null;
  type: TypeReference;
  args: SchemaArgument[];
  isDeprecated: boolean;
}

export interface SchemaArgument {
  name: string;
  description: string | null;
  type: TypeReference;
  defaultValue: string | null;
}

export interface TypeReference {
  // GraphQL introspection defines this closed set of type kinds.
  // eslint-disable-next-line sonarjs/max-union-size
  kind: 'SCALAR' | 'OBJECT' | 'INTERFACE' | 'UNION' | 'ENUM' | 'INPUT_OBJECT' | 'LIST' | 'NON_NULL';
  name: string | null;
  ofType: TypeReference | null;
}

// Preserve the original public type name for existing consumers.
// eslint-disable-next-line unicorn/name-replacements
export type TypeRef = TypeReference;

export interface SchemaType {
  name: string;
  kind: TypeReference['kind'];
  description: string | null;
  fields: SchemaField[];
  inputFields: SchemaArgument[];
  enumValues: { name: string; description: string | null }[];
  interfaces: string[];
  possibleTypes: string[];
}

export interface ParsedSchema {
  queryType: string;
  mutationType: string | null;
  subscriptionType: string | null;
  types: Map<string, SchemaType>;
}

export interface AgentToolkitConfig {
  endpoint: string;
  headers?: Record<string, string>;
  operationDepth?: number;
  includeDeprecated?: boolean;
}
