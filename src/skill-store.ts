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
  inflight: Promise<Map<string, Skill>> | null; // A3: dedup concurrent calls
  listFiles: Map<string, string[]>;             // C3b: cached file listings
  summaries: SkillSummary[];                     // C4: cached summaries
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
      if (cache?.inflight) {
        // A3: another call is already scanning — wait for it instead of starting a new scan
        debugLog("[skill-store] cache miss — waiting for in-flight scan");
        return cache.inflight;
      }
      debugLog("[skill-store] cache miss — scanning discovery roots");
      // Pass roots only if non-empty; otherwise discoverAllSkills uses its default roots
      let resolveInflight: (v: Map<string, Skill>) => void;
      let rejectInflight: (e: Error) => void;
      const inflight = new Promise<Map<string, Skill>>((resolve, reject) => {
        resolveInflight = resolve;
        rejectInflight = reject;
      });
      // Store the inflight promise BEFORE awaiting so concurrent callers see it
      if (cache) {
        cache.inflight = inflight;
      } else {
        cache = {
          skills: new Map(),
          timestamp: 0,
          inflight,
          listFiles: new Map(),
          summaries: [],
        };
      }
      try {
        const skillsByName = await discoverAllSkills(directory, roots.length > 0 ? roots : undefined);
        cache.skills = skillsByName;
        cache.timestamp = Date.now();
        resolveInflight!(skillsByName);
      } catch (err) {
        rejectInflight!(err instanceof Error ? err : new Error(String(err)));
      } finally {
        // A3: clear in-flight so next cache-miss triggers a fresh scan
        cache.inflight = null;
      }
    }
    return cache.skills;
  };

  return {
    async all(): Promise<Skill[]> {
      const m = await ensureCache();
      return Array.from(m.values());
    },

    async summaries(): Promise<SkillSummary[]> {
      // C4: return cached summaries if available
      if (cache?.summaries.length && !isExpired()) {
        return cache.summaries;
      }
      const m = await ensureCache();
      const summaries = Array.from(m.values()).map((s) => ({
        name: s.name,
        description: s.description,
        trigger: s.trigger,
      }));
      if (cache) cache.summaries = summaries;
      return summaries;
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
      // C3b: return cached listFiles if available (same TTL as discovery cache)
      if (cache?.listFiles.has(skillName) && !isExpired()) {
        return cache.listFiles.get(skillName)!;
      }
      const m = await ensureCache();
      const skill = m.get(skillName);
      if (!skill) {
        throw new Error(`Skill '${skillName}' not found`);
      }
      const files = await listSkillFiles(skill.path);
      if (cache) cache.listFiles.set(skillName, files);
      return files;
    },

    invalidate(): void {
      debugLog("[skill-store] cache invalidated");
      cache = undefined;
    },
  };
};
