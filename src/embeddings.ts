/**
 * Semantic embeddings matcher using @huggingface/transformers.
 *
 * Mirrors upstream opencode-agent-skills/src/embeddings.ts behaviour:
 * - Lazy model loading on first match() call
 * - Real semantic similarity via transformer embeddings
 * - Disk caching of embeddings (XDG_CACHE_HOME or ~/.cache/opencode-agent-skills/embeddings/)
 * - Fuzzy fallback when model is unavailable
 * - Keyword + semantic hybrid ranking
 */
import { env, pipeline } from "@huggingface/transformers";
import type { Pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import type { Skill, SkillSummary } from "./types";
import { findClosestMatch } from "./match";
import { escapeRegex, tokenize, scoreSkill } from "./search";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";

export interface Matcher {
  match(query: string, skills: SkillSummary[]): Promise<SkillSummary[]>;
}

export interface EmbeddingsConfig {
  modelName?: string;
  hfEndpoint?: string;
}

interface ModelState {
  initialized: boolean;
  pipeline: FeatureExtractionPipeline | null;
  modelName: string;
}

const state: ModelState = {
  initialized: false,
  pipeline: null,
  modelName: "Xenova/all-MiniLM-L6-v2",
};

/**
 * Apply HF_ENDPOINT environment variable support.
 * Mirrors how Hugging Face Hub's HF_ENDPOINT is used in Python.
 */
export const applyHfEndpoint = (): void => {
  if (process.env.HF_ENDPOINT) {
    env.remoteHost = process.env.HF_ENDPOINT;
  }
};

/**
 * Get the embedding cache directory.
 * Uses XDG_CACHE_HOME if set, otherwise ~/.cache/opencode-agent-skills/embeddings/
 */
const getCacheDir = (): string => {
  const xdgCache = process.env.XDG_CACHE_HOME;
  if (xdgCache) {
    return path.join(xdgCache, "opencode-agent-skills", "embeddings");
  }
  return path.join(homedir(), ".cache", "opencode-agent-skills", "embeddings");
};

/**
 * Compute a hash key for a given text (used for cache filenames).
 */
const textToCacheKey = (text: string): string => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

/**
 * Get cached embedding for a given text.
 * Returns null if not in cache.
 */
const getCachedEmbedding = async (text: string): Promise<number[] | null> => {
  try {
    const cacheDir = getCacheDir();
    const cacheKey = textToCacheKey(text);
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);
    await fs.access(cachePath);
    const content = await fs.readFile(cachePath, "utf-8");
    return JSON.parse(content) as number[];
  } catch {
    return null;
  }
};

/**
 * Save embedding to disk cache.
 */
const saveEmbeddingToCache = async (text: string, embedding: number[]): Promise<void> => {
  try {
    const cacheDir = getCacheDir();
    await fs.mkdir(cacheDir, { recursive: true });
    const cacheKey = textToCacheKey(text);
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);
    await fs.writeFile(cachePath, JSON.stringify(embedding), "utf-8");
  } catch {
    // Cache write failure is non-fatal
  }
};

/**
 * Lazily initialize the transformer model.
 * Idempotent — calling multiple times is a no-op.
 * Times out after 3 seconds so the bag-of-words fallback is used.
 */
export const initializeModel = async (config?: EmbeddingsConfig): Promise<void> => {
  if (state.initialized) return;

  applyHfEndpoint();

  if (config?.modelName) {
    state.modelName = config.modelName;
  }

  try {
    // Timeout wrapper: fail fast so fallback is used
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Model initialization timed out")), 3000);
    });

    const initPromise = pipeline(
      "feature-extraction",
      state.modelName,
      {
        device: "cpu",
        dtype: "fp32",
      }
    ) as Promise<FeatureExtractionPipeline>;

    state.pipeline = await Promise.race([initPromise, timeoutPromise]);
    state.initialized = true;
  } catch (error) {
    console.error("[opencode-agent-skills-md] Failed to initialize embedding model:", error);
    state.pipeline = null;
    state.initialized = false;
  }
};

/**
 * Compute embedding for a single text using the transformer model.
 * Uses lazy initialization and disk caching.
 */
export const getEmbedding = async (text: string): Promise<number[] | null> => {
  if (!state.initialized) {
    await initializeModel();
  }

  if (!state.pipeline) {
    return null;
  }

  // Check cache first
  const cached = await getCachedEmbedding(text);
  if (cached) {
    return cached;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tensorResult = await state.pipeline(text, {
      pooling: "mean",
      normalize: true,
    });

    // Convert Tensor to number[][] — tolist() returns the tensor data as nested arrays
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (tensorResult as any).tolist ? (tensorResult as any).tolist() : tensorResult;

    // Result is typically [1, hidden_size] or [hidden_size]
    let embedding: number[];
    if (Array.isArray(result)) {
      embedding = Array.isArray(result[0]) ? (result[0] as number[]) : (result as number[]);
    } else {
      // It's a typed array (Float32Array or similar)
      embedding = Array.from(result as Iterable<number>);
    }

    // Save to cache asynchronously
    saveEmbeddingToCache(text, embedding).catch(() => {});

    return embedding;
  } catch (error) {
    console.error("[opencode-agent-skills-md] Failed to compute embedding:", error);
    return null;
  }
};

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
 * Precompute and cache embeddings for a list of skills.
 * Warms the disk cache for faster subsequent queries.
 */
export const precomputeSkillEmbeddings = async (
  skills: SkillSummary[]
): Promise<void> => {
  const texts = skills.map(
    (s) => `${s.name} ${s.description} ${s.trigger ?? ""}`.trim()
  );

  await Promise.all(
    texts.map(async (text) => {
      if (text.trim()) {
        await getEmbedding(text);
      }
    })
  );
};

// ---------------------------------------------------------------------------
// Legacy placeholder implementation (kept for fallback when model unavailable)
// ---------------------------------------------------------------------------

/**
 * Build a Skill-like shape for scoring (scoreSkill works on name/description/trigger).
 */
interface ScorableSkill {
  name: string;
  description: string;
  trigger?: string;
  tags: string[];
}

const toScorable = (s: SkillSummary): ScorableSkill => ({
  name: s.name,
  description: s.description,
  trigger: s.trigger,
  tags: [],
});

/**
 * Compute a vector embedding for text using simple bag-of-words.
 * PLACEHOLDER: used as fallback when no real model is available.
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
 * Semantic ranking using keyword scoring + transformer embeddings when available,
 * with bag-of-words fallback and fuzzy matching as ultimate fallback.
 */
const rankSkills = async (
  query: string,
  skills: SkillSummary[]
): Promise<SkillSummary[]> => {
  if (!query.trim() || skills.length === 0) return skills.slice(0, 5);

  const tokens = tokenize(query);
  if (tokens.length === 0) return skills.slice(0, 5);

  // Try real embeddings first
  const queryEmbedding = await getEmbedding(query);
  const useRealEmbeddings = queryEmbedding !== null;

  // Score each skill using keyword scoring as primary + semantic boost
  const scored = await Promise.all(
    skills.map(async (skill) => {
      const keywordScore = scoreSkill(toScorable(skill) as Skill, tokens);

      let semanticBoost = 0;
      if (useRealEmbeddings) {
        const combined = `${skill.name} ${skill.description} ${skill.trigger ?? ""}`.trim();
        const skillEmbedding = await getEmbedding(combined);
        if (skillEmbedding && queryEmbedding) {
          semanticBoost = cosineSimilarity(queryEmbedding, skillEmbedding);
        }
      } else {
        // Fallback: bag-of-words embedding
        const combined = `${skill.name} ${skill.description} ${skill.trigger ?? ""}`.trim();
        const bowEmbedding = computeEmbeddingPlaceholder(combined);
        const queryBow = computeEmbeddingPlaceholder(query);
        semanticBoost = cosineSimilarity(queryBow, bowEmbedding);
      }

      // Primary = keyword score (which already ranks name > trigger > desc).
      // Secondary = semantic boost (0–1 range scaled to small bonus).
      const score = keywordScore + semanticBoost * 10;

      return { skill, score };
    })
  );

  const filtered = scored.filter(({ score }) => score > 0);
  if (filtered.length === 0) return [];

  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, 5).map(({ skill }) => skill);
};

/**
 * Parity shim for upstream opencode-agent-skills: a direct matchSkills
 * entrypoint that delegates to createMatcher().match(). Preserves the
 * same return semantics — semantic-ranked SkillSummary list.
 */
export const matchSkills = async (
  query: string,
  skills: SkillSummary[],
): Promise<SkillSummary[]> => createMatcher().match(query, skills);

/**
 * Main entry point: create a Matcher instance.
 * Model loads lazily on first match() call.
 */
export const createMatcher = (): Matcher => ({
  match: async (query: string, skills: SkillSummary[]): Promise<SkillSummary[]> => {
    // Ensure model is initialized (lazy init — happens on first match)
    if (!state.initialized) {
      await initializeModel();
    }

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
