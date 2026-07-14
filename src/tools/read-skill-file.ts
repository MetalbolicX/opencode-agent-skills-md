/**
 * read_skill_file tool factory.
 *
 * Uses fs.readFile/fs.readdir directly (no host) with safe path guard.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Skill, SkillToolContext } from "../types";
import { _escapeXml } from "./shared";
import { tool } from "@opencode-ai/plugin";

export interface ReadSkillFileDeps {
  store: {
    resolve(name: string): Promise<Skill>;
  };
}

/**
 * Resolve a file path safely — must stay within skillPath.
 * Returns the realpath on success, null on traversal or error.
 */
export const resolveSafeSkillFilePath = async (
  skillPath: string,
  filename: string,
): Promise<string | null> => {
  const resolved = path.join(skillPath, filename);
  try {
    const resolvedReal = await fs.realpath(resolved);
    const baseReal = await fs.realpath(skillPath);
    if (resolvedReal === baseReal || resolvedReal.startsWith(baseReal + path.sep)) {
      return resolvedReal;
    }
    return null;
  } catch {
    return null;
  }
};

export const createReadSkillFile = (deps: ReadSkillFileDeps) => {
  return tool({
    description: "Read a file from a skill directory, safely constrained to that skill.",
    args: {
      skill: tool.schema.string(),
      filename: tool.schema.string(),
    },
    async execute(args: { skill: string; filename: string }, _ctx?: SkillToolContext) {
      const { store } = deps;

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

      const canonicalPath = await resolveSafeSkillFilePath(skill.path, args.filename);
      if (canonicalPath === null) {
        return `Invalid path: cannot access files outside skill directory.`;
      }

      try {
        const content = await fs.readFile(canonicalPath, "utf8");

        return `<skill-file skill="${_escapeXml(skill.name)}" file="${_escapeXml(args.filename)}">
  <metadata>
    <directory>${_escapeXml(skill.path)}</directory>
  </metadata>

  <content>
${content}
  </content>
</skill-file>`;
      } catch {
        try {
          const files = await fs.readdir(skill.path);
          const skillFiles = files.filter((f) => f !== "SKILL.md");
          return `File "${args.filename}" not found. Available files: ${skillFiles.join(", ")}`;
        } catch {
          return `File "${args.filename}" not found in skill "${skill.name}".`;
        }
      }
    },
  });
};
