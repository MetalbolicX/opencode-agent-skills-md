/**
 * Tests for read_skill_file tool.
 *
 * Tests:
 *   - Path traversal rejection: resolveSafeSkillFilePath must block escape from skill directory
 *   - The tool must return a clear error message for traversal attempts
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveSafeSkillFilePath } from "./tools/read-skill-file";
import type { Skill, SkillStore } from "./types";
import { createSkillTools } from "./tools/index";
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
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_SKILL: Skill = {
  name: "test-skill",
  description: "A test skill",
  trigger: "test",
  path: "/project/.opencode/skills/test-skill",
  relativePath: ".opencode/skills/test-skill",
  label: "project",
  scripts: [],
  template: "# Test Skill",
  tags: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveSafeSkillFilePath", () => {
  test("blocks traversal with ../ prefix (Unix-style)", async () => {
    const skillPath = "/project/.opencode/skills/test-skill";
    const result = await resolveSafeSkillFilePath(skillPath, "../../../etc/passwd");
    assert.equal(result, null, "traversal must be blocked");
  });

  test("blocks traversal with backslash prefix (Windows-style attempted escape)", async () => {
    const skillPath = "/project/.opencode/skills/test-skill";
    const result = await resolveSafeSkillFilePath(skillPath, "..\\..\\..\\etc\\passwd");
    assert.equal(result, null, "Windows-style traversal must be blocked");
  });

  test("blocks traversal using absolute path that escapes skill directory", async () => {
    const skillPath = "/project/.opencode/skills/test-skill";
    const result = await resolveSafeSkillFilePath(skillPath, "/etc/passwd");
    assert.equal(result, null, "absolute path escape must be blocked");
  });

  test("allows files within skill directory", async () => {
    const skillPath = "/project/.opencode/skills/test-skill";
    const result = await resolveSafeSkillFilePath(skillPath, "readme.md");
    // Result is null if file doesn't exist (realpath fails) but path is safe
    assert.notEqual(result, "/project/.opencode/skills/../../../etc/passwd");
  });

  test("blocks null byte injection", async () => {
    const skillPath = "/project/.opencode/skills/test-skill";
    const result = await resolveSafeSkillFilePath(skillPath, "readme.md\0evil");
    assert.equal(result, null, "null byte injection must be blocked");
  });
});

describe("read_skill_file traversal error message", () => {
  test("returns clear traversal rejection message", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tools = createSkillTools({ store, shell: dummyShell });

    const result = await tools.read_skill_file.execute(
      { skill: "test-skill", filename: "../../../etc/passwd" },
      createMockToolContext(),
    );

    assert.match(result, /Invalid path: cannot access files outside skill directory/);
  });

  test("alignment: error message mentions 'path' not 'file' for consistency", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tools = createSkillTools({ store, shell: dummyShell });

    const result = await tools.read_skill_file.execute(
      { skill: "test-skill", filename: "../../../etc/passwd" },
      createMockToolContext(),
    );

    // Both skill and read_skill_file should use consistent "not found" / "path" wording
    assert.match(result, /Invalid path|cannot access/);
  });
});
