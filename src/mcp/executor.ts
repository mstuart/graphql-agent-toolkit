import { GraphQLClient } from 'graphql-request';

export class GraphQLExecutor {
  private client: GraphQLClient;

  constructor(endpoint: string, headers?: Record<string, string>) {
    this.client = new GraphQLClient(endpoint, { headers });
  }

  async execute(
    operation: string,
    variables?: Record<string, unknown>,
    additionalHeaders?: Record<string, string>,
  ): Promise<string> {
    try {
      const result = await this.client.request(operation, variables, additionalHeaders);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`GraphQL execution failed: ${error.message}`);
      }
      throw new Error('GraphQL execution failed: Unknown error');
    }
  }
}
