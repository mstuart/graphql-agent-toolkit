import { describe, it, expect } from 'vitest';

describe('graphql-agent-toolkit', () => {
  it('should export types without error', async () => {
    const mod = await import('../src/index.js');
    expect(mod).toBeDefined();
  });
});
