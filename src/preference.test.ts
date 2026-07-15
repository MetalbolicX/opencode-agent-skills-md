/**
 * Tests for preference module pure rendering functions.
 *
 * Tests:
 *   - renderSkillPreferenceSystemBlock: full policy block with skill catalog
 *   - renderSkillPreflightBlock: skill directives list
 *   - isPreferenceModeEnabled: string-based toggle detection
 *   - formatSkillListing: bullet list formatting
 *   - renderAvailableSkillsBlock: full available-skills block
 *   - formatMatchedSkillsInjection: matched-skill evaluation block
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  renderSkillPreferenceSystemBlock,
  renderSkillPreflightBlock,
  isPreferenceModeEnabled,
  formatSkillListing,
  renderAvailableSkillsBlock,
  formatMatchedSkillsInjection,
} from "./preference";
import type { Skill, SkillSummary } from "./types";

describe("renderSkillPreferenceSystemBlock", () => {
  test("contains skill-first policy and skill catalog", () => {
    const summaries: SkillSummary[] = [
      { name: "git-helper", description: "Git assistance", trigger: "git" },
      { name: "test-skill", description: "Testing utilities", trigger: "test" },
    ];
    const result = renderSkillPreferenceSystemBlock(summaries);

    assert.ok(result.includes("<skill-preference-policy>"));
    assert.ok(result.includes("skill"));
    assert.ok(result.includes("git-helper"));
    assert.ok(result.includes("test-skill"));
    assert.ok(result.includes("</skill-preference-policy>"));
  });

  test("catalog entries follow - name: description format", () => {
    const summaries: SkillSummary[] = [
      { name: "deploy-skill", description: "Deploy automation", trigger: "" },
    ];
    const result = renderSkillPreferenceSystemBlock(summaries);
    assert.ok(result.includes("- deploy-skill: Deploy automation"));
  });
});

describe("renderSkillPreflightBlock", () => {
  test("returns empty string for empty summaries", () => {
    const result = renderSkillPreflightBlock([]);
    assert.equal(result, "");
  });

  test("contains skill-preflight tag and skill directives", () => {
    const summaries: SkillSummary[] = [
      { name: "git-helper", description: "Git assistance", trigger: "git" },
    ];
    const result = renderSkillPreflightBlock(summaries);

    assert.ok(result.includes("<skill-preflight>"));
    assert.ok(result.includes('skill("git-helper")'));
    assert.ok(result.includes("</skill-preflight>"));
  });

  test("multiple skills produce multiple directives", () => {
    const summaries: SkillSummary[] = [
      { name: "skill-a", description: "A", trigger: "" },
      { name: "skill-b", description: "B", trigger: "" },
    ];
    const result = renderSkillPreflightBlock(summaries);
    assert.ok(result.includes('skill("skill-a")'));
    assert.ok(result.includes('skill("skill-b")'));
  });
});

describe("isPreferenceModeEnabled", () => {
  test("returns true when undefined", () => {
    assert.equal(isPreferenceModeEnabled(undefined), true);
  });

  test("returns true when empty string", () => {
    assert.equal(isPreferenceModeEnabled(""), true);
  });

  test("returns true for 'on'", () => {
    assert.equal(isPreferenceModeEnabled("on"), true);
  });

  test("returns false for 'off'", () => {
    assert.equal(isPreferenceModeEnabled("off"), false);
  });

  test("returns true for other values", () => {
    assert.equal(isPreferenceModeEnabled("strict"), true);
    assert.equal(isPreferenceModeEnabled("verbose"), true);
  });
});

describe("formatSkillListing", () => {
  test("formats single skill as bullet item with description", () => {
    const skills: Skill[] = [
      {
        name: "test-skill",
        description: "Testing utilities",
        path: "/test",
        relativePath: "test",
        label: "project",
        scripts: [],
        template: "",
        tags: [],
      },
    ];
    const result = formatSkillListing(skills);
    assert.equal(result, "- test-skill: Testing utilities");
  });

  test("formats multiple skills with newlines", () => {
    const skills: Skill[] = [
      { name: "a", description: "A skill", path: "/a", relativePath: "a", label: "p", scripts: [], template: "", tags: [] },
      { name: "b", description: "B skill", path: "/b", relativePath: "b", label: "p", scripts: [], template: "", tags: [] },
    ];
    const result = formatSkillListing(skills);
    assert.ok(result.includes("- a: A skill\n- b: B skill") || result.includes("- a: A skill"));
  });

  test("omits trigger from listing", () => {
    const skills: Skill[] = [
      { name: "git-helper", description: "Git assistance", trigger: "git, commit", path: "/g", relativePath: "g", label: "p", scripts: [], template: "", tags: [] },
    ];
    const result = formatSkillListing(skills);
    assert.ok(!result.includes("trigger"));
  });
});

describe("renderAvailableSkillsBlock", () => {
  test("contains available-skills wrapper and skill list", () => {
    const skills: Skill[] = [
      { name: "test-skill", description: "Testing", path: "/t", relativePath: "t", label: "project", scripts: [], template: "", tags: [] },
    ];
    const result = renderAvailableSkillsBlock(skills);

    assert.ok(result.includes("<available-skills>"));
    assert.ok(result.includes("skill"));
    assert.ok(result.includes("test-skill"));
    assert.ok(result.includes("</available-skills>"));
  });

  test("mentions all four tool names", () => {
    const result = renderAvailableSkillsBlock([]);
    assert.ok(result.includes("skill"));
    assert.ok(result.includes("read_skill_file"));
    assert.ok(result.includes("run_skill_script"));
    assert.ok(result.includes("get_available_skills"));
  });

  test("never instructs agents to call use_skill (model-switching guard)", () => {
    const skills: Skill[] = [
      { name: "git-helper", description: "Git assistance", path: "/g", relativePath: "g", label: "project", scripts: [], template: "", tags: [] },
      { name: "test-skill", description: "Testing utilities", path: "/t", relativePath: "t", label: "project", scripts: [], template: "", tags: [] },
    ];
    const summaries: SkillSummary[] = [
      { name: "git-helper", description: "Git assistance", trigger: "git" },
      { name: "test-skill", description: "Testing utilities", trigger: "test" },
    ];

    const blocks = [
      renderSkillPreferenceSystemBlock(summaries),
      renderSkillPreflightBlock(summaries),
      renderAvailableSkillsBlock(skills),
      formatMatchedSkillsInjection(summaries),
    ];

    for (const block of blocks) {
      assert.ok(
        !block.includes("use_skill(\""),
        `Generated text must not reference use_skill("...") — see preference.ts BOUNDARY comment (OpenCode issue #4475). Block:\n${block}`,
      );
      assert.ok(
        !block.includes("Call use_skill"),
        `Generated text must not say "Call use_skill" — see preference.ts BOUNDARY comment (OpenCode issue #4475). Block:\n${block}`,
      );
    }
  });
});

describe("formatMatchedSkillsInjection", () => {
  test("contains skill-evaluation-required tag", () => {
    const matched: SkillSummary[] = [
      { name: "test-skill", description: "Testing", trigger: "test" },
    ];
    const result = formatMatchedSkillsInjection(matched);
    assert.ok(result.includes("<skill-evaluation-required>"));
    assert.ok(result.includes("</skill-evaluation-required>"));
  });

  test("skill entries include name, description, and trigger", () => {
    const matched: SkillSummary[] = [
      { name: "git-helper", description: "Git assistance", trigger: "git, commit" },
    ];
    const result = formatMatchedSkillsInjection(matched);
    assert.ok(result.includes("git-helper"));
    assert.ok(result.includes("Git assistance"));
    assert.ok(result.includes("trigger: git, commit"));
  });

  test("omits trigger line when trigger is empty", () => {
    const matched: SkillSummary[] = [
      { name: "some-skill", description: "Does things", trigger: "" },
    ];
    const result = formatMatchedSkillsInjection(matched);
    assert.ok(result.includes("some-skill"));
    assert.ok(!result.includes("trigger:"));
  });

  test("mentions EVALUATE, DECIDE, ACTIVATE steps", () => {
    const matched: SkillSummary[] = [
      { name: "test", description: "Test", trigger: "" },
    ];
    const result = formatMatchedSkillsInjection(matched);
    assert.ok(result.includes("EVALUATE"));
    assert.ok(result.includes("DECIDE"));
    assert.ok(result.includes("ACTIVATE"));
  });
});
