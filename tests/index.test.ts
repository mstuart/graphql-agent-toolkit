import { describe, it, expect } from 'vitest';

describe('graphql-agent-toolkit', () => {
  it('should export types without error', async () => {
    const exportedModule = await import(/* webpackChunkName: "package-index" */ '../src/index.js');
    expect(exportedModule).toBeDefined();
  });
});
