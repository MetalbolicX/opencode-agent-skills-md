import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { levenshtein, findClosestMatch } from "../src/match";
import type { Skill } from "../src/index";

/**
 * Build a minimal `Skill` for unit tests. Only the fields touched by the
 * search layer are populated; everything else uses safe defaults so the
 * shape stays close to the production type without forcing every test to
 * set up the full Skill surface.
 */
function makeSkill(overrides: { tags?: string[]; [key: string]: unknown } = {}): Skill {
  return {
    name: "default-skill",
    description: "default description",
    path: "/default",
    relativePath: "default",
    label: "project",
    scripts: [],
    template: "",
    ...(overrides as Partial<Skill>),
  } as Skill;
}

describe("levenshtein", () => {
  test("identical strings have distance 0", () => {
    assert.equal(levenshtein("hello", "hello"), 0);
  });

  test("completely different strings have high distance", () => {
    assert.equal(levenshtein("abc", "xyz"), 3);
  });

  test("single character difference", () => {
    assert.equal(levenshtein("cat", "bat"), 1);
  });

  test("insertion", () => {
    assert.equal(levenshtein("cat", "cats"), 1);
  });

  test("deletion", () => {
    assert.equal(levenshtein("cats", "cat"), 1);
  });

  test("substitution", () => {
    assert.equal(levenshtein("cat", "cut"), 1);
  });

  test("case sensitive", () => {
    assert.equal(levenshtein("Cat", "cat"), 1);
  });
});

describe("findClosestMatch", () => {
  test("returns null for empty candidate list", () => {
    assert.equal(findClosestMatch("test", []), null);
  });

  test("exact match returns the match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("pdf", candidates), "pdf");
  });

  test("prefix match - user types partial skill name", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("git", candidates), "git-helper");
  });

  test("prefix match - longer match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("brainstorm", candidates), "brainstorming");
  });

  test("typo correction via Levenshtein", () => {
    const candidates = ["pattern", "git-helper", "pdf"];
    assert.equal(findClosestMatch("patern", candidates), "pattern");
  });

  test("case insensitive matching", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    assert.equal(findClosestMatch("brainstorm", candidates), "Brainstorming");
  });

  test("case insensitive exact match", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    assert.equal(findClosestMatch("PDF", candidates), "PDF");
  });

  test("substring match", () => {
    const candidates = ["document-processor", "git-helper", "pdf-reader"];
    assert.equal(findClosestMatch("pdf", candidates), "pdf-reader");
  });

  test("no close matches below threshold returns null", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("xyzabc", candidates), null);
  });

  test("multiple similar candidates returns best match", () => {
    const candidates = ["test", "testing", "tests"];
    assert.equal(findClosestMatch("test", candidates), "test");
  });

  test("prefix matching beats substring matching", () => {
    const candidates = ["pdf-reader", "reader-pdf"];
    assert.equal(findClosestMatch("pdf", candidates), "pdf-reader");
  });

  test("handles hyphenated names", () => {
    const candidates = ["git-helper", "github-actions", "gitlab-ci"];
    assert.equal(findClosestMatch("git", candidates), "git-helper");
  });

  test("script path matching", () => {
    const candidates = ["build.sh", "scripts/deploy.sh", "tools/build.sh"];
    assert.equal(findClosestMatch("deploy", candidates), "scripts/deploy.sh");
  });

  test("typo in script name", () => {
    const candidates = ["build.sh", "deploy.sh", "test.sh"];
    assert.equal(findClosestMatch("biuld.sh", candidates), "build.sh");
  });
});

type SearchModule = {
  escapeRegex: (input: string) => string;
  keywordMatch: (skill: Skill, keywords: string[]) => boolean;
  scoreSkill: (skill: Skill, tokens: string[]) => number;
  searchSkills: (
    skills: Skill[],
    query: string,
    keywords?: string[]
  ) => Skill[];
};

async function loadSearchModule(): Promise<SearchModule> {
  return (await import("../src/index")) as unknown as SearchModule;
}

describe("escapeRegex", () => {
  test("escapes a literal dot", async () => {
    const { escapeRegex } = await loadSearchModule();
    assert.equal(escapeRegex("a.b"), "a\\.b");
  });

  test("escapes parentheses", async () => {
    const { escapeRegex } = await loadSearchModule();
    assert.equal(escapeRegex("(test)"), "\\(test\\)");
  });

  test("escapes character class metacharacters and the hyphen", async () => {
    const { escapeRegex } = await loadSearchModule();
    assert.equal(escapeRegex("[a-z]+"), "\\[a\\-z\\]\\+");
  });

  test("passes an already-safe string through unchanged", async () => {
    const { escapeRegex } = await loadSearchModule();
    assert.equal(escapeRegex("hello world"), "hello world");
  });

  test("produces a pattern that compiles inside a larger regex", async () => {
    const { escapeRegex } = await loadSearchModule();
    const pattern = new RegExp(escapeRegex("(test+"));
    assert.equal(pattern.test("(test+"), true);
    assert.equal(pattern.test("xtest+"), false);
  });
});

describe("keywordMatch", () => {
  test("skill with matching tag is included", async () => {
    const { keywordMatch } = await loadSearchModule();
    const skill = makeSkill({ name: "go-tester", tags: ["go"] });
    assert.equal(keywordMatch(skill, ["go"]), true);
  });

  test("skill without matching tag is excluded", async () => {
    const { keywordMatch } = await loadSearchModule();
    const skill = makeSkill({ name: "rust-tester", tags: ["rust"] });
    assert.equal(keywordMatch(skill, ["go"]), false);
  });

  test("OR semantics across multiple keywords", async () => {
    const { keywordMatch } = await loadSearchModule();
    const skill = makeSkill({ name: "go-tester", tags: ["go"] });
    assert.equal(keywordMatch(skill, ["go", "rust"]), true);
  });

  test("skill with no tags does not match any keyword", async () => {
    const { keywordMatch } = await loadSearchModule();
    const skill = makeSkill({ name: "untagged" });
    assert.equal(keywordMatch(skill, ["go"]), false);
  });

  test("empty keyword list applies no filter", async () => {
    const { keywordMatch } = await loadSearchModule();
    const skill = makeSkill({ name: "untagged" });
    assert.equal(keywordMatch(skill, []), true);
  });
});

describe("scoreSkill", () => {
  test("name exact outranks name prefix outranks name fuzzy outranks description match", async () => {
    const { scoreSkill } = await loadSearchModule();
    const exact = makeSkill({ name: "brain", description: "" });
    const prefix = makeSkill({ name: "brainstorming", description: "" });
    const fuzzy = makeSkill({ name: "braid", description: "" });
    const descOnly = makeSkill({ name: "skill-x", description: "this is about brain" });

    const sExact = scoreSkill(exact, ["brain"]);
    const sPrefix = scoreSkill(prefix, ["brain"]);
    const sFuzzy = scoreSkill(fuzzy, ["brain"]);
    const sDesc = scoreSkill(descOnly, ["brain"]);

    assert.ok(sExact > 0, "exact match scores positive");
    assert.ok(sPrefix > 0, "prefix match scores positive");
    assert.ok(sFuzzy > 0, "fuzzy match scores positive");
    assert.ok(sDesc > 0, "description match scores positive");
    assert.ok(sExact > sPrefix, `exact (${sExact}) > prefix (${sPrefix})`);
    assert.ok(sPrefix > sFuzzy, `prefix (${sPrefix}) > fuzzy (${sFuzzy})`);
    assert.ok(sFuzzy > sDesc, `fuzzy (${sFuzzy}) > description (${sDesc})`);
  });

  test("AND across tokens: a skill missing a token returns 0", async () => {
    const { scoreSkill } = await loadSearchModule();
    const skill = makeSkill({ name: "brainstorming", description: "x" });
    assert.equal(scoreSkill(skill, ["brain", "logic"]), 0);
  });

  test("multi-token: all tokens in description ranks above name-only partial", async () => {
    const { scoreSkill } = await loadSearchModule();
    const allInDesc = makeSkill({
      name: "tool-x",
      description: "brain logic helper for reasoning",
    });
    const onlyInName = makeSkill({
      name: "brain-helper",
      description: "no second keyword here",
    });

    const sAllInDesc = scoreSkill(allInDesc, ["brain", "logic"]);
    const sOnlyInName = scoreSkill(onlyInName, ["brain", "logic"]);

    assert.ok(sAllInDesc > 0, "all-tokens-in-description scores positive");
    assert.equal(sOnlyInName, 0, "AND fails when one token is missing from desc");
  });

  test("trigger-only match scores positive (R3)", async () => {
    const { scoreSkill } = await loadSearchModule();
    const skill = makeSkill({
      name: "skill-x",
      description: "unrelated description",
      trigger: "oauth login",
    });

    const score = scoreSkill(skill, ["oauth"]);

    assert.ok(score > 0, `trigger-only match should score positive, got ${score}`);
  });

  test("name exact beats trigger at the same query (R3 ordering)", async () => {
    const { scoreSkill } = await loadSearchModule();
    const nameExact = makeSkill({
      name: "oauth",
      description: "x",
    });
    const triggerOnly = makeSkill({
      name: "skill-x",
      description: "x",
      trigger: "oauth login",
    });

    const sName = scoreSkill(nameExact, ["oauth"]);
    const sTrigger = scoreSkill(triggerOnly, ["oauth"]);

    assert.ok(sName > sTrigger, `name (${sName}) must beat trigger (${sTrigger})`);
  });

  test("trigger beats description at the same query (R3 ordering)", async () => {
    const { scoreSkill } = await loadSearchModule();
    const descOnly = makeSkill({
      name: "skill-x",
      description: "auth helper for tokens",
    });
    const triggerOnly = makeSkill({
      name: "skill-y",
      description: "unrelated",
      trigger: "auth login",
    });

    const sDesc = scoreSkill(descOnly, ["auth"]);
    const sTrigger = scoreSkill(triggerOnly, ["auth"]);

    assert.ok(sTrigger > sDesc, `trigger (${sTrigger}) must beat description (${sDesc})`);
  });
});

describe("searchSkills", () => {
  test("query only: results are sorted by score DESC", async () => {
    const { searchSkills } = await loadSearchModule();
    const skills = [
      makeSkill({ name: "skill-z", description: "brain related" }),
      makeSkill({ name: "brainstorming", description: "x" }),
      makeSkill({ name: "brain", description: "x" }),
    ];

    const result = searchSkills(skills, "brain");

    assert.equal(result.length, 3);
    assert.equal(result[0]?.name, "brain", "exact name match should be first");
    assert.equal(result[1]?.name, "brainstorming", "prefix name match should be second");
  });

  test("keywords only: pre-filter by tags then pass through", async () => {
    const { searchSkills } = await loadSearchModule();
    const skills = [
      makeSkill({ name: "go-tester", tags: ["go"] }),
      makeSkill({ name: "rust-tester", tags: ["rust"] }),
      makeSkill({ name: "go-debug", tags: ["go", "testing"] }),
    ];

    const result = searchSkills(skills, "", ["go"]);

    assert.equal(result.length, 2, "exactly two skills are tagged 'go'");
    const names = result.map((s) => s.name);
    assert.ok(names.includes("go-tester"));
    assert.ok(names.includes("go-debug"));
    assert.ok(!names.includes("rust-tester"));
  });

  test("keywords + query: filter applies first, then scored", async () => {
    const { searchSkills } = await loadSearchModule();
    const skills = [
      makeSkill({ name: "brain-tool", description: "x", tags: ["go"] }),
      makeSkill({ name: "rust-tool", description: "x", tags: ["rust"] }),
      makeSkill({ name: "go-helper", description: "x", tags: ["go"] }),
    ];

    const result = searchSkills(skills, "brain", ["go"]);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "brain-tool");
  });

  test("query with regex-special characters does not throw", async () => {
    const { searchSkills } = await loadSearchModule();
    const skills = [
      makeSkill({ name: "test-skill", description: "regular helper" }),
      makeSkill({ name: "unrelated", description: "noise" }),
    ];

    let result;
    assert.doesNotThrow(() => {
      result = searchSkills(skills, "(test+[?*$^|){}]\\");
    });
    assert.ok(Array.isArray(result), "returns an array");
  });

  test("empty query and no keywords returns the input list as-is", async () => {
    const { searchSkills } = await loadSearchModule();
    const skills = [
      makeSkill({ name: "alpha" }),
      makeSkill({ name: "beta" }),
    ];

    const result = searchSkills(skills, "");

    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((s) => s.name),
      ["alpha", "beta"]
    );
  });
});
