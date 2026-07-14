/**
 * tools/ index — factory and re-exports.
 *
 * Creates the four skill tool instances (get_available_skills, read_skill_file,
 * run_skill_script, use_skill) using the provided SkillStore and SessionTracker.
 *
 * Also re-exports _escapeXml and _escapeShellArg for backward compatibility
 * with existing code that imports from ./tools.
 */

import type { SkillStore, SessionTracker } from "../types";
import type { SkillShell } from "./run-skill-script";
import { _escapeXml, _escapeShellArg, SKILL_SCRIPT_TIMEOUT_MS, runBoundSkillScript } from "./shared";
import { createUseSkill } from "./use-skill";
import { createReadSkillFile } from "./read-skill-file";
import { createRunSkillScript } from "./run-skill-script";
import { createGetAvailableSkills } from "./get-available-skills";

// Re-export shared utilities for backward compatibility
export { _escapeXml, _escapeShellArg, SKILL_SCRIPT_TIMEOUT_MS, runBoundSkillScript };
export { toolTranslation } from "./use-skill";

export type OnSkillLoaded = (sessionID: string, skillName: string) => void;
export type { SkillShell, SkillShellResult } from "./run-skill-script";

export interface SkillTools {
  get_available_skills: ReturnType<typeof createGetAvailableSkills>;
  read_skill_file: ReturnType<typeof createReadSkillFile>;
  run_skill_script: ReturnType<typeof createRunSkillScript>;
  use_skill: ReturnType<typeof createUseSkill>;
}

export interface CreateSkillToolsOptions {
  store: SkillStore;
  tracker: SessionTracker;
  shell?: SkillShell;
  onSkillLoaded?: OnSkillLoaded;
  timeout?: number;
}

/**
 * Factory: create all four skill tools wired to the shared SkillStore.
 */
export const createSkillTools = (options: CreateSkillToolsOptions): SkillTools => {
  const { store, tracker, shell, onSkillLoaded, timeout = SKILL_SCRIPT_TIMEOUT_MS } = options;

  if (!shell) {
    throw new Error("createSkillTools: shell is required for run_skill_script");
  }

  return {
    get_available_skills: createGetAvailableSkills({ store }),
    read_skill_file: createReadSkillFile({ store }),
    run_skill_script: createRunSkillScript({ store, shell, timeout }),
    use_skill: createUseSkill({ store, tracker, onSkillLoaded }),
  };
};
