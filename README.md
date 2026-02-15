# graphql-agent-toolkit

[![CI](https://github.com/mstuart/graphql-agent-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/mstuart/graphql-agent-toolkit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/graphql-agent-toolkit.svg)](https://www.npmjs.com/package/graphql-agent-toolkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
- **Pagination Handling** -- Auto-detects and handles Relay and offset pagination across multiple pages
- **Result Summarization** -- Truncate large responses for LLM context windows with markdown formatting
- **Framework Adapters** -- Generate tools for LangChain, CrewAI, and Vercel AI SDK with zero framework dependencies
- **Mock Data Generation** -- Generate deterministic mock data from your schema with `@mock()` directive support
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

### Result Summarization

Truncate large GraphQL responses to fit within LLM context windows:

```typescript
import { summarizeResponse, formatForLLM } from 'graphql-agent-toolkit';

// Summarize a large response
const { summary, metadata } = summarizeResponse(largeResponse, {
  maxItems: 5,        // max array items to include
  maxDepth: 3,        // max nesting depth
  maxStringLength: 200, // truncate long strings
  includeMetadata: true, // add _meta with counts
});

console.log(metadata);
// { totalItems: 1500, truncated: true, originalSize: 48230 }

// Format as clean markdown for LLM context
const markdown = formatForLLM(largeResponse, { maxItems: 10 });
console.log(markdown);
```

### Framework Adapters

Generate tools for popular AI frameworks -- no framework dependencies required.

#### LangChain

```typescript
import { createLangChainTools, createStructuredTools } from 'graphql-agent-toolkit';

// Basic tools (input is JSON string)
const tools = createLangChainTools(schema, executor, { maxDepth: 2 });

// Structured tools with Zod schemas (for @langchain/core StructuredTool)
const structuredTools = createStructuredTools(schema, executor);

for (const tool of tools) {
  console.log(`${tool.name}: ${tool.description}`);
  // tool.func(jsonString) -> Promise<string>
}
```

#### CrewAI

```typescript
import { createCrewAITools } from 'graphql-agent-toolkit';

const tools = createCrewAITools(schema, executor);

for (const tool of tools) {
  console.log(`${tool.name}: ${tool.description}`);
  // tool.args_schema is a JSON Schema object
  // tool.func(argsObject) -> Promise<string>
}
```

#### Vercel AI SDK

```typescript
import { createVercelAITools } from 'graphql-agent-toolkit';

const tools = createVercelAITools(schema, executor);

// Returns Record<string, { description, parameters: ZodSchema, execute }>
// Use directly with Vercel AI SDK's tool() function
for (const [name, tool] of Object.entries(tools)) {
  console.log(`${name}: ${tool.description}`);
  // tool.parameters is a Zod schema
  // tool.execute(args) -> Promise<string>
}
```

### Mock Data Generation

Generate deterministic mock data from your schema for testing:

```typescript
import { generateMockData, createMockExecutor } from 'graphql-agent-toolkit';

// Generate mock data for a specific type
const mockUser = generateMockData(schema, 'User', {
  seed: 42,         // deterministic output
  arrayLength: 3,   // items per list field
  maxDepth: 3,      // max recursion depth
});
console.log(mockUser);
// { id: 'id_id_0', name: 'mock_name', posts: [...] }

// Create a drop-in mock executor (no HTTP calls)
const mockExecutor = createMockExecutor(schema, { seed: 42 });

// Use it anywhere a GraphQLExecutor is expected
const result = await mockExecutor.execute(
  'query { user(id: "1") { id name } }',
  { id: '1' }
);
```

Use the `@mock()` directive in field descriptions for custom values:

```graphql
type Product {
  "The product name @mock(\"Widget Pro\")"
  name: String!
  "Current price in USD @mock(29.99)"
  price: Float!
  "Whether the product is in stock @mock(true)"
  inStock: Boolean!
}
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

### Pagination

- `executePaginated(executor, operation, variables, config?)` -- Execute a paginated query, collecting all pages
- `detectPaginationStyle(schema, typeName)` -- Auto-detect Relay or offset pagination from a type

### Summarization

- `summarizeResponse(data, config?)` -- Truncate arrays, limit depth, and shorten strings in a response
- `formatForLLM(data, config?)` -- Format data as clean markdown for LLM context

### Framework Adapters

- `createLangChainTools(schema, executor, options?)` -- Create LangChain-compatible tools (JSON string input)
- `createStructuredTools(schema, executor, options?)` -- Create LangChain StructuredTool-compatible tools (Zod schemas)
- `createCrewAITools(schema, executor, options?)` -- Create CrewAI-compatible tools (dict input, `args_schema`)
- `createVercelAITools(schema, executor, options?)` -- Create Vercel AI SDK-compatible tools (Zod parameters, Record)

### Mock Data

- `generateMockData(schema, typeName, config?)` -- Generate mock data for a given type
- `createMockExecutor(schema, config?)` -- Create a mock executor as drop-in replacement for GraphQLExecutor

### Types

- `AgentToolkitConfig` -- Configuration object
- `ParsedSchema` -- Parsed schema with type map
- `SchemaType` -- Individual type definition
- `SchemaField` -- Field definition with args
- `GeneratedOperation` -- Generated operation with variables
- `SearchResult` -- Semantic search result
- `SummaryConfig` -- Configuration for response summarization
- `PaginationConfig` -- Configuration for paginated queries
- `MockConfig` -- Configuration for mock data generation
- `LangChainToolConfig` -- LangChain tool definition shape
- `CrewAIToolConfig` -- CrewAI tool definition shape
- `VercelAIToolConfig` -- Vercel AI SDK tool definition shape

## Contributing

1. Clone the repository
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Build: `npm run build`
5. Lint: `npm run lint`

## License

MIT
