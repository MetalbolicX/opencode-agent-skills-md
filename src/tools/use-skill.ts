/**
 * use_skill tool factory.
 */

import type { Skill, SkillToolContext, SessionTracker } from "../types";
import { _escapeXml } from "./shared";
import { debugLog } from "../log";

/**
 * Tool translation guide for skills written for Claude Code.
 */
export const toolTranslation = `<tool-translation>
This skill may reference Claude Code tools. Use OpenCode equivalents:
- TodoWrite/TodoRead -> todowrite/todoread
- Task (subagents) -> task tool with subagent_type parameter
- Skill tool -> use_skill tool
- Read/Write/Edit/Bash/Glob/Grep/WebFetch -> lowercase (read/write/edit/bash/glob/grep/webfetch)
</tool-translation>`;

export interface UseSkillDeps {
  store: {
    resolve(name: string): Promise<Skill>;
    listFiles(skillName: string): Promise<string[]>;
  };
  tracker: SessionTracker;
  onSkillLoaded?: (sessionID: string, skillName: string) => void;
}

export const createUseSkill = (deps: UseSkillDeps) => {
  return {
    async execute(args: { skill: string }, ctx?: SkillToolContext) {
      const { store, tracker, onSkillLoaded } = deps;

      debugLog("use-skill: entry agent=%s sessionID=%s skill=%s",
        ctx?.agent ?? "undefined",
        ctx?.sessionID ?? "undefined",
        args.skill,
      );

      let skill: Skill;
      try {
        skill = await store.resolve(args.skill);
        debugLog("use-skill: resolved skill=%s", skill.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Preserve Did-you-mean from store.resolve()
        const didYouMean = msg.match(/Did you mean '(.+?)'\?/);
        if (didYouMean) {
          return `Skill "${args.skill}" not found. Did you mean "${didYouMean[1]}"?`;
        }
        return `Skill "${args.skill}" not found. Use get_available_skills to list available skills.`;
      }

      const sessionID = ctx?.sessionID ?? "";
      onSkillLoaded?.(sessionID, skill.name);
      debugLog("use-skill: onSkillLoaded sessionID=%s skill=%s", sessionID, skill.name);
      tracker.markLoaded(skill.name);

      const skillFiles = await store.listFiles(skill.name);

      const scriptsXml = skill.scripts.length > 0
        ? `\n    <scripts>\n${skill.scripts.map(s => `      <script>${_escapeXml(s.relativePath)}</script>`).join('\n')}\n    </scripts>`
        : '';

      const filesXml = skillFiles.length > 0
        ? `\n    <files>\n${skillFiles.map(f => `      <file>${_escapeXml(f)}</file>`).join('\n')}\n    </files>`
        : '';

      return `<skill name="${_escapeXml(skill.name)}">
  <metadata>
    <source>${_escapeXml(skill.label)}</source>
    <directory>${_escapeXml(skill.path)}</directory>${scriptsXml}${filesXml}
  </metadata>

  ${toolTranslation}

  <content>
${skill.template}
  </content>
</skill>`;
    },
  };
};
