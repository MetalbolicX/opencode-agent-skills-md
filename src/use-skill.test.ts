/**
 * Tests for use_skill tool.
 *
 * Tests:
 *   - Template injection isolation: text containing </content> cannot break the wrapper
 *   - CDATA wrapping prevents XML-in-Markdown issues
 *   - Error message alignment with read_skill_file
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Skill, SkillStore } from "./types";
import { createSkillTools } from "./tools/index";
import { createSessionTracker } from "./session-tracker";

// ---------------------------------------------------------------------------
// MockSkillStore
// ---------------------------------------------------------------------------

function createMockSkillStore(skills: Skill[]): SkillStore {
  const byName = new Map<string, Skill>(skills.map((s) => [s.name, s]));
  return {
    async all() { return skills; },
    async summaries() { return skills.map((s) => ({ name: s.name, description: s.description, trigger: s.trigger })); },
    async search(_query: string, _keywords?: string[]) { return skills; },
    async resolve(name: string): Promise<Skill> {
      const skill = byName.get(name);
      if (skill) return skill;
      throw new Error(`Skill '${name}' not found`);
    },
    invalidate() {},
    async listFiles(_skillName: string): Promise<string[]> { return []; },
  };
}

// ---------------------------------------------------------------------------
// Minimal shell stub (satisfies createSkillTools guard)
// ---------------------------------------------------------------------------

const dummyShell = ((_strings: TemplateStringsArray, ..._values: unknown[]) => ({
  cwd: (_d: string) => dummyShell as any,
  text: async () => "dummy",
})) as any;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_SKILL: Skill = {
  name: "test-skill",
  description: "A test skill",
  trigger: "test",
  path: "/project/.opencode/skills/test-skill",
  relativePath: ".opencode/skills/test-skill",
  label: "project",
  scripts: [],
  template: "# Test Skill\n\nThis is the skill content.",
  tags: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("use_skill template injection safety", () => {
  test("template containing </content> is safely wrapped with CDATA", async () => {
    const skillWithInjection: Skill = {
      ...FIXTURE_SKILL,
      name: "injection-skill",
      template: "# Skill\n\nSome content\n</content>\nMore content",
    };
    const store = createMockSkillStore([skillWithInjection]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell: dummyShell });

    const result = await tools.use_skill.execute(
      { skill: "injection-skill" },
      { sessionID: "sess-injection" },
    );

    // CDATA wrapping isolates the template content
    assert.match(result, /<content><!\[CDATA\[/);
    assert.match(result, /\]\]><\/content>/);
    // The injection attempt (</content>) appears INSIDE the CDATA section,
    // properly escaped from the outer <content> wrapper
    // The outer wrapper remains intact with CDATA boundary markers
    assert.ok(result.includes("<![CDATA["), "CDATA opening present");
    assert.ok(result.includes("]]>"), "CDATA closing present");
    // The template content should appear between CDATA delimiters
    assert.match(result, /<content><!\[CDATA\[# Skill/);
  });

  test("template containing ]]> is handled correctly (CDATA edge case)", async () => {
    const skillWithCdataEnd: Skill = {
      ...FIXTURE_SKILL,
      name: "cdata-end-skill",
      template: "# Skill\n\nSome content\n]]>\nMore content",
    };
    const store = createMockSkillStore([skillWithCdataEnd]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell: dummyShell });

    const result = await tools.use_skill.execute(
      { skill: "cdata-end-skill" },
      { sessionID: "sess-cdata" },
    );

    // ]]> must be escaped/replaced to avoid breaking CDATA
    assert.match(result, /<content><!\[CDATA\[/);
  });

  test("alignment: not-found error message format matches read_skill_file", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell: dummyShell });

    // Both tools should produce similar "not found" messages
    const resultUseSkill = await tools.use_skill.execute(
      { skill: "nonexistent" },
      { sessionID: "sess-notfound" },
    );
    const resultReadSkill = await tools.read_skill_file.execute(
      { skill: "nonexistent", filename: "readme.md" },
      {},
    );

    assert.match(resultUseSkill, /Skill "nonexistent" not found/);
    assert.match(resultReadSkill, /Skill "nonexistent" not found/);
    // Both should use similar wording
    assert.match(resultUseSkill, /not found/);
    assert.match(resultReadSkill, /not found/);
  });
});
