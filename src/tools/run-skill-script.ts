/**
 * run_skill_script tool factory.
 */

import type { Skill, SkillToolContext } from "../types";
import { _escapeShellArg, SKILL_SCRIPT_TIMEOUT_MS, runBoundSkillScript } from "./shared";

// Define shell type separately to avoid circular reference in interface
export type SkillShell = ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & {
  cwd: (d: string) => SkillShell;
};

export interface RunSkillScriptDeps {
  store: {
    resolve(name: string): Promise<Skill>;
  };
  shell: SkillShell;
  timeout?: number;
}

export const createRunSkillScript = (deps: RunSkillScriptDeps) => {
  return {
    async execute(
      args: { skill: string; script: string; arguments?: string[] },
      ctx?: SkillToolContext,
    ) {
      const { store, shell, timeout = SKILL_SCRIPT_TIMEOUT_MS } = deps;

      let skill: Skill;
      try {
        skill = await store.resolve(args.skill);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const didYouMean = msg.match(/Did you mean '(.+?)'\?/);
        if (didYouMean) {
          return `Skill "${args.skill}" not found. Did you mean "${didYouMean[1]}"?`;
        }
        return `Skill "${args.skill}" not found. Use get_available_skills to list available skills.`;
      }

      const script = skill.scripts.find((s) => s.relativePath === args.script);

      if (!script) {
        const scriptPaths = skill.scripts.map((s) => s.relativePath);

        // Simple closest-match for script names (reuse findClosestMatch logic inline
        // by importing from match.ts)
        const { findClosestMatch } = await import("../match");
        const suggestion = findClosestMatch(args.script, scriptPaths);

        if (suggestion) {
          return `Script "${args.script}" not found in skill "${skill.name}". Did you mean "${suggestion}"?`;
        }

        const available = scriptPaths.join(", ") || "none";
        return `Script "${args.script}" not found in skill "${skill.name}". Available scripts: ${available}`;
      }

      try {
        shell.cwd(skill.path);
        const scriptArgs = (args.arguments || []).map(_escapeShellArg).join(" ");
        const result = await runBoundSkillScript(
          shell`${script.absolutePath} ${scriptArgs}`.text(),
          ctx?.abort,
          timeout,
          script.absolutePath,
        );
        return result;
      } catch (error: unknown) {
        if (error instanceof Error && "exitCode" in error) {
          const shellError = error as Error & { exitCode: number; stderr?: Buffer; stdout?: Buffer };
          const stderr = shellError.stderr?.toString() || "";
          const stdout = shellError.stdout?.toString() || "";
          return `Script failed (exit ${shellError.exitCode}): ${stderr || stdout || shellError.message}`;
        }
        if (error instanceof Error) {
          return `Script failed: ${error.message}`;
        }
        return `Script failed: ${String(error)}`;
      }
    },
  };
};
