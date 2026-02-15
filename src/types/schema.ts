export interface SchemaField {
  name: string;
  description: string | null;
  type: TypeRef;
  args: SchemaArgument[];
  isDeprecated: boolean;
}

export interface SchemaArgument {
  name: string;
  description: string | null;
  type: TypeRef;
  defaultValue: string | null;
}

export interface TypeRef {
  kind:
    | 'SCALAR'
    | 'OBJECT'
    | 'INTERFACE'
    | 'UNION'
    | 'ENUM'
    | 'INPUT_OBJECT'
    | 'LIST'
    | 'NON_NULL';
  name: string | null;
  ofType: TypeRef | null;
}

export interface SchemaType {
  name: string;
  kind: TypeRef['kind'];
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
