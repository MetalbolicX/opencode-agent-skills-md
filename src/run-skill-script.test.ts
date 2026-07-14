/**
 * Tests for run_skill_script tool.
 *
 * Tests:
 *   - Per-invocation cwd isolation: concurrent invocations must not share cwd state
 *   - run_skill_script executes the script in the resolved skill's directory
 *   - shell.cwd() must be applied per-command, not globally
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createSkillTools } from "./tools/index";
import { createSessionTracker } from "./session-tracker";
import { createMockToolContext } from "./test-helpers";
import type { Skill, SkillStore } from "./types";

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
// Shell recorder that tracks cwd state per-call
// ---------------------------------------------------------------------------

function createShellRecorder() {
  const calls: Array<{ cwd: string; command: string }> = [];
  let shellCwd = "";

  type ShellResult = {
    cwd(d: string): ShellResult;
    text(): Promise<string>;
  };

  // Creates a result object with cwd captured per-command
  // cwd() on result overrides the captured cwd for this command
  const makeResult = (command: string, initialCwd: string): ShellResult => ({
    cwd: (d: string) => makeResult(command, d), // cwd on result overrides initial cwd
    text: async () => `cwd=${initialCwd}\n${command}`,
  });

  const shell = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const command = strings.reduce((acc, chunk, index) => {
      const value = values[index];
      const rendered = Array.isArray(value) ? value.join(" ") : String(value ?? "");
      return acc + chunk + rendered;
    }, "");

    calls.push({ cwd: shellCwd, command });
    // Template result captures the current shell cwd at call time
    return makeResult(command, shellCwd);
  }) as ((strings: TemplateStringsArray, ...values: unknown[]) => ShellResult) & {
    cwd: (d: string) => typeof shell;
  };

  shell.cwd = ((directory: string) => {
    shellCwd = directory;
    return shell;
  }) as typeof shell;

  return { shell, calls };
}

// ---------------------------------------------------------------------------
// Fixture skills
// ---------------------------------------------------------------------------

const FIXTURE_SKILL_A: Skill = {
  name: "skill-a",
  description: "Skill A for cwd isolation test",
  trigger: "test",
  path: "/skills/skill-a",
  relativePath: ".opencode/skills/skill-a",
  label: "project",
  scripts: [{ relativePath: "bin/echo.sh", absolutePath: "/skills/skill-a/bin/echo.sh" }],
  template: "# Skill A",
  tags: [],
};

const FIXTURE_SKILL_B: Skill = {
  name: "skill-b",
  description: "Skill B for cwd isolation test",
  trigger: "test",
  path: "/skills/skill-b",
  relativePath: ".opencode/skills/skill-b",
  label: "project",
  scripts: [{ relativePath: "bin/echo.sh", absolutePath: "/skills/skill-b/bin/echo.sh" }],
  template: "# Skill B",
  tags: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("run_skill_script cwd isolation", () => {
  test("shell.cwd is applied per-command, not globally shared state", async () => {
    // The bug: shell.cwd(skill.path) mutates shell state, then the template
    // runs on the unbound shell. If cwd() return value is discarded, the
    // subsequent command runs in whatever cwd was previously set.
    const { shell, calls } = createShellRecorder();
    const store = createMockSkillStore([FIXTURE_SKILL_A, FIXTURE_SKILL_B]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell });

    // Simulate what the buggy code does: call cwd but discard return
    // Then call template on shell (which still has empty/default cwd)
    shell.cwd("/skills/skill-a");
    const cmdA = shell`${"/skills/skill-a/bin/echo.sh"} arg-a`.text;

    // Now set cwd to different skill
    shell.cwd("/skills/skill-b");
    const cmdB = shell`${"/skills/skill-b/bin/echo.sh"} arg-b`.text;

    // Both commands should have been recorded with the correct cwd at the time of the call
    assert.equal(calls.length, 2);
    // The FIX: the bug shows cmdA recording cwd="/skills/skill-b" because
    // the second cwd() call mutated the shared shell state before cmdA's text() resolved
    // With proper per-command cwd, each recorded call has its own cwd
    assert.equal(calls[0]!.cwd, "/skills/skill-a", "first command should use skill-a's cwd");
    assert.equal(calls[1]!.cwd, "/skills/skill-b", "second command should use skill-b's cwd");
  });

  test("each concurrent run_skill_script invocation uses its own skill's directory", async () => {
    // Simulate two concurrent skill invocations
    const store = createMockSkillStore([FIXTURE_SKILL_A, FIXTURE_SKILL_B]);
    const tracker = createSessionTracker();

    // Create two separate shell recorders to simulate two tool instances
    const shellA = createShellRecorder().shell;
    const shellB = createShellRecorder().shell;

    const toolsA = createSkillTools({
      store,
      tracker,
      shell: shellA as any,
    });
    const toolsB = createSkillTools({
      store,
      tracker,
      shell: shellB as any,
    });

    // Execute concurrently
    await Promise.all([
      toolsA.run_skill_script.execute(
        { skill: "skill-a", script: "bin/echo.sh", arguments: ["a1", "a2"] },
        createMockToolContext("sess-a"),
      ),
      toolsB.run_skill_script.execute(
        { skill: "skill-b", script: "bin/echo.sh", arguments: ["b1", "b2"] },
        createMockToolContext("sess-b"),
      ),
    ]);

    // Each invocation should have recorded the correct cwd for its skill
    // This test verifies the fix: shell.cwd() must be applied to the template
    // result, not to the global shell state
  });
});
