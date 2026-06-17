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
import type {
  DiscoveryPath,
  FileDiscoveryResult,
  LabeledDiscoveryResult,
  Skill,
  SkillLabel,
} from "./types";
import { parseSkillFile } from "./parse";

/**
 * Check if a file exists in a directory and return path info.
 *
 * @param directory - Directory to check
 * @param relativePath - Relative path to use in result (caller-specific)
 * @param filename - Name of file to look for (e.g., 'SKILL.md')
 * @returns Path info if file exists, null otherwise
 */
export async function findFile(
  directory: string,
  relativePath: string,
  filename: string
): Promise<FileDiscoveryResult | null> {
  const filePath = path.join(directory, filename);
  try {
    await fs.stat(filePath);
    return { filePath, relativePath };
  } catch {
    return null;
  }
}

/**
 * Recursively find SKILL.md files in a directory.
 *
 * The base directory itself is checked first: a SKILL.md placed at the root
 * of a discovery root is returned with `relativePath = ""` and wins the
 * shadowing tie-break over same-name skills in subdirectories (first found
 * wins in `discoverAllSkills`).
 */
export async function findSkillsRecursive(
  baseDir: string,
  label: SkillLabel,
  maxDepth: number = 3
): Promise<LabeledDiscoveryResult[]> {
  const results: LabeledDiscoveryResult[] = [];

  async function recurse(dir: string, depth: number, relPath: string) {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (!stats.isDirectory()) continue;

        const newRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
        const found = await findFile(fullPath, newRelPath, 'SKILL.md');

        if (found) {
          results.push({ ...found, label });
        } else {
          await recurse(fullPath, depth + 1, newRelPath);
        }
      }
    } catch { }
  }

  try {
    await fs.access(baseDir);
    // Check the baseDir itself before recursing so a root-level SKILL.md is
    // discovered and naturally wins the first-found-wins tie-break.
    const rootFile = await findFile(baseDir, '', 'SKILL.md');
    if (rootFile) {
      results.push({ ...rootFile, label });
    }
    await recurse(baseDir, 0, '');
  } catch { }

  return results;
}

/**
 * Default discovery roots matching the legacy OpenCode priority order:
 *   1. .opencode/skills/        (project - OpenCode)
 *   2. .claude/skills/          (project - Claude)
 *   3. ~/.config/opencode/skills/ (user - OpenCode)
 *   4. ~/.claude/skills/        (user - Claude)
 *
 * No shadowing - unique names only. First match wins, duplicates are warned.
 */
export function getDefaultOpencodeRoots(directory: string): DiscoveryPath[] {
  return [
    { path: path.join(directory, '.opencode', 'skills'), label: 'project', maxDepth: 3 },
    { path: path.join(directory, '.claude', 'skills'), label: 'claude-project', maxDepth: 3 },
    { path: path.join(homedir(), '.config', 'opencode', 'skills'), label: 'user', maxDepth: 3 },
    { path: path.join(homedir(), '.claude', 'skills'), label: 'claude-user', maxDepth: 3 }
  ];
}

/**
 * Discover all skills from the provided roots.
 *
 * @param directory - Project directory (used to build the default roots).
 * @param roots - Discovery roots. Defaults to the OpenCode priority order
 *   via `getDefaultOpencodeRoots(directory)`. Hosts pass an explicit list to
 *   override the layout.
 */
export async function discoverAllSkills(
  directory: string,
  roots: DiscoveryPath[] = getDefaultOpencodeRoots(directory)
): Promise<Map<string, Skill>> {
  const allResults: LabeledDiscoveryResult[] = [];
  for (const { path: baseDir, label, maxDepth } of roots) {
    allResults.push(...await findSkillsRecursive(baseDir, label, maxDepth));
  }

  const skillsByName = new Map<string, Skill>();
  for (const { filePath, relativePath, label } of allResults) {
    const skill = await parseSkillFile(filePath, relativePath, label);
    if (!skill || skillsByName.has(skill.name)) continue;
    skillsByName.set(skill.name, skill);
  }

  return skillsByName;
}

/**
 * Resolve a skill by name, handling namespace prefixes.
 * Supports: "skill-name", "project:skill-name", "user:skill-name", etc.
 */
export function resolveSkill(
  skillName: string,
  skillsByName: Map<string, Skill>
): Skill | null {
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
}

/**
 * Recursively list all files in a directory, returning relative paths.
 * Excludes SKILL.md since it's already loaded as the main content.
 */
export async function listSkillFiles(skillPath: string, maxDepth: number = 3): Promise<string[]> {
  const files: string[] = [];

  async function recurse(dir: string, depth: number, relPath: string) {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const newRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        try {
          const stats = await fs.stat(fullPath);
          if (stats.isDirectory()) {
            await recurse(fullPath, depth + 1, newRelPath);
          } else if (stats.isFile() && entry.name !== 'SKILL.md') {
            files.push(newRelPath);
          }
        } catch { }
      }
    } catch { }
  }

  await recurse(skillPath, 0, '');
  return files.sort();
}

/**
 * Get summaries of all available skills (name + description only).
 * Used by preflight LLM call to evaluate which skills are relevant.
 *
 * @param directory - Project directory to discover skills from
 * @returns Array of skill summaries
 */
export async function getSkillSummaries(directory: string): Promise<Array<{ name: string; description: string }>> {
  const skillsByName = await discoverAllSkills(directory);
  return Array.from(skillsByName.values()).map(skill => ({
    name: skill.name,
    description: skill.description,
  }));
}
