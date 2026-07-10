/**
 * Root entrypoint — mirrors packages/opencode-agent-skills-md/src/index.ts.
 *
 * Re-exports the plugin factory and host types for consumers that import
 * from the package root.
 */
import { SkillsPlugin } from "./plugin";

export { SkillsPlugin };
export { createOpencodeSkillHost } from "./host";
export type { OpencodeClient, OpencodeSkillHost, OpencodeSkillHostClient } from "./host";
export { createSkillTools } from "./tools";
export { resolveSkillOrSuggest } from "./tools";
export { runBoundSkillScript, SKILL_SCRIPT_TIMEOUT_MS } from "./tools";
export { _escapeXml, _escapeShellArg } from "./tools";
export { applySystemTransform, applyToolDefinition, isPreferenceLayerEnabled, PREFERENCE_TOOL_IDS, NATIVE_TOOL_PREFERENCE_NOTE } from "./preference-hooks";
export type { SkillTools } from "./tools";

export { matchSkillsByKeyword, formatMatchedSkillsInjection } from "./plugin";
export { touchSessionState, evictSessionState, deleteSessionState, MAX_TRACKED_SESSIONS, SESSION_TTL_MS } from "./plugin";
export type { SessionState } from "./plugin";

export { createMatcher } from "./embeddings";
export type { Matcher } from "./embeddings";

export default SkillsPlugin;
