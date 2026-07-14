/**
 * Tests for the embeddings module.
 *
 * Covers:
 * - Matcher interface (lazy init, semantic ranking, fuzzy fallback, result limits)
 * - cosineSimilarity pure function
 * - matchSkills parity shim
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
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

    assert.ok(Array.isArray(result), "empty query must return an array");
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

describe("scoreSkill generic — B2 accepts Pick<Skill, 'name'|'description'|'trigger'|'tags'>", () => {
  test("scoreSkill accepts an object with only name, description, trigger, and tags fields", async () => {
    const { scoreSkill } = await import("./search");
    // Minimal shape — no path, relativePath, namespace, label, scripts, template
    const minimalSkill = {
      name: "brainstorming",
      description: "helps with creative thinking",
      trigger: "brainstorm",
      tags: ["creative", "ideation"],
    };
    const tokens = ["brain"];
    // Should not throw — scoreSkill must accept the narrowed shape
    const score = scoreSkill(minimalSkill as Parameters<typeof scoreSkill>[0], tokens);
    assert.ok(typeof score === "number", `expected number score, got ${typeof score}`);
    assert.ok(score > 0, `expected positive score for name match, got ${score}`);
  });

  test("scoreSkill returns higher score for exact name match vs description-only match", async () => {
    const { scoreSkill } = await import("./search");
    const exactNameMatch = {
      name: "refactor",
      description: "unrelated content",
      trigger: undefined,
      tags: [],
    };
    const descOnlyMatch = {
      name: "unrelated",
      description: "refactor refactor refactor",
      trigger: undefined,
      tags: [],
    };
    const tokens = ["refactor"];
    const exactScore = scoreSkill(exactNameMatch as Parameters<typeof scoreSkill>[0], tokens);
    const descScore = scoreSkill(descOnlyMatch as Parameters<typeof scoreSkill>[0], tokens);
    assert.ok(exactScore > descScore, `exact name match (${exactScore}) should outrank desc-only (${descScore})`);
  });

  test("scoreSkill works with Pick<Skill, 'name'|'description'|'trigger'|'tags'> shape (generic parameter)", async () => {
    const { scoreSkill } = await import("./search");
    // Explicitly using only the required fields — this is the ScoredSkillLike shape
    const pickSkill: Pick<import("./types").Skill, "name" | "description" | "trigger" | "tags"> = {
      name: "git-helper",
      description: "git workflow assistance",
      trigger: "git",
      tags: ["git", "vcs"],
    };
    const tokens = ["git"];
    const score = scoreSkill(pickSkill, tokens);
    assert.ok(score > 0, `expected positive score for trigger match, got ${score}`);
  });

  test("scoreSkill works with empty tags array on minimal shape", async () => {
    const { scoreSkill } = await import("./search");
    const noTagsSkill = {
      name: "test-skill",
      description: "a test skill description",
      trigger: undefined,
      tags: [],
    };
    const tokens = ["test"];
    const score = scoreSkill(noTagsSkill as Parameters<typeof scoreSkill>[0], tokens);
    assert.ok(score > 0, `expected positive score for name prefix match, got ${score}`);
  });

  test("scoreSkill works with undefined trigger on minimal shape", async () => {
    const { scoreSkill } = await import("./search");
    const noTriggerSkill = {
      name: "code-helper",
      description: "helps with code",
      trigger: undefined,
      tags: [],
    };
    const tokens = ["code"];
    const score = scoreSkill(noTriggerSkill as Parameters<typeof scoreSkill>[0], tokens);
    assert.ok(score > 0, `expected positive score for name match, got ${score}`);
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
