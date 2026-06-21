/**
 * Skill search and relevance ranking.
 *
 * Pure functions: no I/O, no host dependencies. Consumers pass in a list
 * of `Skill` objects (already discovered by `core/discovery.ts`) and a
 * free-text query plus an optional tag-keyword filter, and get back the
 * same skills sorted by relevance.
 *
 * Scoring model (mirrors the design doc):
 *
 *   - name exact                = 100
 *   - name prefix               = 90
 *   - name fuzzy (sim > 0.4)    = 70 * sim
 *   - trigger substring         = 60
 *   - description ALL tokens    = 50  (bonus, added on top of per-token max+sum)
 *   - description ANY token     = 30
 *   - description fuzzy (best)  = 60 * sim (capped at 60)
 *
 * For multi-token queries, every token MUST contribute (AND across
 * tokens). The final score is `max(per-token) + 0.1 * sum(per-token)`.
 *
 * `escapeRegex` lets callers treat the user query as a literal
 * substring without leaking the regex engine into a crash on
 * unbalanced parentheses, plus signs, etc.
 */

import type { Skill } from "./types";
import { levenshtein } from "./match";

/**
 * Escape every regex metacharacter in the input so the result is safe
 * to embed in a `new RegExp(...)` call or treat as a literal substring.
 *
 * The escape set is intentionally defensive: it covers every character
 * that the JS regex parser treats as syntax (`.*+?^${}()|[]\`) plus the
 * hyphen, which is only a metacharacter inside a character class but is
 * cheap to escape and avoids a footgun if the caller composes the
 * result into a character class later.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

/**
 * Tokenize a free-text query into lowercase, non-empty tokens.
 *
 * Whitespace is the only separator. Empty tokens (from leading or
 * trailing whitespace) are dropped so the caller never has to filter
 * them out before scoring.
 */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Check whether a skill matches at least one of the supplied keywords
 * against its `metadata.tags`. OR semantics: a single tag hit is enough
 * to keep the skill in the result set. An empty keyword list is a no-op
 * (every skill passes).
 */
export function keywordMatch(skill: Skill, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const tags = skill.tags ?? [];
  return keywords.some((kw) => tags.includes(kw));
}

/** Compute a Levenshtein-derived similarity in the 0..1 range. */
function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Best description-token fuzzy similarity for a single query token. */
function bestDescriptionTokenSim(descLower: string, token: string): number {
  let best = 0;
  for (const dt of descLower.split(/\s+/)) {
    if (dt.length === 0) continue;
    const sim = similarity(dt, token);
    if (sim > best) best = sim;
  }
  return best;
}

/**
 * Score a skill against a list of pre-tokenized, lowercase query
 * tokens. Returns 0 when the skill has no chance of matching (used to
 * drop it from the result). Positive scores compare higher = more
 * relevant.
 *
 * The "description contains ALL tokens" tier (50) is applied as a
 * per-token lift, not a flat bonus, so the ordering
 *   name exact > name prefix > name fuzzy > trigger > desc-all > desc-any
 * is preserved even after the `max + 0.1 * sum` multi-token formula.
 *
 * The `trigger` tier (60) is a flat per-token contribution: any token
 * that appears as a case-insensitive substring of `skill.trigger` adds
 * 60 to that token's contribution. Trigger is sandwiched between the
 * name tiers (≥70) and the description tiers (≤50) so the invariant
 *   name > trigger > description
 * holds for single-token queries.
 */
export function scoreSkill(skill: Skill, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const name = skill.name.toLowerCase();
  const desc = skill.description.toLowerCase();
  const trigger = skill.trigger?.toLowerCase() ?? "";

  // When every token appears in the description, each per-token
  // description contribution is lifted from 30 (ANY) to 50 (ALL).
  const descTier = tokens.every((t) => desc.includes(t)) ? 50 : 30;

  // Per-token contribution. We pick the strongest tier for each token,
  // then require every token to contribute (AND across tokens). The
  // first token that contributes nothing forces the whole score to 0.
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

    if (s === 0) return 0; // AND: this token cannot be satisfied.
    perToken.push(s);
  }

  const max = Math.max(...perToken);
  const sum = perToken.reduce((a, b) => a + b, 0);
  return max + 0.1 * sum;
}

/**
 * Filter, score, and rank skills against a free-text query and an
 * optional tag-keyword filter. The keyword filter applies first
 * (it is the cheaper predicate and can only narrow the candidate
 * set), then the query is tokenized and scored.
 *
 * Returns a new array sorted by score descending. Skills with a score
 * of 0 are dropped. When the query is empty AND no keywords are
 * supplied, the input list is returned unchanged (the caller can use
 * the unranked discovery for browsing).
 */
export function searchSkills(
  skills: Skill[],
  query: string,
  keywords?: string[]
): Skill[] {
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
}