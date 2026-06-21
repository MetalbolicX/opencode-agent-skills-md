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
export declare function escapeRegex(input: string): string;
/**
 * Tokenize a free-text query into lowercase, non-empty tokens.
 *
 * Whitespace is the only separator. Empty tokens (from leading or
 * trailing whitespace) are dropped so the caller never has to filter
 * them out before scoring.
 */
export declare function tokenize(query: string): string[];
/**
 * Check whether a skill matches at least one of the supplied keywords
 * against its `metadata.tags`. OR semantics: a single tag hit is enough
 * to keep the skill in the result set. An empty keyword list is a no-op
 * (every skill passes).
 */
export declare function keywordMatch(skill: Skill, keywords: string[]): boolean;
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
export declare function scoreSkill(skill: Skill, tokens: string[]): number;
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
export declare function searchSkills(skills: Skill[], query: string, keywords?: string[]): Skill[];
