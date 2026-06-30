import { defineConfig } from 'rolldown';

/**
 * Plugin package build — emits `dist/opencode/index.js` (the OpenCode host
 * adapter + default-export plugin factory).
 *
 * The core engine (`opencode-agent-skills-md-core`) is consumed as a workspace
 * package dependency, so it is treated as an external — the plugin bundle
 * keeps a runtime import for it instead of inlining the sources.
 */
export default defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/plugin.mjs',
    format: 'esm',
  },
  external: [
    '@opencode-ai/plugin',
    'opencode-agent-skills-md-core',
    'node:fs',
    'node:fs/promises',
    'node:path',
    'node:os',
    'node:crypto',
    'yaml',
  ],
});
