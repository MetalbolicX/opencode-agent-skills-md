/**
 * OpenCode tool factories.
 *
 * The four skill tools (get_available_skills, read_skill_file, run_skill_script,
 * use_skill) compose the portable core engine with the OpenCode host. Tools
 * consume the host's bounded client surface; they never reference the
 * OpenCode SDK client or the `node:fs` module directly.
 *
 * `createSkillTools(host, $, directory)` returns the four tool factories
 * pre-bound to the host, the shell runner, and the project directory. The
 * plugin instantiates them at registration time.
 */

import type { PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";
import {
  discoverAllSkills,
  findClosestMatch,
  isPathSafe,
  listSkillFiles,
  resolveSkill,
  searchSkills,
} from "opencode-agent-skills-core";
import type { OpencodeSkillHost } from "./host";

/**
 * Portable return type for tool factory consts.
 *
 * The `tool()` helper captures the Zod shape of its `args` parameter in the
 * generic parameter, so the inferred return type of each factory leaks Zod
 * types. When TypeScript emits `.d.ts` files for the package, that generic
 * instantiation cannot be named portably across zod versions. Annotating
 * the return type as `ReturnType<typeof tool>` erases the per-call Zod
 * shape and leaves a stable, portable declaration for downstream consumers.
 */
type SkillTool = ReturnType<typeof tool>;

/**
 * Tool translation guide for skills written for Claude Code.
 * Injected into skill content to help the AI use OpenCode equivalents.
 */
export const toolTranslation = `<tool-translation>
This skill may reference Claude Code tools. Use OpenCode equivalents:
- TodoWrite/TodoRead -> todowrite/todoread
- Task (subagents) -> task tool with subagent_type parameter
- Skill tool -> use_skill tool
- Read/Write/Edit/Bash/Glob/Grep/WebFetch -> lowercase (read/write/edit/bash/glob/grep/webfetch)
</tool-translation>`;

export interface SkillTools {
  GetAvailableSkills: ReturnType<typeof GetAvailableSkills>;
  ReadSkillFile: ReturnType<typeof ReadSkillFile>;
  RunSkillScript: ReturnType<typeof RunSkillScript>;
  UseSkill: ReturnType<typeof UseSkill>;
}

/**
 * Callback fired by `UseSkill` after a successful load so the host can
 * update its session-level bookkeeping (loaded-skill set, TUI icon, etc.).
 * The core never assumes a callback is registered; missing it must not
 * break the load.
 */
export type OnSkillLoaded = (sessionID: string, skillName: string) => void;

/**
 * Build the four skill tool factories bound to the host, shell, and
 * project directory. The returned object is what the plugin registers
 * under its `tool` hook.
 *
 * The optional `onSkillLoaded` callback is threaded through to `UseSkill`
 * so a successful load can update host session state (e.g., the loaded-
 * skill set used to suppress duplicate match injection in `chat.message`).
 */
export function createSkillTools(
  host: OpencodeSkillHost,
  $: PluginInput["$"],
  directory: string,
  onSkillLoaded?: OnSkillLoaded
): SkillTools {
  return {
    GetAvailableSkills: GetAvailableSkills(directory),
    ReadSkillFile: ReadSkillFile(directory, host),
    RunSkillScript: RunSkillScript(directory, $),
    UseSkill: UseSkill(directory, host, onSkillLoaded),
  };
}

/**
 * Resolve a skill by name, or return a "not found" message with a
 * close-match suggestion.
 *
 * Centralizes the duplicated resolve-then-suggest pattern that
 * `use_skill`, `read_skill_file`, and `run_skill_script` all need.
 * Returning a single `string` keeps the call site trivial:
 *
 *   - skill found              → returns `skill.name`
 *   - skill missing, suggestion → `Skill "<name>" not found. Did you mean "<suggestion>"?`
 *   - skill missing, no hint    → `Skill "<name>" not found. Use get_available_skills to list available skills.`
 *
 * Not-found messages always start with the literal `Skill "` so callers
 * can detect them with `result.startsWith('Skill "')`. The skill-name
 * regex (`/^[\p{Ll}\p{N}-]+$/u`) forbids uppercase initial characters,
 * so a legitimate skill name can never collide with that prefix.
 *
 * The helper does its own discovery; callers that need the `Skill` object
 * (rather than just its name) re-resolve via a second `discoverAllSkills`
 * call. Discovery is cheap (file-listing only) and the OS-level metadata
 * cache absorbs most of the cost.
 */
export async function resolveSkillOrSuggest(
  directory: string,
  skillName: string
): Promise<string> {
  const skillsByName = await discoverAllSkills(directory);
  const skill = resolveSkill(skillName, skillsByName);
  if (skill) return skill.name;

  const allSkillNames = Array.from(skillsByName.values()).map(s => s.name);
  const suggestion = findClosestMatch(skillName, allSkillNames);
  if (suggestion) {
    return `Skill "${skillName}" not found. Did you mean "${suggestion}"?`;
  }
  return `Skill "${skillName}" not found. Use get_available_skills to list available skills.`;
}

const GetAvailableSkills = (directory: string): SkillTool => {
  return tool({
    description:
      "Get available skills with their descriptions. Optionally filter by free-text query and/or tag keywords.",
    args: {
      query: tool.schema.string().optional()
        .describe("Free-text search query. Matched against skill name and description; relevance-ranked."),
      keywords: tool.schema.array(tool.schema.string()).optional()
        .describe("Optional list of tag keywords. Only skills whose metadata.tags include at least one entry are returned.")
    },
    async execute(args) {
      const skillsByName = await discoverAllSkills(directory);
      const allSkills = Array.from(skillsByName.values());

      const matched = searchSkills(allSkills, args.query ?? "", args.keywords);

      if (matched.length === 0) {
        if (args.query) {
          const allSkillNames = allSkills.map(s => s.name);
          const suggestion = findClosestMatch(args.query, allSkillNames);

          if (suggestion) {
            return `No skills found matching "${args.query}". Did you mean "${suggestion}"?`;
          }
        }

        return "No skills found matching your query.";
      }

      return matched
        .map(s => {
          const scripts = s.scripts.length > 0
            ? ` [scripts: ${s.scripts.map(sc => sc.relativePath).join(', ')}]`
            : '';
          // PR 2: render `trigger: <text>` on its own line when set.
          // The always-on `<available-skills>` block stays compact; only
          // this targeted listing surfaces the trigger.
          const trigger = s.trigger && s.trigger.length > 0
            ? `\n  trigger: ${s.trigger}`
            : '';
          return `${s.name} (${s.label})\n  ${s.description}${trigger}${scripts}`;
        })
        .join('\n\n');
    }
  });
};

const ReadSkillFile = (directory: string, host: OpencodeSkillHost): SkillTool => {
  return tool({
    description: "Read a supporting file from a skill's directory (docs, examples, configs).",
    args: {
      skill: tool.schema.string()
        .describe("Name of the skill"),
      filename: tool.schema.string()
        .describe("File to read, relative to skill directory (e.g., 'anthropic-best-practices.md', 'scripts/helper.sh')")
    },
    async execute(args, ctx) {
      const resolved = await resolveSkillOrSuggest(directory, args.skill);
      if (resolved.startsWith('Skill "')) return resolved;

      // Helper confirmed existence; resolve to the full Skill object so we
      // can read its path, scripts, and other metadata below.
      const skillsByName = await discoverAllSkills(directory);
      const skill = skillsByName.get(resolved);
      if (!skill) {
        return `Skill "${args.skill}" not found. Use get_available_skills to list available skills.`;
      }

      // Security: ensure path doesn't escape skill directory
      if (!isPathSafe(skill.path, args.filename)) {
        return `Invalid path: cannot access files outside skill directory.`;
      }

      const filePath = path.join(skill.path, args.filename);

      try {
        const content = await host.client.readFile(filePath);

        // Inject via noReply for context persistence
        const wrappedContent = `<skill-file skill="${skill.name}" file="${args.filename}">
  <metadata>
    <directory>${skill.path}</directory>
  </metadata>

  <content>
${content}
  </content>
</skill-file>`;

        const context = await host.client.getSessionContext(ctx.sessionID);
        await host.client.injectContent(ctx.sessionID, wrappedContent, context);

        return `File "${args.filename}" from skill "${skill.name}" loaded.`;
      } catch {
        try {
          const files = await host.client.readdir(skill.path);
          return `File "${args.filename}" not found. Available files: ${files.join(', ')}`;
        } catch {
          return `File "${args.filename}" not found in skill "${skill.name}".`;
        }
      }
    }
  });
};

const RunSkillScript = (directory: string, $: PluginInput["$"]): SkillTool => {
  return tool({
    description: "Execute a script from a skill's directory. Scripts are run with the skill directory as CWD.",
    args: {
      skill: tool.schema.string()
        .describe("Name of the skill"),
      script: tool.schema.string()
        .describe("Relative path to the script (e.g., 'build.sh', 'tools/deploy.sh')"),
      arguments: tool.schema.array(tool.schema.string()).optional()
        .describe("Arguments to pass to the script")
    },
    async execute(args) {
      const resolved = await resolveSkillOrSuggest(directory, args.skill);
      if (resolved.startsWith('Skill "')) return resolved;

      // Helper confirmed existence; resolve to the full Skill object so we
      // can inspect its scripts and run them below.
      const skillsByName = await discoverAllSkills(directory);
      const skill = skillsByName.get(resolved);
      if (!skill) {
        return `Skill "${args.skill}" not found. Use get_available_skills to list available skills.`;
      }

      const script = skill.scripts.find(s => s.relativePath === args.script);

      if (!script) {
        const scriptPaths = skill.scripts.map(s => s.relativePath);
        const suggestion = findClosestMatch(args.script, scriptPaths);

        if (suggestion) {
          return `Script "${args.script}" not found in skill "${skill.name}". Did you mean "${suggestion}"?`;
        }

        const available = scriptPaths.join(', ') || 'none';
        return `Script "${args.script}" not found in skill "${skill.name}". Available scripts: ${available}`;
      }

      try {
        $.cwd(skill.path);
        const scriptArgs = args.arguments || [];
        const result = await $`${script.absolutePath} ${scriptArgs}`.text();
        return result;
      } catch (error: unknown) {
        if (error instanceof Error && 'exitCode' in error) {
          const shellError = error as Error & { exitCode: number; stderr?: Buffer; stdout?: Buffer };
          const stderr = shellError.stderr?.toString() || '';
          const stdout = shellError.stdout?.toString() || '';
          return `Script failed (exit ${shellError.exitCode}): ${stderr || stdout || shellError.message}`;
        }
        if (error instanceof Error) {
          return `Script failed: ${error.message}`;
        }
        return `Script failed: ${String(error)}`;
      }
    }
  });
};

const UseSkill = (
  directory: string,
  host: OpencodeSkillHost,
  onSkillLoaded?: (sessionID: string, skillName: string) => void
): SkillTool => {
  return tool({
    description: "Load a skill's SKILL.md content into context. Skills contain proven workflows, techniques, and patterns.",
    args: {
      skill: tool.schema.string()
        .describe("Name of the skill (e.g., 'brainstorming', 'project:my-skill', 'user:my-skill')")
    },
    async execute(args, ctx) {
      const resolved = await resolveSkillOrSuggest(directory, args.skill);
      if (resolved.startsWith('Skill "')) return resolved;

      // Helper confirmed existence; resolve to the full Skill object so we
      // can read its template, scripts, and files for injection below.
      const skillsByName = await discoverAllSkills(directory);
      const skill = skillsByName.get(resolved);
      if (!skill) {
        return `Skill "${args.skill}" not found. Use get_available_skills to list available skills.`;
      }

      const skillFiles = await listSkillFiles(skill.path);

      const scriptsXml = skill.scripts.length > 0
        ? `\n    <scripts>\n${skill.scripts.map(s => `      <script>${s.relativePath}</script>`).join('\n')}\n    </scripts>`
        : '';

      const filesXml = skillFiles.length > 0
        ? `\n    <files>\n${skillFiles.map(f => `      <file>${f}</file>`).join('\n')}\n    </files>`
        : '';

      const skillContent = `<skill name="${skill.name}">
  <metadata>
    <source>${skill.label}</source>
    <directory>${skill.path}</directory>${scriptsXml}${filesXml}
  </metadata>

  ${toolTranslation}

  <content>
${skill.template}
  </content>
</skill>`;

      const context = await host.client.getSessionContext(ctx.sessionID);
      await host.client.injectContent(ctx.sessionID, skillContent, context);

      onSkillLoaded?.(ctx.sessionID, skill.name);

      const scriptInfo = skill.scripts.length > 0
        ? `\nAvailable scripts: ${skill.scripts.map(s => s.relativePath).join(', ')}`
        : '';

      const filesInfo = skillFiles.length > 0
        ? `\nAvailable files: ${skillFiles.join(', ')}`
        : '';

      return `Skill "${skill.name}" loaded.${scriptInfo}${filesInfo}`;
    }
  });
};
