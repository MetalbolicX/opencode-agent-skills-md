import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Skill } from "../src/index";

/**
 * `formatSkillListing` and `renderAvailableSkillsBlock` are the
 * always-on renderers used by `<available-skills>...</available-skills>`.
 *
 * The trigger-aware design (D3) is explicit: the always-on block stays
 * compact (`- name: description`). Trigger text leaks only into the
 * targeted outputs (matched-skill injection, `get_available_skills`).
 *
 * These tests guard that contract: even when skills carry a non-empty
 * `trigger`, the always-on block must NOT include it.
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "default-skill",
    description: "default description",
    path: "/default",
    relativePath: "default",
    label: "project",
    scripts: [],
    template: "",
    tags: [],
    ...overrides,
  } as Skill;
}

describe("formatSkillListing", () => {
  test("renders `- name: description` and omits the trigger (R5, D3)", async () => {
    const { formatSkillListing } = await import("../src/index");
    const skills: Skill[] = [
      makeSkill({ name: "alpha", description: "first skill", trigger: "auth, login" }),
      makeSkill({ name: "bravo", description: "second skill" }),
    ];

    const output = formatSkillListing(skills);

    assert.match(output, /^- alpha: first skill$/m);
    assert.match(output, /^- bravo: second skill$/m);
    assert.doesNotMatch(output, /trigger:/, "trigger text must NOT appear in the always-on block");
  });

  test("an empty skill list renders an empty string", async () => {
    const { formatSkillListing } = await import("../src/index");
    assert.equal(formatSkillListing([]), "");
  });
});

describe("renderAvailableSkillsBlock", () => {
  test("wraps the compact listing and never leaks trigger text (R5, D3)", async () => {
    const { renderAvailableSkillsBlock } = await import("../src/index");
    const skills: Skill[] = [
      makeSkill({ name: "alpha", description: "first skill", trigger: "auth, login" }),
    ];

    const output = renderAvailableSkillsBlock(skills);

    assert.match(output, /<available-skills>/);
    assert.match(output, /<\/available-skills>/);
    assert.match(output, /^- alpha: first skill$/m);
    assert.doesNotMatch(output, /trigger:/, "trigger text must NOT appear in the always-on block");
  });
});
