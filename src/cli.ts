#!/usr/bin/env node

import { Command } from 'commander';
import { runInit } from './cli/init.js';
import { runServe } from './cli/serve.js';

const version = process.env.PACKAGE_VERSION || '0.1.0';

const program = new Command();

program
  .name('graphql-agent-toolkit')
  .description('Turn any GraphQL API into AI-agent-ready tools')
  .version(version);

program
  .command('init')
  .description('Introspect a GraphQL endpoint and generate a config file')
  .requiredOption('--endpoint <url>', 'GraphQL endpoint URL')
  .option('--header <headers...>', 'HTTP headers in "Key: Value" format')
  .option('--output <file>', 'Output file path for the config')
  .action(async (options) => {
    try {
      await runInit(options);
    } catch {
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start an MCP server for a GraphQL endpoint')
  .option('--config <file>', 'Path to config JSON file')
  .option('--endpoint <url>', 'GraphQL endpoint URL (alternative to --config)')
  .option('--header <headers...>', 'HTTP headers in "Key: Value" format')
  .action(async (options) => {
    await runServe(options);
  });

program.parse();
