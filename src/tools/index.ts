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
export type { SkillShell } from "./run-skill-script";

export interface SkillTools {
  GetAvailableSkills: ReturnType<typeof createGetAvailableSkills>;
  ReadSkillFile: ReturnType<typeof createReadSkillFile>;
  RunSkillScript: ReturnType<typeof createRunSkillScript>;
  UseSkill: ReturnType<typeof createUseSkill>;
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

  return {
    GetAvailableSkills: createGetAvailableSkills({ store }),
    ReadSkillFile: createReadSkillFile({ store }),
    RunSkillScript: createRunSkillScript({ store, shell: shell!, timeout }),
    UseSkill: createUseSkill({ store, tracker, onSkillLoaded }),
  };
};
