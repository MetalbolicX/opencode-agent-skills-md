/**
 * Tests for match module pure functions.
 *
 * Tests:
 *   - levenshtein: correct edit distance
 *   - findClosestMatch: prefix, inclusion, and Levenshtein-based matching
 *   - matchSkillsByKeyword: token scoring and top-5 filtering
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { levenshtein, findClosestMatch, matchSkillsByKeyword } from "./match";
import type { SkillSummary } from "./types";

describe("levenshtein", () => {
  test("returns 0 for identical strings", () => {
    assert.equal(levenshtein("hello", "hello"), 0);
    assert.equal(levenshtein("", ""), 0);
  });

  test("returns string length for insertion of all chars", () => {
    assert.equal(levenshtein("", "abc"), 3);
    assert.equal(levenshtein("abc", ""), 3);
  });

  test("returns 1 for single character substitution", () => {
    assert.equal(levenshtein("cat", "bat"), 1);
    assert.equal(levenshtein("hello", "hallo"), 1);
  });

  test("returns correct distance for multi-char differences", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
  });
});

describe("findClosestMatch", () => {
  const candidates = ["typescript", "javascript", "java", "python", "rust"];

  test("returns exact match for identical input", () => {
    assert.equal(findClosestMatch("typescript", candidates), "typescript");
  });

  test("returns prefix match with high score", () => {
    const result = findClosestMatch("type", candidates);
    assert.equal(result, "typescript");
  });

  test("returns candidate when input starts with candidate", () => {
    const result = findClosestMatch("java", candidates);
    // "java" is a candidate
    assert.equal(result, "java");
  });

  test("returns inclusion match (candidate includes input)", () => {
    const result = findClosestMatch("script", ["typescript", "javascript"]);
    // "typescript" or "javascript" includes "script"
    assert.ok(result === "typescript" || result === "javascript");
  });

  test("returns null when no candidate meets 0.4 threshold", () => {
    const result = findClosestMatch("xyzzy", candidates);
    assert.equal(result, null);
  });

  test("returns null for empty candidates array", () => {
    assert.equal(findClosestMatch("anything", []), null);
  });

  test("is case-insensitive", () => {
    const result = findClosestMatch("TYPESCRIPT", candidates);
    assert.equal(result, "typescript");
  });
});

describe("matchSkillsByKeyword", () => {
  const skills: SkillSummary[] = [
    { name: "git-helper", description: "Git workflow assistance", trigger: "git, commit, branch" },
    { name: "test-skill", description: "Testing utilities and helpers", trigger: "test, mock" },
    { name: "deploy-skill", description: "Deployment automation", trigger: "deploy, ci, cd" },
    { name: "code-review", description: "Code review assistance", trigger: "review, pr" },
    { name: "db-skill", description: "Database migration tools", trigger: "database, sql, migrate" },
  ];

  test("returns empty array for empty tokens (too short)", () => {
    const result = matchSkillsByKeyword("ab", skills);
    assert.equal(result.length, 0);
  });

  test("returns empty array when no skills match", () => {
    const result = matchSkillsByKeyword("zzzzz", skills);
    assert.equal(result.length, 0);
  });

  test("returns matching skills sorted by relevance", () => {
    const result = matchSkillsByKeyword("test", skills);
    assert.ok(result.length > 0);
    assert.equal(result[0]!.name, "test-skill");
  });

  test("returns max 5 skills", () => {
    const manySkills: SkillSummary[] = Array.from({ length: 10 }, (_, i) => ({
      name: `skill-${i}`,
      description: `Description for skill ${i}`,
      trigger: `tag${i}`,
    }));
    const result = matchSkillsByKeyword("skill", manySkills);
    assert.ok(result.length <= 5);
  });

  test("name matches score higher than description matches", () => {
    const result = matchSkillsByKeyword("git", skills);
    assert.ok(result.length > 0);
    assert.equal(result[0]!.name, "git-helper");
  });

  test("trigger matches score higher than description matches", () => {
    const result = matchSkillsByKeyword("deploy", skills);
    assert.ok(result.length > 0);
    assert.equal(result[0]!.name, "deploy-skill");
  });

  test("empty skill list returns empty array", () => {
    const result = matchSkillsByKeyword("test", []);
    assert.equal(result.length, 0);
  });
});
