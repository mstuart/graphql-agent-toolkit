import { writeFileSync } from 'node:fs';
import { isNativeError } from 'node:util/types';
import { fetchSchema } from '../introspection/fetcher.js';
import { parseSchema } from '../introspection/parser.js';
import type { AgentToolkitConfig } from '../types/index.js';

export interface InitOptions {
  endpoint: string;
  header?: string[];
  output?: string;
}

const parseHeaders = (headerArguments?: string[]): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (!headerArguments) {
    return headers;
  }

  for (const h of headerArguments) {
    const colonIndex = h.indexOf(':');
    if (colonIndex === -1) {
      console.warn(`Warning: Invalid header format "${h}". Expected "Key: Value".`);
      continue;
    }
    const key = h.slice(0, colonIndex).trim();
    const value = h.slice(colonIndex + 1).trim();
    headers[key] = value;
  }

  return headers;
};

const initialize = async (options: InitOptions): Promise<AgentToolkitConfig> => {
  const headers = parseHeaders(options.header);

  console.log(`Introspecting GraphQL endpoint: ${options.endpoint}...`);

  const introspectionResult = await fetchSchema({
    endpoint: options.endpoint,
    headers,
  });

  const schema = parseSchema(introspectionResult);

  const queryType = schema.types.get(schema.queryType);
  const mutationType = schema.mutationType ? schema.types.get(schema.mutationType) : null;

  const queryCount = queryType?.fields.length ?? 0;
  const mutationCount = mutationType?.fields.length ?? 0;
  const typeCount = schema.types
    .values()
    .filter((type) => type.kind !== 'SCALAR')
    .toArray().length;

  console.log(`\nSchema Summary:`);
  console.log(`  Types: ${typeCount}`);
  console.log(`  Queries: ${queryCount}`);
  console.log(`  Mutations: ${mutationCount}`);

  const config: AgentToolkitConfig = {
    endpoint: options.endpoint,
    ...(Object.keys(headers).length > 0 && { headers }),
    includeDeprecated: false,
    operationDepth: 2,
  };

  if (options.output) {
    writeFileSync(options.output, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`\nConfig written to: ${options.output}`);
  } else {
    console.log(`\nConfig:`);
    console.log(JSON.stringify(config, null, 2));
  }

  return config;
};

export const runInit = async (options: InitOptions): Promise<AgentToolkitConfig> => {
  try {
    return await initialize(options);
  } catch (error) {
    const message = isNativeError(error) ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    throw error;
  }
};
