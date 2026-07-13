/**
 * Four skill tool factories.
 *
 * Mirrors packages/opencode-agent-skills-md/src/tools.ts behaviour.
 *
 * The four skill tools (get_available_skills, read_skill_file, run_skill_script,
 * use_skill) compose the portable core engine with the OpenCode host.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { OpencodeSkillHost } from "./host";
import type { Skill, SkillSummary } from "./types";
import { discoverAllSkills, findClosestMatch, listSkillFiles, resolveSkill, searchSkills } from "./skills";
import { debugLog } from "./utils";

/** Escape XML special characters to prevent wrapper breakout. */
const escapeXml = (s: string): string => {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

/** Wrap a shell argument in single quotes and escape embedded single quotes (Bourne-shell pattern). */
const escapeShellArg = (arg: string): string => {
  const escaped = arg.replace(/'/g, "'\\''");
  return "'" + escaped + "'";
};

/** @internal - exported for testing */
export const _escapeXml = escapeXml;
/** @internal - exported for testing */
export const _escapeShellArg = escapeShellArg;

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

export interface SkillTools {
  GetAvailableSkills: ReturnType<typeof GetAvailableSkillsFactory>;
  ReadSkillFile: ReturnType<typeof ReadSkillFileFactory>;
  RunSkillScript: ReturnType<typeof RunSkillScriptFactory>;
  UseSkill: ReturnType<typeof UseSkillFactory>;
}

export type OnSkillLoaded = (sessionID: string, skillName: string) => void;

export const createSkillTools = (
  host: OpencodeSkillHost,
  $: ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & { cwd: (d: string) => ReturnType<typeof $> },
  directory: string,
  onSkillLoaded?: OnSkillLoaded,
  scriptTimeoutMs: number = SKILL_SCRIPT_TIMEOUT_MS,
): SkillTools => {
  return {
    GetAvailableSkills: GetAvailableSkillsFactory(directory),
    ReadSkillFile: ReadSkillFileFactory(directory, host),
    RunSkillScript: RunSkillScriptFactory(directory, $, scriptTimeoutMs),
    UseSkill: UseSkillFactory(directory, host, onSkillLoaded),
  };
};

export type SkillResolution =
  | { ok: true; skill: Skill }
  | { ok: false; message: string };

export const resolveSkillOrSuggest = async (
  directory: string,
  skillName: string
): Promise<SkillResolution> => {
  const skillsByName = await discoverAllSkills(directory);
  const skill = resolveSkill(skillName, skillsByName);
  if (skill) return { ok: true, skill };

  const allSkillNames = Array.from(skillsByName.values()).map(s => s.name);
  const suggestion = findClosestMatch(skillName, allSkillNames);
  if (suggestion) {
    return {
      ok: false,
      message: `Skill "${skillName}" not found. Did you mean "${suggestion}"?`,
    };
  }
  return {
    ok: false,
    message: `Skill "${skillName}" not found. Use get_available_skills to list available skills.`,
  };
};

export const resolveSafeSkillFilePath = async (
  skillPath: string,
  filename: string
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

export const SKILL_SCRIPT_TIMEOUT_MS = 30000;

export const runBoundSkillScript = async (
  shellPromise: Promise<string>,
  abortSignal: AbortSignal | undefined,
  timeoutMs: number,
  scriptPath: string,
): Promise<string> => {
  if (abortSignal?.aborted) {
    return `Script "${scriptPath}" cancelled.`;
  }

  const cleanup: Array<() => void> = [];

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<string>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve(`Script "${scriptPath}" timed out after ${timeoutMs}ms.`),
      timeoutMs,
    );
  });
  cleanup.push(() => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  });

  let abortPromise: Promise<string>;
  if (abortSignal) {
    abortPromise = new Promise<string>((resolve) => {
      const onAbort = () => resolve(`Script "${scriptPath}" cancelled.`);
      abortSignal.addEventListener("abort", onAbort, { once: true });
      cleanup.push(() => abortSignal.removeEventListener("abort", onAbort));
    });
  } else {
    abortPromise = new Promise<string>(() => {});
  }

  try {
    return await Promise.race([shellPromise, timeoutPromise, abortPromise]);
  } finally {
    for (const fn of cleanup) fn();
  }
};

const GetAvailableSkillsFactory = (directory: string) => {
  return {
    async execute(args: { query?: string; keywords?: string[] }, _ctx?: unknown) {
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
          const trigger = s.trigger && s.trigger.length > 0
            ? `\n  trigger: ${s.trigger}`
            : '';
          return `${s.name} (${s.label})\n  ${s.description}${trigger}${scripts}`;
        })
        .join('\n\n');
    }
  };
};

const ReadSkillFileFactory = (directory: string, host: OpencodeSkillHost) => {
  return {
    async execute(args: { skill: string; filename: string }, ctx?: { sessionID?: string }) {
      const resolution = await resolveSkillOrSuggest(directory, args.skill);
      if (!resolution.ok) return resolution.message;
      const skill = resolution.skill;

      const canonicalPath = await resolveSafeSkillFilePath(skill.path, args.filename);
      if (canonicalPath === null) {
        return `Invalid path: cannot access files outside skill directory.`;
      }

      try {
        const content = await host.client.readFile(canonicalPath);

        const wrappedContent = `<skill-file skill="${escapeXml(skill.name)}" file="${escapeXml(args.filename)}">
  <metadata>
    <directory>${escapeXml(skill.path)}</directory>
  </metadata>

  <content>
${content}
  </content>
</skill-file>`;

        await host.client.injectContent(ctx?.sessionID ?? "", wrappedContent);

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
  };
};

const RunSkillScriptFactory = (
  directory: string,
  $: ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & { cwd: (d: string) => ReturnType<typeof $> },
  scriptTimeoutMs: number = SKILL_SCRIPT_TIMEOUT_MS,
) => {
  return {
    async execute(args: { skill: string; script: string; arguments?: string[] }, ctx?: { sessionID?: string; abort?: AbortSignal }) {
      const resolution = await resolveSkillOrSuggest(directory, args.skill);
      if (!resolution.ok) return resolution.message;
      const skill = resolution.skill;

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
        const scriptArgs = (args.arguments || []).map(escapeShellArg).join(' ');
        const result = await runBoundSkillScript(
          $`${script.absolutePath} ${scriptArgs}`.text(),
          ctx?.abort,
          scriptTimeoutMs,
          script.absolutePath,
        );
        return result;
      } catch (error: unknown) {
        if (error instanceof Error && "exitCode" in error) {
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
  };
};

const UseSkillFactory = (
  directory: string,
  host: OpencodeSkillHost,
  onSkillLoaded?: OnSkillLoaded
) => {
  return {
    async execute(args: { skill: string }, ctx?: { sessionID?: string }) {
      const resolution = await resolveSkillOrSuggest(directory, args.skill);
      if (!resolution.ok) return resolution.message;
      const skill = resolution.skill;

      const skillFiles = await listSkillFiles(skill.path);

      const scriptsXml = skill.scripts.length > 0
        ? `\n    <scripts>\n${skill.scripts.map(s => `      <script>${escapeXml(s.relativePath)}</script>`).join('\n')}\n    </scripts>`
        : '';

      const filesXml = skillFiles.length > 0
        ? `\n    <files>\n${skillFiles.map(f => `      <file>${escapeXml(f)}</file>`).join('\n')}\n    </files>`
        : '';

      const skillContent = `<skill name="${escapeXml(skill.name)}">
  <metadata>
    <source>${escapeXml(skill.label)}</source>
    <directory>${escapeXml(skill.path)}</directory>${scriptsXml}${filesXml}
  </metadata>

  ${toolTranslation}

  <content>
${skill.template}
  </content>
</skill>`;

      await host.client.injectContent(ctx?.sessionID ?? "", skillContent);

      onSkillLoaded?.(ctx?.sessionID ?? "", skill.name);

      const scriptInfo = skill.scripts.length > 0
        ? `\nAvailable scripts: ${skill.scripts.map(s => s.relativePath).join(', ')}`
        : '';

      const filesInfo = skillFiles.length > 0
        ? `\nAvailable files: ${skillFiles.join(', ')}`
        : '';

      return `Skill "${skill.name}" loaded.${scriptInfo}${filesInfo}`;
    }
  };
};
