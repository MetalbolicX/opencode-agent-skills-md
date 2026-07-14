/**
 * Preference-layer hooks for the OpenCode SDK.
 *
 * Mirrors packages/opencode-agent-skills-md/src/preference-hooks.ts behaviour.
 *
 * Implements the two SDK hook handlers that back Layers 1 and 2:
 *   1. `applySystemTransform` — appends `<skill-preference-policy>` to output.system
 *   2. `applyToolDefinition` — appends skill-first note to native tool descriptions
 */

import {
  isPreferenceModeEnabled,
  renderSkillPreferenceSystemBlock,
} from "./preference";
import type { SkillSummary } from "./types";

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

export const NATIVE_TOOL_PREFERENCE_NOTE =
  " Before using this tool, check whether a listed skill matches the task; " +
  "if one does, call use_skill(\"<name>\") first.";

interface SystemTransformOutput {
  system?: string[];
}

interface ToolDefinitionInput {
  toolID?: string;
}

interface ToolDefinitionOutput {
  description?: string;
  parameters?: Record<string, unknown>;
}

export const applySystemTransform = (
  summaries: SkillSummary[],
  output: SystemTransformOutput,
): boolean => {
  if (!isPreferenceModeEnabled(process.env.OPENCODE_AGENT_SKILLS_PREFERENCE_MODE)) {
    return false;
  }
  (output as { system: string[] }).system = output.system ?? [];
  (output as { system: string[] }).system.push(renderSkillPreferenceSystemBlock(summaries));
  return true;
};

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
  // Idempotent: append the preference note at most once per description
  const desc = output.description as string;
  if (desc.includes(NATIVE_TOOL_PREFERENCE_NOTE.trim())) {
    return true;
  }
  output.description = desc + NATIVE_TOOL_PREFERENCE_NOTE;
  return true;
};

export const isPreferenceLayerEnabled = (): boolean => {
  return isPreferenceModeEnabled(process.env.OPENCODE_AGENT_SKILLS_PREFERENCE_MODE);
};
