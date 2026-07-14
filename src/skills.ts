/**
 * Skill discovery across filesystem roots.
 *
 * Mirrors packages/core/src/discovery.ts behaviour.
 * In the single-package Bun layout, this module owns discovery order,
 * duplicate handling, SKILL.md parsing, and skill summary generation.
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
import { walkDir } from "./fs-walk";
import { debugLog } from "./log";
import { discoverPluginCacheSkills, discoverMarketplaceSkills } from "./claude";

export { parseSkillFile } from "./parse";
export { findClosestMatch } from "./match";
export { searchSkills } from "./search";

/**
 * Check if SKILL.md exists in a directory and return path info.
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
 * Output is sorted by relativePath for stable ordering.
 */
export const findSkillsRecursive = async (
  baseDir: string,
  label: SkillLabel,
  maxDepth: number = 3
): Promise<LabeledDiscoveryResult[]> => {
  const results: LabeledDiscoveryResult[] = [];

  try {
    await fs.access(baseDir);
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

const DEFAULT_DISCOVERY_MAX_DEPTH = 3;

/**
 * Default discovery roots matching the pre-refactor OpenCode priority order.
 */
export const getDefaultOpencodeRoots = (directory: string): DiscoveryPath[] => {
  return [
    { path: path.join(directory, '.opencode', 'skills'), label: 'project', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH },
    { path: path.join(directory, '.claude', 'skills'), label: 'claude-project', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH },
    { path: path.join(homedir(), '.config', 'opencode', 'skills'), label: 'user', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH },
    { path: path.join(homedir(), '.claude', 'skills'), label: 'claude-user', maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH }
  ];
};

export const defaultOnDuplicate = (
  existing: Skill,
  duplicate: Skill
): void => {
  console.warn(
    `Skill name conflict: '${existing.name}' at ${existing.path} shadows duplicate at ${duplicate.path}`
  );
};

export const discoverAllSkills = async (
  directory: string,
  roots: DiscoveryPath[] = getDefaultOpencodeRoots(directory),
  onDuplicate: (existing: Skill, duplicate: Skill) => void = defaultOnDuplicate
): Promise<Map<string, Skill>> => {
  const allResults: LabeledDiscoveryResult[] = [];
  for (const { path: baseDir, label, maxDepth } of roots) {
    allResults.push(...await findSkillsRecursive(baseDir, label, maxDepth));
  }

  // 6-root discovery: add plugin cache and marketplace
  allResults.push(...await discoverPluginCacheSkills());
  allResults.push(...await discoverMarketplaceSkills());

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
 * Recursively list all files in a skill directory, excluding SKILL.md.
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

// Re-export renderSkillPreflightBlock for plugin.ts consumption
export { renderSkillPreflightBlock } from "./preference";

// Re-export formatting helpers for consumers that still import from skills.ts
export { renderAvailableSkillsBlock } from "./preference";

/**
 * Get summaries of all available skills.
 */
export const getSkillSummaries = async (directory: string): Promise<Array<{ name: string; description: string; trigger?: string }>> => {
  const skillsByName = await discoverAllSkills(directory);
  return Array.from(skillsByName.values()).map(skill => ({
    name: skill.name,
    description: skill.description,
    trigger: skill.trigger,
  }));
};
