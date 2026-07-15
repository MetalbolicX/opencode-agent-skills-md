/**
 * read_skill_file tool factory.
 *
 * Uses fs.readFile/fs.readdir directly (no host) with safe path guard.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Skill } from "../types";
import type { ToolContext } from "@opencode-ai/plugin";
import { _escapeXml } from "./shared";
import { tool } from "@opencode-ai/plugin";

export interface ReadSkillFileDeps {
  store: {
    resolve(name: string): Promise<Skill>;
  };
}

/**
 * Result of safe path resolution — distinguishes traversal from missing file.
 */
export type SafePathResult =
  | { ok: true; path: string }
  | { ok: false; reason: "traversal" | "not_found" };

/**
 * Resolve a file path safely — must stay within skillPath.
 * Returns { ok: true, path } on success.
 * Returns { ok: false, reason: "traversal" } if path escapes skillPath.
 * Returns { ok: false, reason: "not_found" } if file does not exist.
 */
export const resolveSafeSkillFilePath = async (
  skillPath: string,
  filename: string,
): Promise<SafePathResult> => {
  if (path.isAbsolute(filename)) {
    return { ok: false, reason: "traversal" };
  }
  const resolved = path.normalize(path.join(skillPath, filename));
  if (!resolved.startsWith(skillPath + path.sep) && resolved !== skillPath) {
    return { ok: false, reason: "traversal" };
  }
  let baseReal: string;
  try {
    baseReal = await fs.realpath(skillPath);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  let resolvedReal: string;
  try {
    resolvedReal = await fs.realpath(resolved);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (resolvedReal === baseReal || resolvedReal.startsWith(baseReal + path.sep)) {
    return { ok: true, path: resolvedReal };
  }
  return { ok: false, reason: "traversal" };
};

export const createReadSkillFile = (deps: ReadSkillFileDeps) => {
  return tool({
    description: "Read a file from a skill directory, safely constrained to that skill.",
    args: {
      skill: tool.schema.string(),
      filename: tool.schema.string(),
    },
    async execute(args: { skill: string; filename: string }, _context: ToolContext) {
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

      const canonicalPathResult = await resolveSafeSkillFilePath(skill.path, args.filename);
      if (!canonicalPathResult.ok) {
        if (canonicalPathResult.reason === "traversal") {
          return `Invalid path: cannot access files outside skill directory.`;
        }
        return `File "${args.filename}" not found in skill "${skill.name}".`;
      }
      const canonicalPath = canonicalPathResult.path;

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
