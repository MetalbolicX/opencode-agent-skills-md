/**
 * Skill discovery across filesystem roots.
 *
 * The core never hard-codes a host's directory layout. Callers pass the list
 * of discovery roots; the default `getDefaultOpencodeRoots` reproduces the
 * legacy OpenCode priority order. PR2 will call `discoverAllSkills` from the
 * OpenCode host adapter with the same default.
 */

import { homedir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import type {
  DiscoveryPath,
  FileDiscoveryResult,
  LabeledDiscoveryResult,
  Skill,
  SkillLabel,
} from "./types";
import { parseSkillFile } from "./parse";
import { walkDir } from "./walk";
import { debugLog } from "./debug";

/**
 * Check if a file exists in a directory and return path info.
 *
 * @param directory - Directory to check
 * @param relativePath - Relative path to use in result (caller-specific)
 * @param filename - Name of file to look for (e.g., 'SKILL.md')
 * @returns Path info if file exists, null otherwise
 */
export const findFile = async (
  directory: string,
  relativePath: string,
  filename: string
): Promise<FileDiscoveryResult | null> => {
  const filePath = path.join(directory, filename);
  try {
    await fs.stat(filePath);
    return { filePath, relativePath };
  } catch {
    return null;
  }
};

/**
 * Recursively find SKILL.md files in a directory.
 *
 * The base directory itself is checked first: a SKILL.md placed at the root
 * of a discovery root is returned with `relativePath = ""` and wins the
 * shadowing tie-break over same-name skills in subdirectories (first found
 * wins in `discoverAllSkills`).
 *
 * The traversal is delegated to the shared {@link walkDir} utility, which
 * owns hidden-dir / `node_modules` / `.git` skip rules and per-entry error
 * isolation. The visitor only checks each directory entry for SKILL.md and
 * records the labeled result; recursion and skip semantics are the walker's
 * job, not this function's.
 *
 * Output is sorted by `relativePath` so callers see a stable order across
 * runs regardless of the underlying `readdir` enumeration order.
 */
export const findSkillsRecursive = async (
  baseDir: string,
  label: SkillLabel,
  maxDepth: number = 3
): Promise<LabeledDiscoveryResult[]> => {
  const results: LabeledDiscoveryResult[] = [];

  try {
    await fs.access(baseDir);
    // Check the baseDir itself before walking its entries so a root-level
    // SKILL.md is discovered and naturally wins the first-found-wins tie-break.
    const rootFile = await findFile(baseDir, '', 'SKILL.md');
    if (rootFile) {
      results.push({ ...rootFile, label });
    }

    await walkDir(baseDir, maxDepth, async (entry) => {
      if (!entry.isDirectory()) return;
      const fullPath = path.join(entry.parentPath, entry.name);
      const relPath = path.relative(baseDir, fullPath);
      const found = await findFile(fullPath, relPath, 'SKILL.md');
      if (found) {
        results.push({ ...found, label });
      }
    });
  } catch (error) {
    debugLog("findSkillsRecursive: cannot access baseDir", baseDir, error);
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

/**
 * Default recursion depth for the four priority discovery roots.
 *
 * Pre-refactor commit `c2d8e74` used `maxDepth: 1` for the Claude-side
 * roots; commit `12de52a` ("fix(core): unify maxDepth to 3 across all
 * discovery roots") widened them deliberately so deeply-nested Claude
 * skills surface. The regression net in
 * `tests/integration/skill-discovery.test.ts` pins this value so a
 * future narrowing breaks loudly.
 */
const DEFAULT_DISCOVERY_MAX_DEPTH = 3;

/**
 * Default discovery roots matching the pre-refactor OpenCode priority order
 * (see commit `c2d8e74`, `src/skills.ts#discoverAllSkills`):
 *   1. .opencode/skills/         (project - OpenCode)
 *   2. .claude/skills/           (project - Claude)
 *   3. ~/.config/opencode/skills/ (user - OpenCode)
 *   4. ~/.claude/skills/         (user - Claude)
 *
 * No shadowing - unique names only. First match wins, duplicates are warned.
 */
export const getDefaultOpencodeRoots = (directory: string): DiscoveryPath[] => {
  return [
    { path: path.join(directory, '.opencode', 'skills'), label: 'project', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH },
    { path: path.join(directory, '.claude', 'skills'), label: 'claude-project', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH },
    { path: path.join(homedir(), '.config', 'opencode', 'skills'), label: 'user', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH },
    { path: path.join(homedir(), '.claude', 'skills'), label: 'claude-user', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH }
  ];
};

/**
 * Default callback for shadowed skill names. Emits a `console.warn` that
 * identifies the surviving (existing) skill and the duplicate that was
 * skipped. Hosts can override by passing `onDuplicate` to `discoverAllSkills`.
 *
 * @internal - exported for testing
 */
export const defaultOnDuplicate = (
  existing: Skill,
  duplicate: Skill
): void => {
  console.warn(
    `Skill name conflict: '${existing.name}' at ${existing.path} shadows duplicate at ${duplicate.path}`
  );
};

/**
 * Discover all skills from the provided roots.
 *
 * @param directory - Project directory (used to build the default roots).
 * @param roots - Discovery roots. Defaults to the OpenCode priority order
 *   via `getDefaultOpencodeRoots(directory)`. Hosts pass an explicit list to
 *   override the layout.
 * @param onDuplicate - Optional callback invoked when two roots produce a
 *   skill with the same `name`. Defaults to `console.warn` via
 *   `defaultOnDuplicate`. The first-discovered skill wins; the duplicate
 *   (second one encountered) is passed to the callback but never stored.
 */
export const discoverAllSkills = async (
  directory: string,
  roots: DiscoveryPath[] = getDefaultOpencodeRoots(directory),
  onDuplicate: (existing: Skill, duplicate: Skill) => void = defaultOnDuplicate
): Promise<Map<string, Skill>> => {
  const allResults: LabeledDiscoveryResult[] = [];
  for (const { path: baseDir, label, maxDepth } of roots) {
    allResults.push(...await findSkillsRecursive(baseDir, label, maxDepth));
  }

  const skillsByName = new Map<string, Skill>();
  for (const { filePath, relativePath, label } of allResults) {
    const skill = await parseSkillFile(filePath, relativePath, label);
    if (!skill) continue;
    if (skillsByName.has(skill.name)) {
      onDuplicate(skillsByName.get(skill.name)!, skill);
      continue;
    }
    skillsByName.set(skill.name, skill);
  }

  return skillsByName;
};

/**
 * Resolve a skill by name, handling namespace prefixes.
 * Supports: "skill-name", "project:skill-name", "user:skill-name", etc.
 */
export const resolveSkill = (
  skillName: string,
  skillsByName: Map<string, Skill>
): Skill | null => {
  if (skillName.includes(':')) {
    const [namespace, name] = skillName.split(':');
    for (const skill of skillsByName.values()) {
      if (skill.name === name && (skill.label === namespace || skill.namespace === namespace)) {
        return skill;
      }
    }
    return null;
  }
  return skillsByName.get(skillName) || null;
};

/**
 * Recursively list all files in a directory, returning relative paths.
 * Excludes SKILL.md since it's already loaded as the main content.
 * Applies the same skip rules as walkDir (hidden dirs, node_modules, .git).
 */
export const listSkillFiles = async (skillPath: string, maxDepth: number = 3): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(skillPath, fullPath);

      if (entry.name === "SKILL.md") continue;

      if (entry.isDirectory()) {
        if (depth < maxDepth) {
          await walk(fullPath, depth + 1);
        }
      } else {
        files.push(relPath);
      }
    }
  };

  await walk(skillPath, 0);
  return files.sort();
};

/**
 * Get summaries of all available skills (name, description, trigger).
 * Used by preflight LLM call to evaluate which skills are relevant and
 * by the plugin's keyword matcher to rank matched skills.
 *
 * The `trigger` frontmatter key (PR 2 of `trigger-aware-skill-discovery`)
 * is threaded through so the keyword matcher can apply the 1.5x trigger
 * tier and the targeted outputs can render trigger text.
 *
 * @param directory - Project directory to discover skills from
 * @returns Array of skill summaries
 */
export const getSkillSummaries = async (directory: string): Promise<Array<{ name: string; description: string; trigger?: string }>> => {
  const skillsByName = await discoverAllSkills(directory);
  return Array.from(skillsByName.values()).map(skill => ({
    name: skill.name,
    description: skill.description,
    trigger: skill.trigger,
  }));
};
