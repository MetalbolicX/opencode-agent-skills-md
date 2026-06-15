/**
 * Content formatting helpers for skill listings and synthetic injections.
 *
 * Pure functions: string assembly only, no host dependencies.
 */

import type { Skill } from "./types";

/**
 * Format a list of skills as the inner bullet block used inside the
 * `<available-skills>` synthetic injection.
 */
export function formatSkillListing(skills: Skill[]): string {
  return skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");
}

/**
 * Render the full `<available-skills>...</available-skills>` block that the
 * host injects into a session on startup and after compaction.
 */
export function renderAvailableSkillsBlock(skills: Skill[]): string {
  const skillsList = formatSkillListing(skills);
  return `<available-skills>
Use the use_skill, read_skill_file, run_skill_script, and get_available_skills tools to work with skills.

${skillsList}
</available-skills>`;
}
