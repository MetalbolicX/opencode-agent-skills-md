/**
 * Preference-layer hooks for the OpenCode SDK.
 *
 * Implements the two SDK hook handlers that back Layers 1 and 2 of the
 * skill-preference layer:
 *
 *   1. `applySystemTransform(skills, output)` — appends the
 *      `<skill-preference-policy>...</skill-preference-policy>` block
 *      (rendered by core's `renderSkillPreferenceSystemBlock`) to
 *      `output.system` for the `experimental.chat.system.transform`
 *      hook. Append-only / non-destructive: we never mutate existing
 *      entries, only push.
 *
 *   2. `applyToolDefinition(input, output)` — appends a one-sentence
 *      skill-first note to `output.description` when the incoming
 *      `toolID` is in `PREFERENCE_TOOL_IDS`. Tools outside the set
 *      pass through untouched (no parameter mutation, no description
 *      change). Per the SDK contract the hook is non-canceling, so we
 *      can only enrich — never replace — the existing description.
 *
 * Gating is the caller's responsibility: every entry point reads
 * `isPreferenceModeEnabled(process.env.OPENCODE_AGENT_SKILLS_PREFERENCE_MODE)`
 * before invoking these helpers so the OPENCODE_AGENT_SKILLS_PREFERENCE_MODE
 * env var cleanly disables the entire preference layer at runtime.
 */

import {
  isPreferenceModeEnabled,
  renderSkillPreferenceSystemBlock,
  type SkillSummary,
} from "opencode-agent-skills-md-core";
import type {
  SystemTransformOutput,
  ToolDefinitionInput,
  ToolDefinitionOutput,
} from "./sdk";

/**
 * Native OpenCode tool IDs the preference layer annotates with a
 * skill-first note. These are the same IDs the system-prompt policy
 * names as overridable by `use_skill`, so the runtime message stays
 * consistent with the catalog.
 *
 * Membership is the gate: tools outside this set pass through the
 * `tool.definition` hook untouched. Per the design's "minimal blast
 * radius" decision, we intentionally do not annotate every tool.
 */
export const PREFERENCE_TOOL_IDS: ReadonlySet<string> = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "task",
  "glob",
  "grep",
  "webfetch",
]);

/**
 * The one-sentence note appended to a native tool's description when
 * the tool's ID is in `PREFERENCE_TOOL_IDS`. Kept short so the model
 * sees the reminder without paying a meaningful per-tool token cost.
 */
export const NATIVE_TOOL_PREFERENCE_NOTE =
  " Before using this tool, check whether a listed skill matches the task; " +
  "if one does, call use_skill(\"<name>\") first.";

/**
 * Append the `<skill-preference-policy>...</skill-preference-policy>`
 * block to `output.system` for the next chat turn.
 *
 * Behavior:
 *   - Empty `summaries` still produces a valid block (the spec
 *     "empty catalog is allowed" scenario), and we still push it so
 *     the policy line — which biases the model toward `use_skill` —
 *     is always present when the layer is enabled.
 *   - Append-only: existing entries in `output.system` are preserved.
 *
 * Returns `true` when the block was pushed, `false` when the
 * preference layer is disabled (caller can short-circuit logging or
 * additional wiring off the return value).
 */
export const applySystemTransform = (
  summaries: SkillSummary[],
  output: SystemTransformOutput,
): boolean => {
  if (!isPreferenceModeEnabled(process.env.OPENCODE_AGENT_SKILLS_PREFERENCE_MODE)) {
    return false;
  }
  if (!Array.isArray(output.system)) {
    // Defensive: the SDK's payload is untyped at runtime. If `system`
    // is missing or not an array, fall back to an empty push target so
    // we never silently break the host.
    (output as { system: string[] }).system = [];
  }
  output.system.push(renderSkillPreferenceSystemBlock(summaries));
  return true;
};

/**
 * Append the skill-first note to `output.description` when the
 * incoming `toolID` is in `PREFERENCE_TOOL_IDS` and the preference
 * layer is enabled. Tools outside the set pass through with no
 * mutation, matching the spec's "non-target tools stay unchanged"
 * scenario.
 *
 * `parameters` is preserved verbatim — the hook is description-only.
 *
 * Returns `true` when the description was annotated, `false` when
 * the tool is outside the set or the preference layer is disabled.
 */
export const applyToolDefinition = (
  input: ToolDefinitionInput,
  output: ToolDefinitionOutput,
): boolean => {
  if (!isPreferenceModeEnabled(process.env.OPENCODE_AGENT_SKILLS_PREFERENCE_MODE)) {
    return false;
  }
  if (typeof input?.toolID !== "string") {
    return false;
  }
  if (!PREFERENCE_TOOL_IDS.has(input.toolID)) {
    return false;
  }
  if (typeof output?.description !== "string") {
    (output as { description: string }).description = "";
  }
  output.description = output.description + NATIVE_TOOL_PREFERENCE_NOTE;
  return true;
};

/**
 * Read the env-var flag directly, re-exported for callers that want
 * to gate their own preference-layer behavior on the same flag without
 * reaching into `process.env` themselves.
 */
export const isPreferenceLayerEnabled = (): boolean => {
  return isPreferenceModeEnabled(process.env.OPENCODE_AGENT_SKILLS_PREFERENCE_MODE);
};