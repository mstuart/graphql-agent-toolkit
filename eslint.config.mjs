import typescript from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import core from 'ultracite/eslint/core';

export default [
  ...core,
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
];
