import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SkillSummary } from "../../src/core/index";

/**
 * Helper functions in `src/opencode/plugin.ts` that were promoted to
 * named exports in PR 2 so they can be tested in isolation. The
 * `as unknown as PluginModule` cast keeps the test file type-safe while
 * the dynamic import path gives the test runner a chance to load the
 * module under test (and lets it throw a clean "is not a function"
 * error in the RED state).
 */
type PluginModule = {
  matchSkillsByKeyword: (userMessage: string, availableSkills: SkillSummary[]) => SkillSummary[];
  formatMatchedSkillsInjection: (matchedSkills: SkillSummary[]) => string;
};

async function loadPluginModule(): Promise<PluginModule> {
  return (await import("../../src/opencode/plugin")) as unknown as PluginModule;
}

/**
 * Tests for the OpenCode keyword matcher and the synthetic injection
 * formatter. These were promoted to named exports in PR 2 of
 * `trigger-aware-skill-discovery` so the trigger-aware behaviour can
 * be exercised without standing up a full plugin session.
 *
 * Coverage:
 *   - matchSkillsByKeyword: trigger match (1.5x) outranks description match (1x) for the same query
 *   - matchSkillsByKeyword: trigger match does not outrank name match (2x) for the same query
 *   - matchSkillsByKeyword: skills without a trigger are scored as before (no regression)
 *   - formatMatchedSkillsInjection: trigger text appears in each matched-skill line
 *   - formatMatchedSkillsInjection: skills with no trigger render exactly as before
 */
describe("matchSkillsByKeyword", () => {
  test("trigger match (1.5x) outranks description match (1x) at the same query (R4)", async () => {
    const { matchSkillsByKeyword } = await loadPluginModule();
    const descSkill: SkillSummary = {
      name: "skill-x",
      description: "auth helper for tokens",
    };
    const triggerSkill: SkillSummary = {
      name: "skill-y",
      description: "unrelated",
      trigger: "auth login",
    };

    const result = matchSkillsByKeyword("auth", [descSkill, triggerSkill]);

    assert.equal(result.length, 2);
    assert.equal(result[0]?.name, "skill-y", "trigger-matched skill ranks first");
    assert.equal(result[1]?.name, "skill-x", "description-matched skill ranks second");
  });

  test("name match (2x) still outranks trigger match (1.5x) at the same query", async () => {
    const { matchSkillsByKeyword } = await loadPluginModule();
    const nameSkill: SkillSummary = { name: "auth", description: "x" };
    const triggerSkill: SkillSummary = { name: "skill-y", description: "x", trigger: "auth login" };

    const result = matchSkillsByKeyword("auth", [nameSkill, triggerSkill]);

    assert.equal(result[0]?.name, "auth", "name match wins over trigger match");
    assert.equal(result[1]?.name, "skill-y");
  });

  test("skills with no trigger are scored only on name + description (no regression)", async () => {
    const { matchSkillsByKeyword } = await loadPluginModule();
    const noTriggerA: SkillSummary = { name: "alpha", description: "auth helper" };
    const noTriggerB: SkillSummary = { name: "beta", description: "noise" };

    const result = matchSkillsByKeyword("auth", [noTriggerA, noTriggerB]);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "alpha");
  });
});

describe("formatMatchedSkillsInjection", () => {
  test("renders the trigger text on a sub-line for each matched skill (R5)", async () => {
    const { formatMatchedSkillsInjection } = await loadPluginModule();
    const matched: SkillSummary[] = [
      { name: "skill-y", description: "unrelated", trigger: "auth login" },
    ];

    const output = formatMatchedSkillsInjection(matched);

    assert.match(output, /skill-y/, "name appears");
    assert.match(output, /trigger: auth login/, "trigger text is rendered on its own line");
  });

  test("skills with no trigger render exactly as before (no extra line)", async () => {
    const { formatMatchedSkillsInjection } = await loadPluginModule();
    const matched: SkillSummary[] = [
      { name: "alpha", description: "auth helper" },
    ];

    const output = formatMatchedSkillsInjection(matched);

    assert.match(output, /- alpha: auth helper/);
    assert.doesNotMatch(output, /trigger:/, "no trigger line when trigger is undefined");
  });

  test("multiple matched skills each render their own trigger line", async () => {
    const { formatMatchedSkillsInjection } = await loadPluginModule();
    const matched: SkillSummary[] = [
      { name: "with-trigger", description: "x", trigger: "auth, login" },
      { name: "no-trigger", description: "y" },
    ];

    const output = formatMatchedSkillsInjection(matched);

    assert.match(output, /- with-trigger: x\s+trigger: auth, login/);
    assert.match(output, /- no-trigger: y/);
  });
});
