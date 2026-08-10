import { isNativeError } from 'node:util/types';
import { getIntrospectionQuery } from 'graphql';
import { GraphQLClient } from 'graphql-request';
import type { IntrospectionQuery } from 'graphql';

export interface FetchSchemaOptions {
  endpoint: string;
  headers?: Record<string, string>;
}

export const fetchSchema = async (options: FetchSchemaOptions): Promise<IntrospectionQuery> => {
  const client = new GraphQLClient(options.endpoint, {
    headers: options.headers,
  });

  const query = getIntrospectionQuery();

  try {
    return await client.request<IntrospectionQuery>(query);
  } catch (error) {
    if (isNativeError(error)) {
      throw new TypeError(`Failed to fetch schema from ${options.endpoint}: ${error.message}`, {
        cause: error,
      });
    }
    throw new Error(`Failed to fetch schema from ${options.endpoint}: Unknown error`, {
      cause: error,
    });
  }
};
