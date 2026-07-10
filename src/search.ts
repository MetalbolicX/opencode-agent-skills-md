/**
 * Skill search and relevance ranking.
 *
 * Mirrors packages/core/src/search.ts behaviour.
 * Pure functions: no I/O, no host dependencies.
 */

import type { Skill } from "./types";
import { levenshtein } from "./match";

export const escapeRegex = (input: string): string => {
  return input.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
};

export const tokenize = (query: string): string[] => {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
};

export const keywordMatch = (skill: Skill, keywords: string[]): boolean => {
  if (keywords.length === 0) return true;
  const tags = skill.tags ?? [];
  return keywords.some((kw) => tags.includes(kw));
};

const similarity = (a: string, b: string): number => {
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
};

const bestDescriptionTokenSim = (descLower: string, token: string): number => {
  let best = 0;
  for (const dt of descLower.split(/\s+/)) {
    if (dt.length === 0) continue;
    const sim = similarity(dt, token);
    if (sim > best) best = sim;
  }
  return best;
};

export const scoreSkill = (skill: Skill, tokens: string[]): number => {
  if (tokens.length === 0) return 0;
  const name = skill.name.toLowerCase();
  const desc = skill.description.toLowerCase();
  const trigger = skill.trigger?.toLowerCase() ?? "";

  const descTier = tokens.every((t) => desc.includes(t)) ? 50 : 30;

  const perToken: number[] = [];
  for (const token of tokens) {
    let s = 0;

    if (name === token) {
      s = Math.max(s, 100);
    } else if (name.startsWith(token)) {
      s = Math.max(s, 90);
    } else {
      const nameSim = similarity(name, token);
      if (nameSim > 0.4) s = Math.max(s, 70 * nameSim);
    }

    if (trigger.length > 0 && trigger.includes(token)) {
      s = Math.max(s, 60);
    }

    if (desc.includes(token)) {
      s = Math.max(s, descTier);
    } else {
      const descSim = bestDescriptionTokenSim(desc, token);
      if (descSim > 0.4) s = Math.max(s, Math.min(60, 60 * descSim));
    }

    if (s === 0) return 0;
    perToken.push(s);
  }

  const max = Math.max(...perToken);
  const sum = perToken.reduce((a, b) => a + b, 0);
  return max + 0.1 * sum;
};

export const searchSkills = (
  skills: Skill[],
  query: string,
  keywords?: string[]
): Skill[] => {
  let candidates: Skill[] = skills;

  if (keywords && keywords.length > 0) {
    candidates = candidates.filter((s) => keywordMatch(s, keywords!));
  }

  if (!query || query.trim() === "") {
    return candidates;
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return candidates;
  }

  const scored = candidates
    .map((skill) => ({ skill, score: scoreSkill(skill, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ skill }) => skill);
};
