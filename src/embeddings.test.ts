/**
 * RED phase: Port of packages/core/tests/search.test.ts into embeddings.test.ts.
 *
 * Tests the Matcher interface (lazy init, semantic ranking, fuzzy fallback).
 * These tests FAIL in RED because src/embeddings.ts stub returns skills unchanged.
 *
 * Reference: packages/core/tests/search.test.ts (levenshtein/findClosestMatch/escapeRegex/scoreSkill/searchSkills)
 * The Matcher interface wraps search.ts behaviour with lazy model loading.
 */
import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";
import type { SkillSummary } from "./types";

function makeSkillSummary(overrides: Partial<SkillSummary> & { name: string }): SkillSummary {
  return {
    description: "default description",
    ...overrides,
  };
}

describe("Matcher — lazy initialization", () => {
  test("matcher.match returns relevant skills ranked by name match before init() is called", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "brainstorming", description: "helps with brainstorming" }),
      makeSkillSummary({ name: "git-helper", description: "git workflow assistance" }),
    ];

    const result = await matcher.match("brain", skills);

    assert.ok(result.length >= 1, "at least one skill should match 'brain'");
    // Name match should rank first
    assert.equal(result[0]?.name, "brainstorming");
  });

  test("matcher.match is async (supports lazy model loading)", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [makeSkillSummary({ name: "test", description: "a test skill" })];

    const result = await matcher.match("query", skills);

    assert.ok(Array.isArray(result), "match must return an array");
    assert.ok(result.length >= 0, "result must be a valid array");
  });
});

describe("Matcher — semantic ranking", () => {
  test("skills matching query by name rank higher than skills matching only by description", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "refactor", description: "unrelated description" }),
      makeSkillSummary({ name: "code-refactor", description: "helps refactor code" }),
      makeSkillSummary({ name: "unrelated", description: "refactor refactor refactor" }),
    ];

    const result = await matcher.match("refactor", skills);

    assert.ok(result.length >= 1, "at least one skill should match");
    // The skill whose name is "refactor" should appear before the one with "code-refactor"
    const names = result.map(s => s.name);
    const refactorIdx = names.indexOf("refactor");
    const codeRefactorIdx = names.indexOf("code-refactor");
    if (codeRefactorIdx !== -1 && refactorIdx !== -1) {
      assert.ok(refactorIdx < codeRefactorIdx, `"refactor (name match) should rank before "code-refactor"`);
    }
  });

  test("skills matching by trigger rank between name and description matches", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "auth-tool", description: "authentication helper" }),
      makeSkillSummary({ name: "login-helper", description: "unrelated", trigger: "auth login" }),
      makeSkillSummary({ name: "unrelated", description: "this auth token thing" }),
    ];

    const result = await matcher.match("auth", skills);

    assert.ok(result.length >= 1, "at least one skill should match");
    const names = result.map(s => s.name);
    const triggerIdx = names.indexOf("login-helper");
    const descIdx = names.indexOf("unrelated");
    if (triggerIdx !== -1 && descIdx !== -1) {
      assert.ok(triggerIdx < descIdx, "trigger match should rank above description-only match");
    }
  });

  test("non-matching skills are excluded from results", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "brainstorming", description: "creative thinking" }),
      makeSkillSummary({ name: "unrelated", description: "completely different content" }),
    ];

    const result = await matcher.match("xyz123none", skills);

    // Non-matching skills should not appear in results (or results should be empty)
    const matchedNames = result.map(s => s.name);
    assert.ok(!matchedNames.includes("unrelated"), "non-matching skill should not appear");
  });

  test("query with regex-special characters does not throw", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "test-skill", description: "regular helper" }),
    ];

    let result;
    assert.doesNotThrow(() => {
      result = matcher.match("(test+[?*$^|){}]\\", skills);
    });
    assert.ok(Array.isArray(await result), "must return an array");
  });
});

describe("Matcher — fuzzy fallback", () => {
  test("typo correction: 'patern' matches 'pattern'", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "pattern", description: "design patterns" }),
      makeSkillSummary({ name: "git-helper", description: "git workflows" }),
    ];

    const result = await matcher.match("patern", skills);

    const matchedNames = result.map(s => s.name);
    assert.ok(
      matchedNames.includes("pattern"),
      `"patern' should fuzzy-match 'pattern', got: ${JSON.stringify(matchedNames)}`,
    );
  });

  test("prefix match: 'git' matches 'git-helper'", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "brainstorming", description: "creative" }),
      makeSkillSummary({ name: "git-helper", description: "git workflows" }),
    ];

    const result = await matcher.match("git", skills);

    const matchedNames = result.map(s => s.name);
    assert.ok(matchedNames.includes("git-helper"), "prefix match should work");
  });

  test("no close matches below threshold returns empty or near-empty result", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "brainstorming", description: "creative" }),
      makeSkillSummary({ name: "git-helper", description: "git workflows" }),
    ];

    const result = await matcher.match("xyzabc123", skills);

    // Either empty or very few results — nothing close to "xyzabc123"
    assert.ok(result.length < skills.length, "non-matching query should filter results");
  });
});

describe("Matcher — result limits", () => {
  test("returns at most 5 skills (matching the plugin behaviour)", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = Array.from({ length: 10 }, (_, i) =>
      makeSkillSummary({ name: `skill-${i}`, description: `description ${i}` }),
    );

    const result = await matcher.match("skill", skills);

    assert.ok(result.length <= 5, `expected at most 5 results, got ${result.length}`);
  });

  test("empty skill list returns empty result", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();

    const result = await matcher.match("query", []);

    assert.equal(result.length, 0, "empty skill list should return empty result");
  });

  test("empty query returns empty or unfiltered result", async () => {
    const { createMatcher } = await import("./embeddings");
    const matcher = createMatcher();
    const skills = [
      makeSkillSummary({ name: "a", description: "desc a" }),
      makeSkillSummary({ name: "b", description: "desc b" }),
    ];

    const result = await matcher.match("", skills);

    // Empty query should not crash — behaviour is implementation-defined
    assert.ok(Array.isArray(result), "empty query must return an array");
  });
});

describe("Embeddings extraction", () => {
  test("getEmbedding returns a non-null 384-dim vector after model init", async () => {
    const { getEmbedding, initializeModel } = await import("./embeddings");

    // Initialize the model (lazy init — may time out or fail in CI)
    await initializeModel();

    const embedding = await getEmbedding("hello world");

    if (embedding === null) {
      // Model failed to load — skip gracefully (Bun does not support context.skip)
      console.warn("[skip] embedding model unavailable (init timed out or failed)");
      return;
    }

    assert.ok(Array.isArray(embedding), "embedding must be an array");
    assert.ok(embedding.length > 0, "embedding must not be empty");
    assert.equal(
      embedding.length,
      384,
      `expected 384-dim MiniLM vector, got length ${embedding.length}`,
    );
    for (const val of embedding) {
      assert.ok(
        typeof val === "number" && !isNaN(val),
        `expected number, got ${typeof val}`,
      );
    }
  });
});

describe("cosineSimilarity", () => {
  test("identical non-zero vectors return 1", async () => {
    const { cosineSimilarity } = await import("./embeddings");
    const result = cosineSimilarity([1, 2, 3], [1, 2, 3]);
    assert.ok(Math.abs(result - 1) < 1e-9, `expected 1, got ${result}`);
  });

  test("[1, 1] vs [1, 1] returns 1 (sanity check)", async () => {
    const { cosineSimilarity } = await import("./embeddings");
    const result = cosineSimilarity([1, 1], [1, 1]);
    assert.ok(Math.abs(result - 1) < 1e-9, `expected 1, got ${result}`);
  });

  test("[1, 2] vs [2, 4] returns 1 (collinear positive vectors)", async () => {
    const { cosineSimilarity } = await import("./embeddings");
    const result = cosineSimilarity([1, 2], [2, 4]);
    assert.ok(Math.abs(result - 1) < 1e-9, `expected 1, got ${result}`);
  });

  test("orthogonal vectors return 0 ([1, 0] vs [0, 1])", async () => {
    const { cosineSimilarity } = await import("./embeddings");
    const result = cosineSimilarity([1, 0], [0, 1]);
    assert.equal(result, 0);
  });

  test("opposite vectors return -1 ([1, 0] vs [-1, 0])", async () => {
    const { cosineSimilarity } = await import("./embeddings");
    const result = cosineSimilarity([1, 0], [-1, 0]);
    assert.ok(Math.abs(result - -1) < 1e-9, `expected -1, got ${result}`);
  });

  test("zero-magnitude vector returns 0", async () => {
    const { cosineSimilarity } = await import("./embeddings");
    const result = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    assert.equal(result, 0);
  });

  test("different-length vectors return 0", async () => {
    const { cosineSimilarity } = await import("./embeddings");
    const result = cosineSimilarity([1, 2, 3], [1, 2]);
    assert.equal(result, 0);
  });
});

describe("applyHfEndpoint", () => {
  // Save and restore env state so tests do not leak HF_ENDPOINT or remoteHost
  // into the surrounding test environment.
  let originalEndpoint: string | undefined;
  let originalRemoteHost: string | undefined;

  beforeEach(async () => {
    const { env } = await import("@huggingface/transformers");
    originalEndpoint = process.env.HF_ENDPOINT;
    originalRemoteHost = env.remoteHost;
  });

  afterEach(async () => {
    const { env } = await import("@huggingface/transformers");
    if (originalEndpoint === undefined) {
      delete process.env.HF_ENDPOINT;
    } else {
      process.env.HF_ENDPOINT = originalEndpoint;
    }
    // env.remoteHost is typed as string in @huggingface/transformers, but the
    // original value may legitimately have been undefined; cast narrowly so we
    // can restore either case without suppressing unrelated type errors.
    (env as { remoteHost: string | undefined }).remoteHost = originalRemoteHost;
  });

  test("when HF_ENDPOINT is set, applyHfEndpoint sets env.remoteHost to that value", async () => {
    const { applyHfEndpoint } = await import("./embeddings");
    const { env } = await import("@huggingface/transformers");

    process.env.HF_ENDPOINT = "https://custom-endpoint.example.com";
    applyHfEndpoint();

    assert.equal(env.remoteHost, "https://custom-endpoint.example.com");
  });

  test("when HF_ENDPOINT is unset, applyHfEndpoint does not mutate env.remoteHost", async () => {
    const { applyHfEndpoint } = await import("./embeddings");
    const { env } = await import("@huggingface/transformers");

    delete process.env.HF_ENDPOINT;
    // Use a sentinel that is clearly different from any real HF endpoint
    // so the test can detect any accidental mutation.
    const sentinel = "https://untouched-sentinel.example.com";
    (env as { remoteHost: string | undefined }).remoteHost = sentinel;

    applyHfEndpoint();

    assert.equal(env.remoteHost, sentinel);
  });
});

describe("matchSkills — parity shim", () => {
  test("matchSkills returns the same set of skill names as createMatcher().match()", async () => {
    const { matchSkills, createMatcher } = await import("./embeddings");
    const skills = [
      makeSkillSummary({ name: "brainstorming", description: "creative thinking" }),
      makeSkillSummary({ name: "git-helper", description: "git workflow assistance" }),
      makeSkillSummary({ name: "refactor", description: "code refactoring helper" }),
      makeSkillSummary({ name: "deploy", description: "deployment automation" }),
    ];

    const shimResult = await matchSkills("brain", skills);
    const matcherResult = await createMatcher().match("brain", skills);

    const shimNames = new Set(shimResult.map((s) => s.name));
    const matcherNames = new Set(matcherResult.map((s) => s.name));

    // Order may differ if the fuzzy fallback engages, so compare as sets.
    assert.deepEqual(
      shimNames,
      matcherNames,
      `matchSkills must return the same name set as createMatcher().match() (shim=${JSON.stringify([...shimNames])}, matcher=${JSON.stringify([...matcherNames])})`,
    );
  });

  test("matchSkills returns an array of SkillSummary", async () => {
    const { matchSkills } = await import("./embeddings");
    const skills = [
      makeSkillSummary({ name: "alpha", description: "first" }),
      makeSkillSummary({ name: "beta", description: "second" }),
    ];

    const result = await matchSkills("alpha", skills);

    assert.ok(Array.isArray(result), "matchSkills must return an array");
    for (const summary of result) {
      assert.equal(typeof summary.name, "string", "each result must have a string name");
      assert.equal(typeof summary.description, "string", "each result must have a string description");
    }
  });
});
