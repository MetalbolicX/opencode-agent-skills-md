/**
 * run_skill_script tool factory.
 */

import * as fs from "node:fs/promises";
import type { Skill } from "../types";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  _escapeShellArg,
  SKILL_SCRIPT_TIMEOUT_MS,
  runBoundSkillScript,
  scanScriptContent,
  requestRiskApproval,
} from "./shared";
import { resolveSafeSkillFilePath } from "./read-skill-file";
import { tool } from "@opencode-ai/plugin";

export type SkillShellResult = {
  cwd(d: string): SkillShellResult;
  text(): Promise<string>;
};

export type SkillShell = ((strings: TemplateStringsArray, ...values: unknown[]) => SkillShellResult) & {
  cwd(d: string): SkillShell;
};

export interface RunSkillScriptDeps {
  store: {
    resolve(name: string): Promise<Skill>;
  };
  shell: SkillShell;
  timeout?: number;
}

export const createRunSkillScript = (deps: RunSkillScriptDeps) => {
  return tool({
    description: "Run an executable script inside a skill directory.",
    args: {
      skill: tool.schema.string(),
      script: tool.schema.string(),
      arguments: tool.schema.array(tool.schema.string()).optional(),
    },
    async execute(
      args: { skill: string; script: string; arguments?: string[] },
      context: ToolContext,
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

      // Resolve canonical path — must stay within skill.path
      const pathResult = await resolveSafeSkillFilePath(skill.path, args.script);
      if (!pathResult.ok) {
        if (pathResult.reason === "traversal") {
          return `Invalid path: cannot access files outside skill directory.`;
        }
        return `Script "${args.script}" not found in skill "${skill.name}".`;
      }
      const canonicalPath = pathResult.path;

      // Read content once for scanning
      let scriptContent: string;
      try {
        scriptContent = await fs.readFile(canonicalPath, "utf8");
      } catch {
        return `Script "${args.script}" not found in skill "${skill.name}".`;
      }

      // Scan for risky content
      const report = scanScriptContent(scriptContent);
      if (report.categories.length > 0) {
        // Gate: ask for confirmation before executing risky script
        // This only returns on approval; denial throws/aborts via framework
        await requestRiskApproval(context, skill.name, args.script, report);
      }

      try {
        const scriptArgs = (args.arguments || []).map(_escapeShellArg).join(" ");
        const result = await runBoundSkillScript(
          shell`${canonicalPath} ${scriptArgs}`.cwd(skill.path).text(),
          context.abort,
          timeout,
          canonicalPath,
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
  });
};
