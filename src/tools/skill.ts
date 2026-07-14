/**
 * skill tool factory.
 */

import type { Skill, SessionTracker } from "../types";
import type { ToolContext } from "@opencode-ai/plugin";
import { _escapeXml } from "./shared";
import { debugLog } from "../log";
import { tool } from "@opencode-ai/plugin";

/**
 * Tool translation guide for skills written for Claude Code.
 */
export const toolTranslation = `<tool-translation>
This skill may reference Claude Code tools. Use OpenCode equivalents:
- TodoWrite/TodoRead -> todowrite/todoread
- Task (subagents) -> task tool with subagent_type parameter
- Skill tool -> skill tool (same name in OpenCode)
- Read/Write/Edit/Bash/Glob/Grep/WebFetch -> lowercase (read/write/edit/bash/glob/grep/webfetch)
</tool-translation>`;

export interface SkillDeps {
  store: {
    resolve(name: string): Promise<Skill>;
    listFiles(skillName: string): Promise<string[]>;
  };
  tracker: SessionTracker;
  onSkillLoaded?: (sessionID: string, skillName: string) => void;
}

export const createSkill = (deps: SkillDeps) => {
  return tool({
    description: "Load a skill and return its instructions so the model can use it.",
    args: {
      name: tool.schema.string(),
    },
    async execute(args: { name: string }, context: ToolContext) {
      const { store, tracker, onSkillLoaded } = deps;

      debugLog("skill: entry agent=%s sessionID=%s name=%s",
        context.agent ?? "undefined",
        context.sessionID ?? "undefined",
        args.name,
      );

      let skill: Skill;
      try {
        skill = await store.resolve(args.name);
        debugLog("skill: resolved skill=%s", skill.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Preserve Did-you-mean from store.resolve()
        const didYouMean = msg.match(/Did you mean '(.+?)'\?/);
        if (didYouMean) {
          return `Skill "${args.name}" not found. Did you mean "${didYouMean[1]}"?`;
        }
        return `Skill "${args.name}" not found. Use get_available_skills to list available skills.`;
      }

      const sessionID = context.sessionID ?? "";
      onSkillLoaded?.(sessionID, skill.name);
      debugLog("skill: onSkillLoaded sessionID=%s skill=%s", sessionID, skill.name);
      tracker.markLoaded(skill.name);

      const skillFiles = await store.listFiles(skill.name);

      const filesBlock = skillFiles.length > 0
        ? [
            "<skill_files>",
            ...skillFiles.map((f) => `  <file>${_escapeXml(f)}</file>`),
            "</skill_files>",
          ].join("\n")
        : "<skill_files>\n</skill_files>";

      return `<skill_content name="${_escapeXml(skill.name)}">
# Skill: ${skill.name}

${toolTranslation}

${skill.template.trim()}

Base directory for this skill: ${skill.path}
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.

${filesBlock}
</skill_content>`;
    },
  });
};
