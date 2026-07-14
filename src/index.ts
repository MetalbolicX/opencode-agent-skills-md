/**
 * Root entrypoint — mirrors packages/opencode-agent-skills-md/src/index.ts.
 *
 * Re-exports the plugin factory and host types for consumers that import
 * from the package root.
 */
import { SkillsPlugin } from "./plugin";

export { SkillsPlugin };

// tools/ — skill tool factories
export { createSkillTools } from "./tools/index";
export { runBoundSkillScript, SKILL_SCRIPT_TIMEOUT_MS } from "./tools/index";
export { _escapeXml, _escapeShellArg } from "./tools/index";
export type { SkillTools } from "./tools/index";

// Preference layer hooks
export { applySystemTransform, applyToolDefinition, isPreferenceLayerEnabled, PREFERENCE_TOOL_IDS, NATIVE_TOOL_PREFERENCE_NOTE } from "./preference-hooks";

// Plugin helpers (keyword matching, session state)
export { matchSkillsByKeyword } from "./match";
export { formatMatchedSkillsInjection } from "./preference";
export { touchSessionState, evictSessionState, deleteSessionState, MAX_TRACKED_SESSIONS, SESSION_TTL_MS } from "./plugin";
export type { SessionState } from "./plugin";

// Embeddings matcher
export { createMatcher } from "./embeddings";
export type { Matcher } from "./embeddings";

export default SkillsPlugin;
