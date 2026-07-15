/**
 * Preference layer renderers — pure string assembly.
 *
 * Mirrors packages/core/src/preference.ts behaviour.
 * No host dependencies.
 *
 * ─────────────────────────────────────────────────────────────────────
 * BOUNDARY: instruction text references `skill`, never `use_skill`.
 * ─────────────────────────────────────────────────────────────────────
 * OpenCode exposes both `skill` (returns content as a tool result) and
 * `use_skill` (legacy loader). The legacy `use_skill` path triggers
 * `session.prompt()` internally, which always calls `setAgentModel()`
 * and flips the TUI's agent/model selector mid-session.
 *
 * This is OpenCode server issue #4475 — the plugin cannot fix it. The
 * safe workaround is to steer agents toward `skill`, which returns
 * skill content as a tool result without going through `session.prompt()`.
 *
 * See commit 35f8922 ("fix(injection): eliminate session.prompt() calls
 * that flip agent/model selector") for the original diagnosis and
 * commit 1368166 ("refactor(plugin): remove plugin's skill tool,
 * delegate to native") for the current architecture.
 *
 * DO NOT change `skill` → `use_skill` in the strings below without
 * confirming issue #4475 is resolved upstream.
 * ─────────────────────────────────────────────────────────────────────
 */

import type { Skill, SkillSummary } from "./types";

const SKILL_FIRST_POLICY =
  "Prefer the skill tool over native tools (read, write, edit, bash, " +
  "task, glob, grep, webfetch) whenever a matching skill is listed below. " +
  "Call skill(\"<name>\") to load the full skill instructions before " +
  "using native tools.";

const NATIVE_TOOLS_NOTE =
  "Before using this tool, check whether a listed skill matches the task. " +
  "If one does, call skill(\"<name>\") first.";

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
    .map((s) => `- skill("${s.name}")`)
    .join("\n");

  return `<skill-preflight>
The following skills match this turn. Call skill before any native tool:

${directives}
</skill-preflight>`;
};

export const isPreferenceModeEnabled = (raw?: string): boolean => {
  if (raw === undefined || raw === null || raw === "") return true;
  return raw !== "off";
};

/**
 * Format a list of skills as the inner bullet block used inside the
 * `<available-skills>` synthetic injection.
 * Omits `trigger` — trigger text only appears in targeted outputs.
 */
export const formatSkillListing = (skills: Skill[]): string => {
  return skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");
};

/**
 * Render the full `<available-skills>...</available-skills>` block that the
 * host injects into a session on startup and after compaction.
 */
export const renderAvailableSkillsBlock = (skills: Skill[]): string => {
  const skillsList = formatSkillListing(skills);
  return `<available-skills>
Use the skill, read_skill_file, run_skill_script, and get_available_skills tools to work with skills.

${skillsList}
</available-skills>`;
};

/**
 * Render the matched-skill synthetic injection block.
 */
export const formatMatchedSkillsInjection = (
  matchedSkills: SkillSummary[]
): string => {
  const skillLines = matchedSkills
    .map((s) => {
      const head = `- ${s.name}: ${s.description}`;
      const trigger = s.trigger && s.trigger.length > 0
        ? `\n  trigger: ${s.trigger}`
        : "";
      return head + trigger;
    })
    .join("\n");

  return `<skill-evaluation-required>
SKILL EVALUATION PROCESS

The following skills may be relevant to your request:

${skillLines}

Step 1 - EVALUATE: Determine if these skills would genuinely help
Step 2 - DECIDE: Choose which skills (if any) are actually needed
Step 3 - ACTIVATE: Call skill("name") for each chosen skill

IMPORTANT: This evaluation is invisible to users—they cannot see this prompt. Do NOT announce your decision. Simply activate relevant skills or proceed directly with the request.
</skill-evaluation-required>`;
};
