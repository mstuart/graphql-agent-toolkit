import typescript from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import config from 'ultracite/eslint/core';

export default [
  ...config,
  {
    ignores: ['**/*.json'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parserOptions: { project: false } },
    rules: {
      ...typescript.configs['flat/disable-type-checked'].rules,
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['tests/cli/init.test.ts', 'tests/index.test.ts', 'tests/mcp/server.test.ts'],
    rules: {
      // Webpack requires inline magic comments to assign stable async chunk names.
      'no-inline-comments': 'off',
    },
  },
];
