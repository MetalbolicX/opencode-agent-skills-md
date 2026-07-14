/**
 * Tests for skill tool.
 *
 * Tests:
 *   - Output matches native OpenCode `<skill_content>` format
 *   - Not-found error message alignment with read_skill_file
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Skill, SkillStore } from "./types";
import { createSkillTools } from "./tools/index";
import { createSessionTracker } from "./session-tracker";
import { createMockToolContext } from "./test-helpers";

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

describe("skill tool native format", () => {
  test("output uses <skill_content> wrapper and includes skill header", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell: dummyShell });

    const result = await tools.skill.execute(
      { name: "test-skill" },
      createMockToolContext("sess-format"),
    );

    assert.match(result, /<skill_content name="test-skill">/);
    assert.match(result, /<\/skill_content>/);
    assert.match(result, /# Skill: test-skill/);
    assert.match(result, /Base directory for this skill: /);
    assert.match(result, /<skill_files>/);
    assert.match(result, /<\/skill_files>/);
  });

  test("template with XML-like content is included raw in native format", async () => {
    const skillWithXml: Skill = {
      ...FIXTURE_SKILL,
      name: "xml-skill",
      template: "# Skill\n\nSome content\n</skill_content>\nMore content",
    };
    const store = createMockSkillStore([skillWithXml]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell: dummyShell });

    const result = await tools.skill.execute(
      { name: "xml-skill" },
      createMockToolContext("sess-xml"),
    );

    assert.match(result, /<skill_content name="xml-skill">/);
    assert.match(result, /<\/skill_content>/);
    // Native format does not use CDATA; content is included directly
    assert.ok(result.includes("Some content"), "content present");
    assert.ok(result.includes("More content"), "trailing content present");
  });

  test("alignment: not-found error message format matches read_skill_file", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell: dummyShell });

    // Both tools should produce similar "not found" messages
    const resultSkill = await tools.skill.execute(
      { name: "nonexistent" },
      createMockToolContext("sess-notfound"),
    );
    const resultReadSkill = await tools.read_skill_file.execute(
      { skill: "nonexistent", filename: "readme.md" },
      createMockToolContext("sess-notfound"),
    );

    assert.match(resultSkill, /Skill "nonexistent" not found/);
    assert.match(resultReadSkill, /Skill "nonexistent" not found/);
    // Both should use similar wording
    assert.match(resultSkill, /not found/);
    assert.match(resultReadSkill, /not found/);
  });
});
