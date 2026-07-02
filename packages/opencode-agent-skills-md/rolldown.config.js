import { defineConfig } from 'rolldown';

/**
 * Plugin package build — dual entry points:
 *
 *   - `dist/plugin.mjs`   — the OpenCode host adapter + default-export plugin factory.
 *   - `dist/cli.mjs`      — the `oas` CLI entry point (shebang + parseArgs dispatch).
 *
 * The core engine (`opencode-agent-skills-md-core`) is consumed as a workspace
 * package dependency, so it is treated as an external — the plugin bundle
 * keeps a runtime import for it instead of inlining the sources.
 *
 * `node:util` (parseArgs) and `node:url` (pathToFileURL for entry-point
 * detection) are only used by the CLI; the plugin entry doesn't need them,
 * but bundling them as externals for both entries keeps the config simple
 * and matches the proven omr pattern.
 */
const sharedExternal = [
  '@opencode-ai/plugin',
  'opencode-agent-skills-md-core',
  'node:fs',
  'node:fs/promises',
  'node:os',
  'node:path',
  'node:url',
  'node:crypto',
  'node:util',
  'yaml',
];

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/plugin.mjs',
      format: 'esm',
    },
    external: sharedExternal,
  },
  {
    input: 'src/cli/main.ts',
    output: {
      file: 'dist/cli.mjs',
      format: 'esm',
    },
    external: sharedExternal,
  },
]);