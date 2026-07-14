/**
 * tools/ index — factory and re-exports.
 *
 * Creates the three plugin-specific skill tool instances
 * (get_available_skills, read_skill_file, run_skill_script). Skill loading
 * itself is handled by OpenCode's native `skill` tool.
 *
 * Also re-exports _escapeXml and _escapeShellArg for backward compatibility
 * with existing code that imports from ./tools.
 */

import type { SkillStore } from "../types";
import type { SkillShell } from "./run-skill-script";
import { _escapeXml, _escapeShellArg, SKILL_SCRIPT_TIMEOUT_MS, runBoundSkillScript } from "./shared";
import { createReadSkillFile } from "./read-skill-file";
import { createRunSkillScript } from "./run-skill-script";
import { createGetAvailableSkills } from "./get-available-skills";

// Re-export shared utilities for backward compatibility
export { _escapeXml, _escapeShellArg, SKILL_SCRIPT_TIMEOUT_MS, runBoundSkillScript };

export type { SkillShell, SkillShellResult } from "./run-skill-script";

export interface SkillTools {
  get_available_skills: ReturnType<typeof createGetAvailableSkills>;
  read_skill_file: ReturnType<typeof createReadSkillFile>;
  run_skill_script: ReturnType<typeof createRunSkillScript>;
}

export interface CreateSkillToolsOptions {
  store: SkillStore;
  shell?: SkillShell;
  timeout?: number;
}

/**
 * Factory: create the three plugin skill tools wired to the shared SkillStore.
 * Skill loading itself is delegated to OpenCode's native `skill` tool.
 */
export const createSkillTools = (options: CreateSkillToolsOptions): SkillTools => {
  const { store, shell, timeout = SKILL_SCRIPT_TIMEOUT_MS } = options;

  if (!shell) {
    throw new Error("createSkillTools: shell is required for run_skill_script");
  }

  return {
    get_available_skills: createGetAvailableSkills({ store }),
    read_skill_file: createReadSkillFile({ store }),
    run_skill_script: createRunSkillScript({ store, shell, timeout }),
  };
};
