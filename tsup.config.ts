import { defineConfig } from 'tsup';
import package_ from './package.json';

export default defineConfig({
  clean: true,
  define: {
    'process.env.PACKAGE_VERSION': JSON.stringify(package_.version),
  },
  dts: true,
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  shims: true,
  sourcemap: true,
  splitting: false,
  target: 'node18',
});
