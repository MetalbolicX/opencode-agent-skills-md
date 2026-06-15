/**
 * OpenCode host adapter — root entrypoint.
 *
 * Re-exports the plugin factory as the package's default export so the
 * `rolldown` build can target this file directly. The root `src/plugin.ts`
 * shim forwards to this module to preserve the legacy import path while
 * `package.json` still resolves `dist/plugin.mjs` to the package main.
 *
 * Public surface:
 *   - default export: SkillsPlugin (the @opencode-ai/plugin Plugin factory)
 *   - named exports: SkillsPlugin, createOpencodeSkillHost
 */

import { SkillsPlugin } from "./plugin";

export { SkillsPlugin };
export { createOpencodeSkillHost } from "./host";
export type {
  OpencodeClient,
  OpencodeSkillHost,
  OpencodeSkillHostClient,
  OpencodeHostFileAccess,
} from "./host";

export default SkillsPlugin;
