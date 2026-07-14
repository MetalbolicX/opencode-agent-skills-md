/**
 * Tests for get_available_skills tool and shared tool utilities.
 *
 * Extracted from tools.test.ts during Phase 4 split.
 * Includes escaping tests for _escapeXml and _escapeShellArg from tools/shared.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSkillTools } from "./tools/index";
import { _escapeXml, _escapeShellArg } from "./tools/shared";
import { createMockToolContext } from "./test-helpers";
import type { Skill, SkillStore } from "./types";

// ---------------------------------------------------------------------------
// MockSkillStore
// ---------------------------------------------------------------------------

function createMockSkillStore(skills: Skill[]): SkillStore {
  const byName = new Map<string, Skill>(skills.map((s) => [s.name, s]));
  return {
    async all() { return skills; },
    async summaries(): Promise<{ name: string; description: string; trigger?: string }[]> {
      return skills.map((s) => ({ name: s.name, description: s.description, trigger: s.trigger }));
    },
    async search(_query: string, _keywords?: string[]): Promise<Skill[]> {
      return skills;
    },
    async resolve(name: string): Promise<Skill> {
      const skill = byName.get(name);
      if (skill) return skill;
      for (const s of skills) {
        if (s.name === name || s.path.endsWith(name) || s.relativePath.endsWith(name)) {
          return s;
        }
      }
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
  description: "A test skill for unit testing",
  trigger: "test, fixture",
  path: "/project/.opencode/skills/test-skill",
  relativePath: ".opencode/skills/test-skill",
  label: "project",
  scripts: [
    { relativePath: "bin/script.sh", absolutePath: "/project/.opencode/skills/test-skill/bin/script.sh" },
    { relativePath: "bin/echo.sh", absolutePath: "/project/.opencode/skills/test-skill/bin/echo.sh" },
  ],
  template: "# Test Skill\n\nThis is the skill content.",
  tags: [],
};

const FIXTURE_SKILL_NO_TRIGGER: Skill = {
  name: "no-trigger-skill",
  description: "A skill without a trigger",
  path: "/project/.opencode/skills/no-trigger-skill",
  relativePath: ".opencode/skills/no-trigger-skill",
  label: "project",
  scripts: [],
  template: "# No Trigger Skill\n\nContent here.",
  tags: [],
};

// ---------------------------------------------------------------------------
// Tests: escapeXml / escapeShellArg (shared helpers from tools/shared.ts)
// ---------------------------------------------------------------------------

describe("escapeXml", () => {
  test("escapes &, <, >, \", ' characters", () => {
    const input = '&<>"\'test';
    const result = _escapeXml(input);
    assert.equal(result, "&amp;&lt;&gt;&quot;&apos;test");
  });

  test("returns identical string when no special chars", () => {
    const input = "plain text no special chars";
    assert.equal(_escapeXml(input), input);
  });

  test("handles empty string", () => {
    assert.equal(_escapeXml(""), "");
  });
});

describe("escapeShellArg", () => {
  test("wraps arg in single quotes and escapes embedded single quotes", () => {
    const input = "it's a test";
    const result = _escapeShellArg(input);
    assert.equal(result, "'it'\\''s a test'");
  });

  test("returns quoted empty string", () => {
    assert.equal(_escapeShellArg(""), "''");
  });
});

// ---------------------------------------------------------------------------
// Tests: get_available_skills listing format
// ---------------------------------------------------------------------------

describe("get_available_skills listing format", () => {
  test("lists skill with trigger using format: name (label)\\n  description\\n  trigger: <text>", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tools = createSkillTools({ store, shell: dummyShell });

    const result = await tools.get_available_skills.execute(
      { query: "" },
      createMockToolContext("sess-list"),
    );

    assert.match(result, /^test-skill \(project\)/);
    assert.match(result, /\n  A test skill for unit testing\n/);
    assert.match(result, /\n  trigger: test, fixture$/);
  });

  test("lists skill without trigger using format: name (label)\\n  description", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL_NO_TRIGGER]);
    const tools = createSkillTools({ store, shell: dummyShell });

    const result = await tools.get_available_skills.execute(
      { query: "" },
      createMockToolContext("sess-list"),
    );

    assert.match(result, /^no-trigger-skill \(project\)/);
    assert.match(result, /\n  A skill without a trigger$/);
    assert.doesNotMatch(result, /trigger:/);
  });

  test("returns bare not-found message for query with no close match", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tools = createSkillTools({ store, shell: dummyShell });

    const result = await tools.get_available_skills.execute(
      { query: "xyzzy-abcd" },
      createMockToolContext("sess-not-found"),
    );

    assert.equal(result, "No skills found matching your query.");
  });

  test("returns empty message when store returns no skills", async () => {
    const store = createMockSkillStore([]);
    const tools = createSkillTools({ store, shell: dummyShell });

    const result = await tools.get_available_skills.execute(
      { query: "" },
      createMockToolContext("sess-empty"),
    );

    assert.equal(result, "No skills found matching your query.");
  });
});
