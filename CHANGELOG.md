# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-15

### Added
- Schema introspection and parsing via `fetchSchema` and `parseSchema`
- Operation builder with configurable depth via `buildOperation`
- MCP server generation with `createAgentToolkitServer` and `createToolsFromSchema`
- GraphQL executor for running operations against endpoints
- TF-IDF semantic schema search via `SchemaNavigator`
- Relay and offset pagination handling via `executePaginated`
- Response summarization for LLM context windows via `summarizeResponse` and `formatForLLM`
- Framework adapters: LangChain, CrewAI, and Vercel AI SDK
- Mock data generation with `@mock()` directive support
- CLI commands: `init` and `serve`
- Dual ESM/CJS output with full TypeScript declarations
