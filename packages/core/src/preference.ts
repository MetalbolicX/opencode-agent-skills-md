/**
 * Preference layer renderers and configuration helper.
 *
 * Pure functions: string assembly only, no host dependencies. These
 * helpers back the four-layer skill-preference layer:
 *
 *   1. `renderSkillPreferenceSystemBlock` builds the system-prompt policy
 *      plus the one-line skill catalog that biases the model toward
 *      `use_skill` before native tools.
 *   2. `renderSkillPreflightBlock` renders the directive block that the
 *      matched-skill preflight injects per turn.
 *   3. `isPreferenceModeEnabled` reads the runtime flag that gates
 *      every layer (`OPENCODE_AGENT_SKILLS_PREFERENCE_MODE`).
 *
 * Host wiring (hook registration, env reads, OpenCode tool ID set) lives
 * in the adapter package; this module stays host-agnostic.
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

/**
 * Format a list of skill summaries as the compact one-line catalog used
 * inside the system-prompt preference block.
 */
const formatSkillCatalog = (summaries: SkillSummary[]): string => {
  return summaries.map((s) => `- ${s.name}: ${s.description}`).join("\n");
};

/**
 * Render the full `<skill-preference-policy>...</skill-preference-policy>`
 * block the host appends to `output.system` on each chat turn.
 *
 * The block always contains the skill-first policy and an inner
 * `<skill-catalog>` listing. An empty catalog produces a valid block
 * with no invented entries, matching the spec's "empty catalog is
 * allowed" scenario.
 */
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

/**
 * Render the `<skill-preflight>...</skill-preflight>` directive block the
 * host injects when a turn matches one or more skills.
 *
 * Each matched skill becomes a `use_skill("<name>")` directive. Empty
 * input renders as an empty string — the caller should not inject the
 * block when there is nothing to direct.
 */
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

/**
 * Resolve whether the preference layer is enabled from the raw env-var
 * value. Default is enabled; only the literal string `off` disables.
 *
 * Undefined and empty input both mean enabled (default-on). Any other
 * value (typos, `false`, `0`, `true`, etc.) is treated as enabled —
 * the disable escape hatch is intentionally narrow.
 */
export const isPreferenceModeEnabled = (raw?: string): boolean => {
  if (raw === undefined || raw === null || raw === "") return true;
  return raw !== "off";
};
