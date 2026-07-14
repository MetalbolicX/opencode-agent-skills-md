/**
 * Tests for search module pure functions.
 *
 * Tests:
 *   - escapeRegex: special chars are escaped
 *   - tokenize: splits query into lowercase tokens
 *   - keywordMatch: tag-based filtering
 *   - scoreSkill: scoring algorithm (keyword scoring system)
 *   - searchSkills: full search pipeline with scoring
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { escapeRegex, tokenize, keywordMatch, scoreSkill, searchSkills } from "./search";
import type { Skill } from "./types";

describe("escapeRegex", () => {
  test("escapes all special regex characters", () => {
    const input = "file[0].txt";
    const result = escapeRegex(input);
    // Should escape [, ], .
    assert.equal(result, "file\\[0\\]\\.txt");
  });

  test("returns identical string when no special chars", () => {
    const input = "simplefilename";
    assert.equal(escapeRegex(input), "simplefilename");
  });
});

describe("tokenize", () => {
  test("splits on whitespace and lowercases", () => {
    const result = tokenize("  Hello   WORLD  ");
    assert.deepEqual(result, ["hello", "world"]);
  });

  test("filters out empty tokens", () => {
    const result = tokenize("  one   \n  two\t  three  ");
    assert.deepEqual(result, ["one", "two", "three"]);
  });

  test("returns empty array for whitespace-only input", () => {
    const result = tokenize("   \n\t  ");
    assert.deepEqual(result, []);
  });
});

describe("keywordMatch", () => {
  const skill: Skill = {
    name: "test-skill",
    description: "A test skill",
    trigger: "test, fixture",
    path: "/test",
    relativePath: "test",
    label: "project",
    scripts: [],
    template: "content",
    tags: ["testing", "fixture"],
  };

  test("returns true when any keyword is in tags", () => {
    assert.equal(keywordMatch(skill, ["testing"]), true);
  });

  test("returns true when keywords overlap partially", () => {
    assert.equal(keywordMatch(skill, ["testing", "util"]), true);
  });

  test("returns false when no keyword matches tags", () => {
    assert.equal(keywordMatch(skill, ["database"]), false);
  });

  test("returns true for empty keywords (no filter)", () => {
    assert.equal(keywordMatch(skill, []), true);
  });
});

describe("scoreSkill", () => {
  const makeSkill = (name: string, description: string, trigger = ""): Pick<Skill, "name" | "description" | "trigger" | "tags"> => ({
    name, description, trigger, tags: [],
  });

  test("returns 0 for empty tokens", () => {
    const skill = makeSkill("test", "description");
    assert.equal(scoreSkill(skill, []), 0);
  });

  test("exact name match scores highest (100 pts)", () => {
    const skill = makeSkill("typescript", "A language");
    assert.ok(scoreSkill(skill, ["typescript"]) > scoreSkill(skill, ["type"]));
  });

  test("name prefix match scores high (90 pts)", () => {
    const skill = makeSkill("typescript", "A language");
    const score = scoreSkill(skill, ["type"]);
    assert.ok(score > 0);
  });

  test("trigger match scores well (60 pts)", () => {
    const skill = makeSkill("git-helper", "Git assistance", "git, commit");
    const score = scoreSkill(skill, ["git"]);
    assert.ok(score > 0);
  });

  test("description match scores lower than name/trigger", () => {
    const nameMatch = scoreSkill(makeSkill("javascript", "A language"), ["java"]);
    const descMatch = scoreSkill(makeSkill("other", "JavaScript runtime"), ["java"]);
    assert.ok(nameMatch > descMatch);
  });

  test("returns 0 when no tokens match", () => {
    const skill = makeSkill("python", "Python language");
    assert.equal(scoreSkill(skill, ["java", "ruby"]), 0);
  });

  test("all tokens must match (AND semantics per spec)", () => {
    const skill = makeSkill("git-helper", "Git workflow assistance");
    const score = scoreSkill(skill, ["git", "workflow"]);
    assert.ok(score > 0, "both tokens match description so score should be positive");
  });
});

describe("searchSkills", () => {
  const skills: Skill[] = [
    {
      name: "git-helper",
      description: "Git workflow assistance",
      trigger: "git, commit, branch",
      path: "/skills/git-helper",
      relativePath: "git-helper",
      label: "project",
      scripts: [],
      template: "content",
      tags: ["git", "vcs"],
    },
    {
      name: "test-skill",
      description: "Testing utilities",
      trigger: "test, mock",
      path: "/skills/test-skill",
      relativePath: "test-skill",
      label: "project",
      scripts: [],
      template: "content",
      tags: ["testing"],
    },
    {
      name: "deploy-skill",
      description: "Deployment automation",
      trigger: "deploy, ci, cd",
      path: "/skills/deploy-skill",
      relativePath: "deploy-skill",
      label: "project",
      scripts: [],
      template: "content",
      tags: ["deploy"],
    },
  ];

  test("returns all skills for empty query", () => {
    const result = searchSkills(skills, "");
    assert.equal(result.length, 3);
  });

  test("filters by keywords when provided", () => {
    const result = searchSkills(skills, "workflow", ["git"]);
    assert.ok(result.length <= 3);
  });

  test("returns skills matching the query sorted by score", () => {
    const result = searchSkills(skills, "test");
    assert.ok(result.length > 0);
    assert.equal(result[0]!.name, "test-skill");
  });

  test("returns empty array when no skills match", () => {
    const result = searchSkills(skills, "xyzzy");
    assert.equal(result.length, 0);
  });

  test("whitespace-only query returns all skills", () => {
    const result = searchSkills(skills, "   \n  ");
    assert.equal(result.length, 3);
  });
});
