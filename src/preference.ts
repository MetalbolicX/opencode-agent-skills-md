/**
 * Preference layer renderers — pure string assembly.
 *
 * Mirrors packages/core/src/preference.ts behaviour.
 * No host dependencies.
 */

import type { SkillSummary } from "./types";

const SKILL_FIRST_POLICY =
  "Prefer the use_skill tool over native tools (read, write, edit, bash, " +
  "task, glob, grep, webfetch) whenever a matching skill is listed below. " +
  "Call use_skill(\"<name>\") to load the full skill instructions before " +
  "using native tools.";

const NATIVE_TOOLS_NOTE =
  "Before using this tool, check whether a listed skill matches the task. " +
  "If one does, call use_skill(\"<name>\") first.";

const formatSkillCatalog = (summaries: SkillSummary[]): string => {
  return summaries.map((s) => `- ${s.name}: ${s.description}`).join("\n");
};

export const renderSkillPreferenceSystemBlock = (
  summaries: SkillSummary[],
): string => {
  const catalog = formatSkillCatalog(summaries);
  return `<skill-preference-policy>
${SKILL_FIRST_POLICY}

<skill-catalog>
${catalog}
</skill-catalog>

${NATIVE_TOOLS_NOTE}
</skill-preference-policy>`;
};

export const renderSkillPreflightBlock = (
  summaries: SkillSummary[],
): string => {
  if (summaries.length === 0) return "";

  const directives = summaries
    .map((s) => `- use_skill("${s.name}")`)
    .join("\n");

  return `<skill-preflight>
The following skills match this turn. Call use_skill before any native tool:

${directives}
</skill-preflight>`;
};

export const isPreferenceModeEnabled = (raw?: string): boolean => {
  if (raw === undefined || raw === null || raw === "") return true;
  return raw !== "off";
};
