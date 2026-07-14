/**
 * Cached skill discovery repository.
 *
 * Scans all discovery roots once, caches with configurable TTL,
 * exposes collection interface for tools and plugin hooks.
 */

import type { DiscoveryPath, Skill, SkillStore as ISkillStore, SkillSummary } from "./types";
import { discoverAllSkills, listSkillFiles } from "./skills";
import { findClosestMatch } from "./match";
import { searchSkills } from "./search";
import { debugLog } from "./log";

const DEFAULT_CACHE_TTL_MS = 5 * 1000; // 5 seconds

interface CacheEntry {
  skills: Map<string, Skill>;
  timestamp: number;
}

/**
 * Creates a SkillStore instance scoped to a working directory.
 * The store manages a TTL cache of discovered skills and exposes
 * resolve/search/summaries/all/invalidate methods.
 */
export const createSkillStore = (
  directory: string,
  roots: DiscoveryPath[] = [],
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): ISkillStore => {
  let cache: CacheEntry | undefined;

  const isExpired = (): boolean => {
    if (!cache) return true;
    return Date.now() - cache.timestamp > ttlMs;
  };

  const ensureCache = async (): Promise<Map<string, Skill>> => {
    if (!cache || isExpired()) {
      debugLog("[skill-store] cache miss — scanning discovery roots");
      // Pass roots only if non-empty; otherwise discoverAllSkills uses its default roots
      const skillsByName = await discoverAllSkills(directory, roots.length > 0 ? roots : undefined);
      cache = { skills: skillsByName, timestamp: Date.now() };
    }
    return cache.skills;
  };

  return {
    async all(): Promise<Skill[]> {
      const m = await ensureCache();
      return Array.from(m.values());
    },

    async summaries(): Promise<SkillSummary[]> {
      const m = await ensureCache();
      return Array.from(m.values()).map((s) => ({
        name: s.name,
        description: s.description,
        trigger: s.trigger,
      }));
    },

    async search(query: string, keywords?: string[]): Promise<Skill[]> {
      const all = await this.all();
      return searchSkills(all, query, keywords);
    },

    async resolve(name: string): Promise<Skill> {
      const m = await ensureCache();

      // 1. Exact name match
      const exact = m.get(name);
      if (exact) return exact;

      // 2. Suffix match — find all skills whose path ends with the name
      const matches: Skill[] = [];
      for (const skill of m.values()) {
        if (skill.name === name || skill.path.endsWith(name) || skill.relativePath.endsWith(name)) {
          matches.push(skill);
        }
      }

      if (matches.length === 1) {
        return matches[0]!;
      }

      if (matches.length > 1) {
        const candidates = matches.map((s) => s.path).join(", ");
        throw new Error(`Ambiguous skill name '${name}' — multiple candidates: ${candidates}`);
      }

      // 3. findClosestMatch fallback
      const allNames = Array.from(m.keys());
      const closest = findClosestMatch(name, allNames);
      if (closest) {
        const matched = m.get(closest);
        if (matched) return matched;
      }

      throw new Error(`Skill '${name}' not found`);
    },

    async listFiles(skillName: string): Promise<string[]> {
      const m = await ensureCache();
      const skill = m.get(skillName);
      if (!skill) {
        throw new Error(`Skill '${skillName}' not found`);
      }
      return listSkillFiles(skill.path);
    },

    invalidate(): void {
      debugLog("[skill-store] cache invalidated");
      cache = undefined;
    },
  };
};
