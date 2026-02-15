import { getIntrospectionQuery, type IntrospectionQuery } from 'graphql';
import { GraphQLClient } from 'graphql-request';

export interface FetchSchemaOptions {
  endpoint: string;
  headers?: Record<string, string>;
}

export async function fetchSchema(options: FetchSchemaOptions): Promise<IntrospectionQuery> {
  const client = new GraphQLClient(options.endpoint, {
    headers: options.headers,
  });

  const query = getIntrospectionQuery();

  try {
    const result = await client.request<IntrospectionQuery>(query);
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch schema from ${options.endpoint}: ${error.message}`);
    }
    throw new Error(`Failed to fetch schema from ${options.endpoint}: Unknown error`);
  }
}
