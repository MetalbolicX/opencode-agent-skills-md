import { defineConfig } from 'rolldown';
import typescript from '@rollup/plugin-typescript';

export default defineConfig({
  input: 'src/plugin.ts',
  output: {
    file: 'dist/plugin.js',
    format: 'esm',
  },
  plugins: [typescript()],
  external: ['@opencode-ai/plugin', 'node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:crypto', 'yaml', 'zod'],
});
