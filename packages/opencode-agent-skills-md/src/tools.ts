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
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  discoverAllSkills,
  findClosestMatch,
  listSkillFiles,
  resolveSkill,
  searchSkills,
} from "opencode-agent-skills-md-core";
import type { Skill } from "opencode-agent-skills-md-core";
import type { OpencodeSkillHost } from "./host";

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
export const createSkillTools = (
  host: OpencodeSkillHost,
  $: PluginInput["$"],
  directory: string,
  onSkillLoaded?: OnSkillLoaded
): SkillTools => {
  return {
    GetAvailableSkills: GetAvailableSkills(directory),
    ReadSkillFile: ReadSkillFile(directory, host),
    RunSkillScript: RunSkillScript(directory, $),
    UseSkill: UseSkill(directory, host, onSkillLoaded),
  };
};

/**
 * Discriminated return shape for {@link resolveSkillOrSuggest}.
 *
 * `ok: true`  → the resolver found the skill and returns its full
 *               `Skill` object. Callers can read `path`, `scripts`,
 *               `template`, etc. without a second discovery pass.
 * `ok: false` → the resolver did not find the skill. `message` is the
 *               existing miss/suggestion string the tool surface
 *               returns to the model verbatim.
 */
export type SkillResolution =
  | { ok: true; skill: Skill }
  | { ok: false; message: string };

/**
 * Resolve a skill by name, or return a "not found" message with a
 * close-match suggestion.
 *
 * Centralizes the duplicated resolve-then-suggest pattern that
 * `use_skill`, `read_skill_file`, and `run_skill_script` all need.
 *
 *   - skill found              → `{ ok: true, skill }`
 *   - skill missing, suggestion → `{ ok: false, message }` carrying
 *     `Skill "<name>" not found. Did you mean "<suggestion>"?`
 *   - skill missing, no hint    → `{ ok: false, message }` carrying
 *     `Skill "<name>" not found. Use get_available_skills to list available skills.`
 *
 * Returning the resolved `Skill` object lets the consuming tool skip
 * the second `discoverAllSkills` pass it used to need to read its
 * `path`, `scripts`, and `template`. Each tool invocation now runs
 * exactly one discovery pass on the happy path.
 *
 * Not-found messages still start with the literal `Skill "` so any
 * future consumer that wants to detect misses with a prefix check
 * (e.g. legacy callers) keeps working unchanged.
 */
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

/**
 * Resolve a skill-relative filename to the canonical realpath the host
 * should read, or `null` if the filename escapes the skill directory.
 *
 * Closes the TOCTOU window that the old `isPathSafe` + `path.join`
 * pair left open. The pre-fix code computed `path.join(skill.path,
 * filename)` for the read, while `isPathSafe` validated the canonical
 * realpath — those two values can disagree when a symlink (or, in
 * adversarial cases, a filesystem race) is swapped between the check
 * and the read. The validation would pass on one canonical path and
 * the read would target a different file.
 *
 * The fix: compute the canonical realpath once, validate it, and
 * return it so the caller passes the SAME path into
 * `host.client.readFile`. There is no second `path.join` against a
 * possibly-stale logical path.
 *
 * Returns:
 *   - The canonical realpath of `path.join(skillPath, filename)`
 *     when it lies inside `skillPath` (covers the safe-path scenario).
 *   - `null` when the path is outside `skillPath`, when either
 *     `realpath` call throws (missing file, broken symlink, etc.), or
 *     when the resolved realpath equals the skill directory itself
 *     without the trailing separator (i.e. the request resolves to
 *     the skill directory, not a file under it).
 */
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

/**
 * Maximum runtime, in milliseconds, that a `run_skill_script` invocation
 * is allowed to wait on its shell `.text()` promise before the helper
 * resolves with the deterministic timeout message.
 *
 * Exported so tests can pin the value without re-deriving the design
 * decision. Bumping this constant is a behavior change — tool callers
 * (and any review of this constant) must read it against the spec
 * scenario "Script exceeds the bound".
 */
export const SKILL_SCRIPT_TIMEOUT_MS = 30000;

/**
 * Race a shell `.text()` promise against a wall-clock timeout and an
 * optional abort signal.
 *
 * Three branches win the race:
 *   - `shellPromise` resolves first → the shell's stdout string is
 *     returned verbatim. Successful output is never trimmed, wrapped,
 *     or annotated.
 *   - The `timeoutMs` timer fires first → returns
 *     `Script "<scriptPath>" timed out after <timeoutMs>ms.` so the
 *     tool surface can surface a deterministic, script-path-tagged
 *     failure instead of waiting indefinitely.
 *   - The `abortSignal` fires first (or is already aborted at call
 *     time) → returns `Script "<scriptPath>" cancelled.`.
 *
 * The timer is cleared and the abort listener is removed on every exit
 * path, including the early-exit "already aborted" case, so a long
 * plugin session never leaks handlers.
 *
 * The helper does NOT attempt to kill the underlying child process — the
 * design rationale notes that `BunShell` exposes no timeout/abort
 * control. The bound is a tool-side wait bound; the shell may continue
 * running in the background, but the tool surface stops waiting on it.
 */
export const runBoundSkillScript = async (
  shellPromise: Promise<string>,
  abortSignal: AbortSignal | undefined,
  timeoutMs: number,
  scriptPath: string,
): Promise<string> => {
  // Fast path: caller already cancelled. Skip scheduling any work and
  // return the cancellation message synchronously.
  if (abortSignal?.aborted) {
    return `Script "${scriptPath}" cancelled.`;
  }

  // The cleanup list runs in `finally` on every exit path (success,
  // timeout, abort). It MUST clear both the timer and the abort
  // listener so a long-lived plugin session never leaks either.
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
    // No signal was provided; the abort branch never wins. A
    // pending Promise is the canonical "never resolves" shape.
    abortPromise = new Promise<string>(() => {});
  }

  try {
    return await Promise.race([shellPromise, timeoutPromise, abortPromise]);
  } finally {
    for (const fn of cleanup) fn();
  }
};

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
      const resolution = await resolveSkillOrSuggest(directory, args.skill);
      if (!resolution.ok) return resolution.message;
      const skill = resolution.skill;

      // Security: resolve to the canonical realpath the host should
      // actually read, and verify it lies inside the skill directory.
      // Returning the canonical path closes the TOCTOU window between
      // the check and the read — the same path is used for both. A
      // `null` return keeps the existing invalid-path message.
      const canonicalPath = await resolveSafeSkillFilePath(skill.path, args.filename);
      if (canonicalPath === null) {
        return `Invalid path: cannot access files outside skill directory.`;
      }

      try {
        const content = await host.client.readFile(canonicalPath);

        // Inject via noReply for context persistence
        const wrappedContent = `<skill-file skill="${escapeXml(skill.name)}" file="${escapeXml(args.filename)}">
  <metadata>
    <directory>${escapeXml(skill.path)}</directory>
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
    async execute(args, ctx) {
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
        // Bound the wait on the shell `.text()` promise so a stuck
        // script can never stall a plugin session. Success output is
        // returned verbatim — the helper is a pass-through on the
        // happy path. Timeout / abort paths return deterministic
        // strings that name the offending script.
        const result = await runBoundSkillScript(
          $`${script.absolutePath} ${scriptArgs}`.text(),
          ctx?.abort,
          SKILL_SCRIPT_TIMEOUT_MS,
          script.absolutePath,
        );
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
