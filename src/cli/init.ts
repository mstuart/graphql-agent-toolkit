import { fetchSchema } from '../introspection/fetcher.js';
import { parseSchema } from '../introspection/parser.js';
import type { AgentToolkitConfig } from '../types/index.js';
import { writeFileSync } from 'node:fs';

export interface InitOptions {
  endpoint: string;
  header?: string[];
  output?: string;
}

function parseHeaders(headerArgs?: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headerArgs) return headers;

  for (const h of headerArgs) {
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) {
      console.warn(`Warning: Invalid header format "${h}". Expected "Key: Value".`);
      continue;
    }
    const key = h.slice(0, colonIdx).trim();
    const value = h.slice(colonIdx + 1).trim();
    headers[key] = value;
  }

  return headers;
}

export async function runInit(options: InitOptions): Promise<AgentToolkitConfig> {
  const headers = parseHeaders(options.header);

  console.log(`Introspecting GraphQL endpoint: ${options.endpoint}...`);

  try {
    const introspectionResult = await fetchSchema({
      endpoint: options.endpoint,
      headers,
    });

    const schema = parseSchema(introspectionResult);

    const queryType = schema.types.get(schema.queryType);
    const mutationType = schema.mutationType ? schema.types.get(schema.mutationType) : null;

    const queryCount = queryType?.fields.length ?? 0;
    const mutationCount = mutationType?.fields.length ?? 0;
    const typeCount = Array.from(schema.types.values()).filter(
      (t) => t.kind !== 'SCALAR',
    ).length;

    console.log(`\nSchema Summary:`);
    console.log(`  Types: ${typeCount}`);
    console.log(`  Queries: ${queryCount}`);
    console.log(`  Mutations: ${mutationCount}`);

    const config: AgentToolkitConfig = {
      endpoint: options.endpoint,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      operationDepth: 2,
      includeDeprecated: false,
    };

    if (options.output) {
      writeFileSync(options.output, JSON.stringify(config, null, 2) + '\n');
      console.log(`\nConfig written to: ${options.output}`);
    } else {
      console.log(`\nConfig:`);
      console.log(JSON.stringify(config, null, 2));
    }

    return config;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    throw error;
  }
}
