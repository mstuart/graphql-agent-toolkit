# graphql-agent-toolkit

Turn any GraphQL API into AI-agent-ready tools -- MCP servers, LangChain tools, and standalone SDKs.

**graphql-agent-toolkit** introspects a GraphQL endpoint, generates typed operations, and exposes them as tools that AI agents can discover and call. It supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) out of the box, so you can connect any MCP-compatible AI client to any GraphQL API in seconds.

## Quick Start

```bash
npx graphql-agent-toolkit init --endpoint https://your-api.com/graphql
```

This introspects your schema and prints a configuration summary. To start an MCP server:

```bash
npx graphql-agent-toolkit serve --endpoint https://your-api.com/graphql
```

## Installation

```bash
npm install graphql-agent-toolkit
```

## Features

- **Schema Introspection** -- Automatically fetches and parses any GraphQL schema
- **Operation Builder** -- Generates queries and mutations with proper variable definitions and nested selection sets
- **MCP Server** -- Creates a fully functional MCP server with tools for every query and mutation
- **Semantic Search** -- TF-IDF powered schema navigator to find relevant types and fields
- **CLI** -- Command-line interface for quick setup and serving
- **Dual Format** -- Ships as both ESM and CJS with full TypeScript types

## Programmatic API

### Introspect and Parse a Schema

```typescript
import { fetchSchema, parseSchema } from 'graphql-agent-toolkit';

const introspection = await fetchSchema({
  endpoint: 'https://your-api.com/graphql',
  headers: { Authorization: 'Bearer YOUR_TOKEN' },
});

const schema = parseSchema(introspection);

console.log(`Query type: ${schema.queryType}`);
console.log(`Types: ${schema.types.size}`);
```

### Build Operations

```typescript
import { fetchSchema, parseSchema, buildOperation } from 'graphql-agent-toolkit';

const introspection = await fetchSchema({ endpoint: 'https://your-api.com/graphql' });
const schema = parseSchema(introspection);

const op = buildOperation(schema, 'user', { maxDepth: 3 });
console.log(op.operation);
// query UserQuery($id: ID!) {
//   user(id: $id) {
//     id
//     name
//     email
//     posts {
//       id
//       title
//     }
//   }
// }
console.log(op.variables);
// [{ name: 'id', type: 'ID!', required: true, description: 'User ID' }]
```

### Create an MCP Server

```typescript
import { createAgentToolkitServer } from 'graphql-agent-toolkit';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = await createAgentToolkitServer({
  endpoint: 'https://your-api.com/graphql',
  headers: { Authorization: 'Bearer YOUR_TOKEN' },
  operationDepth: 2,
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

Each query becomes a `query_<fieldName>` tool, and each mutation becomes a `mutate_<fieldName>` tool. An additional `explore_schema` tool lets the agent browse types and fields.

### Semantic Schema Navigation

```typescript
import { fetchSchema, parseSchema, SchemaNavigator } from 'graphql-agent-toolkit';

const introspection = await fetchSchema({ endpoint: 'https://your-api.com/graphql' });
const schema = parseSchema(introspection);

const navigator = new SchemaNavigator();
navigator.index(schema);

// Search for relevant types
const results = navigator.search('user authentication');
for (const result of results) {
  console.log(`${result.typeName} (${result.kind}) - score: ${result.score.toFixed(3)}`);
}

// Get detailed context for a type
const context = navigator.getTypeContext('User');
console.log(context);
```

## CLI Usage

### `init` -- Introspect and generate config

```bash
graphql-agent-toolkit init \
  --endpoint https://your-api.com/graphql \
  --header "Authorization: Bearer YOUR_TOKEN" \
  --output config.json
```

### `serve` -- Start MCP server

```bash
# From a config file
graphql-agent-toolkit serve --config config.json

# Directly from an endpoint
graphql-agent-toolkit serve --endpoint https://your-api.com/graphql
```

## MCP Server Usage

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "my-graphql-api": {
      "command": "npx",
      "args": [
        "graphql-agent-toolkit",
        "serve",
        "--endpoint",
        "https://your-api.com/graphql"
      ]
    }
  }
}
```

## Configuration

The `AgentToolkitConfig` object accepts:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `endpoint` | `string` | (required) | GraphQL endpoint URL |
| `headers` | `Record<string, string>` | `{}` | HTTP headers for requests |
| `operationDepth` | `number` | `2` | Max depth for generated selection sets |
| `includeDeprecated` | `boolean` | `false` | Include deprecated fields |

## API Reference

### Introspection

- `fetchSchema(options)` -- Fetch introspection query result from a GraphQL endpoint
- `parseSchema(introspection)` -- Parse raw introspection result into a `ParsedSchema`

### Operations

- `buildOperation(schema, fieldName, options?)` -- Generate a GraphQL operation string with variables

### MCP

- `createAgentToolkitServer(config, options?)` -- Create a fully configured MCP server
- `createToolsFromSchema(schema, executor, options?)` -- Create tool definitions from a parsed schema
- `GraphQLExecutor` -- Class for executing GraphQL operations

### Semantic

- `SchemaNavigator` -- Class for indexing and searching a GraphQL schema
  - `.index(schema)` -- Index a parsed schema
  - `.search(query, limit?)` -- Search for relevant types
  - `.getTypeContext(typeName)` -- Get formatted context for a type

### Types

- `AgentToolkitConfig` -- Configuration object
- `ParsedSchema` -- Parsed schema with type map
- `SchemaType` -- Individual type definition
- `SchemaField` -- Field definition with args
- `GeneratedOperation` -- Generated operation with variables
- `SearchResult` -- Semantic search result

## Contributing

1. Clone the repository
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Build: `npm run build`
5. Lint: `npm run lint`

## License

MIT
