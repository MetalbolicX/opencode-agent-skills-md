import { defineConfig } from 'rolldown';
import typescript from '@rollup/plugin-typescript';

/**
 * Multi-entry build: emits `dist/opencode/index.js` (the host adapter +
 * default-export plugin factory) and `dist/core/index.js` (the portable
 * core engine). Subpath resolution is declared in `package.json#exports`.
 *
 * The previous single-entry build emitted `dist/plugin.mjs`, kept here as
 * an alias entry so the legacy import path keeps resolving for any
 * downstream consumer (and the existing e2e test) that still targets it.
 */
export default defineConfig({
  input: {
    opencode: 'src/opencode/index.ts',
    core: 'src/core/index.ts',
    'plugin.shim': 'src/opencode/index.ts',
  },
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: (chunkInfo) => {
      // Legacy shim re-exported at the same dist path consumers know.
      if (chunkInfo.name === 'plugin.shim') {
        return 'plugin.mjs';
      }
      return '[name]/index.js';
    },
    chunkFileNames: '_chunks/[name]-[hash].js',
  },
  plugins: [typescript()],
  external: ['@opencode-ai/plugin', 'node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:crypto', 'yaml', 'zod'],
});
