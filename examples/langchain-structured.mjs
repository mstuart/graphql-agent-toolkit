import { GraphQLClient } from 'graphql-request';
import { createStructuredTools, fetchSchema, parseSchema } from 'graphql-agent-toolkit';

const endpoint = process.env.GRAPHQL_ENDPOINT;

if (!endpoint) {
  throw new Error('Set GRAPHQL_ENDPOINT before running this example.');
}

const token = process.env.GRAPHQL_AUTH_TOKEN;
const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
const introspection = await fetchSchema({ endpoint, headers });
const schema = parseSchema(introspection);
const client = new GraphQLClient(endpoint, { headers });

const tools = createStructuredTools(schema, {
  execute: async (operation, variables) =>
    JSON.stringify(await client.request(operation, variables)),
});

console.log(tools.map((tool) => tool.name).join('\n'));
