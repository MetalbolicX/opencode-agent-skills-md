/**
 * Semantic embeddings matcher for agent skills.
 *
 * Mirrors upstream opencode-agent-skills/src/embeddings.ts behaviour:
 * - Bag-of-words embeddings for semantic similarity (no ONNX dependency)
 * - Fuzzy fallback when embeddings are unavailable
 * - Keyword + semantic hybrid ranking
 *
 * The ONNX transformer path has been removed because the model cache
 * corruption issue (Protobuf parsing failed) cannot be reliably fixed
 * at the dependency level, and the bag-of-words fallback produces
 * acceptable matching quality for the plugin's use case.
 */
import type { Skill, SkillSummary } from "./types";
import { findClosestMatch } from "./match";
import { escapeRegex, tokenize, scoreSkill } from "./search";

export interface Matcher {
  match(query: string, skills: SkillSummary[]): Promise<SkillSummary[]>;
}

export interface EmbeddingsConfig {
  modelName?: string;
  hfEndpoint?: string;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if vectors have zero magnitude or different lengths.
 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

/**
 * Build a Skill-like shape for scoring (scoreSkill works on name/description/trigger).
 * The `tags` field is intentionally seeded with an empty array because
 * `scoreSkill` does not use tags for scoring — only name, description, and trigger.
 */
interface ScorableSkill {
  name: string;
  description: string;
  trigger?: string;
  tags: string[];
}

/** Adapt a SkillSummary (name + description + trigger) to the ScorableSkill shape. */
const toScorable = (s: SkillSummary): ScorableSkill => ({
  name: s.name,
  description: s.description,
  trigger: s.trigger,
  tags: [],
});

/**
 * Compute a vector embedding for text using simple bag-of-words.
 * Returns a 128-dim vector based on word hashes.
 */
const computeEmbeddingPlaceholder = (text: string): number[] => {
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const vector = new Array(128).fill(0);
  for (const word of words) {
    const hash = simpleHash(word);
    vector[hash % 128] = (vector[hash % 128] ?? 0) + 1;
  }
  return vector;
};

const simpleHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
};

/**
 * Semantic ranking: keyword scoring (primary) + bag-of-words cosine-similarity boost.
 *
 * Scoring formula: `score = keywordScore + semanticBoost * 10`
 * - keywordScore: max(per-token) + 0.1 * sum(per-token) from `scoreSkill`
 * - semanticBoost: 0–1 cosine similarity between query BoW and (name+desc+trigger) BoW
 *
 * The keyword score dominates; semantic boost is a small additive bonus.
 * Results are capped at top-5 and only returned if score > 0.
 */
const rankSkills = async (
  query: string,
  skills: SkillSummary[]
): Promise<SkillSummary[]> => {
  if (!query.trim() || skills.length === 0) return skills.slice(0, 5);

  const tokens = tokenize(query);
  if (tokens.length === 0) return skills.slice(0, 5);

  // Score each skill using keyword scoring as primary + semantic boost
  const scored = skills.map((skill) => {
    const keywordScore = scoreSkill(toScorable(skill), tokens);

    const combined = `${skill.name} ${skill.description} ${skill.trigger ?? ""}`.trim();
    const bowEmbedding = computeEmbeddingPlaceholder(combined);
    const queryBow = computeEmbeddingPlaceholder(query);
    const semanticBoost = cosineSimilarity(queryBow, bowEmbedding);

    // Primary = keyword score (which already ranks name > trigger > desc).
    // Secondary = semantic boost (0–1 range scaled to small bonus).
    const score = keywordScore + semanticBoost * 10;

    return { skill, score };
  });

  const filtered = scored.filter(({ score }) => score > 0);
  if (filtered.length === 0) return [];

  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, 5).map(({ skill }) => skill);
};

/**
 * Main entry point: create a Matcher instance.
 */
export const createMatcher = (): Matcher => ({
  match: async (query: string, skills: SkillSummary[]): Promise<SkillSummary[]> => {
    if (!query.trim()) {
      return skills.slice(0, 5);
    }

    const ranked = await rankSkills(query, skills);

    // If semantic ranking returned nothing or very few, apply fuzzy fallback
    if (ranked.length === 0) {
      const names = skills.map((s) => s.name);
      const fuzzyMatch = findClosestMatch(query, names);
      if (fuzzyMatch) {
        const matched = skills.find((s) => s.name === fuzzyMatch);
        if (matched) return [matched];
      }
    }

    return ranked;
  },
});

/**
 * Parity shim for upstream opencode-agent-skills: a direct matchSkills
 * entrypoint that delegates to createMatcher().match(). Preserves the
 * same return semantics — semantic-ranked SkillSummary list.
 */
export const matchSkills = async (
  query: string,
  skills: SkillSummary[],
): Promise<SkillSummary[]> => createMatcher().match(query, skills);
