import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SkillSummary } from "../src/index";

/**
 * Preference layer renderer and enablement tests.
 *
 * Covers the three pure functions exported by `packages/core/src/preference.ts`:
 *
 *   - `renderSkillPreferenceSystemBlock` builds the system-prompt policy
 *     block plus its one-line catalog. Empty catalog must still produce a
 *     valid block without invented entries (spec: "Empty catalog is allowed").
 *
 *   - `renderSkillPreflightBlock` renders the matched-skill directive block
 *     that injects `use_skill("<name>")` for each skill the keyword matcher
 *     found. Empty input returns an empty string so callers can skip
 *     injection cleanly.
 *
 *   - `isPreferenceModeEnabled` gates every preference-layer behavior from a
 *     single env-var read. Default is enabled; only literal `off` disables.
 */
function makeSummary(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "default-skill",
    description: "default description",
    ...overrides,
  };
}

describe("renderSkillPreferenceSystemBlock", () => {
  test("renders a one-line catalog entry per skill", async () => {
    const { renderSkillPreferenceSystemBlock } = await import("../src/index");
    const summaries: SkillSummary[] = [
      makeSummary({ name: "alpha", description: "first skill" }),
      makeSummary({ name: "bravo", description: "second skill" }),
      makeSummary({ name: "charlie", description: "third skill" }),
    ];

    const output = renderSkillPreferenceSystemBlock(summaries);

    assert.match(output, /^- alpha: first skill$/m);
    assert.match(output, /^- bravo: second skill$/m);
    assert.match(output, /^- charlie: third skill$/m);
  });

  test("wraps the policy and the catalog in dedicated tags", async () => {
    const { renderSkillPreferenceSystemBlock } = await import("../src/index");
    const output = renderSkillPreferenceSystemBlock([
      makeSummary({ name: "alpha", description: "first" }),
    ]);

    assert.match(output, /<skill-preference-policy>/);
    assert.match(output, /<\/skill-preference-policy>/);
    assert.match(output, /<skill-catalog>/);
    assert.match(output, /<\/skill-catalog>/);
  });

  test("includes the skill-first policy text alongside the catalog", async () => {
    const { renderSkillPreferenceSystemBlock } = await import("../src/index");
    const output = renderSkillPreferenceSystemBlock([
      makeSummary({ name: "alpha", description: "first" }),
    ]);

    assert.match(output, /use_skill/i);
    assert.match(output, /<skill-catalog>/);
  });

  test("empty skill list still renders a valid block with no invented entries", async () => {
    const { renderSkillPreferenceSystemBlock } = await import("../src/index");
    const output = renderSkillPreferenceSystemBlock([]);

    assert.match(output, /<skill-preference-policy>/);
    assert.match(output, /<\/skill-preference-policy>/);
    assert.match(output, /<skill-catalog>/);
    assert.match(output, /<\/skill-catalog>/);
    assert.doesNotMatch(
      output,
      /^- /m,
      "must not invent catalog entries when the skill list is empty",
    );
  });
});

describe("renderSkillPreflightBlock", () => {
  test("renders a use_skill directive per matched skill", async () => {
    const { renderSkillPreflightBlock } = await import("../src/index");
    const summaries: SkillSummary[] = [
      makeSummary({ name: "alpha", description: "first" }),
      makeSummary({ name: "bravo", description: "second" }),
    ];

    const output = renderSkillPreflightBlock(summaries);

    assert.match(output, /<skill-preflight>/);
    assert.match(output, /<\/skill-preflight>/);
    assert.match(output, /use_skill\("alpha"\)/);
    assert.match(output, /use_skill\("bravo"\)/);
  });

  test("returns an empty string when no skills are matched", async () => {
    const { renderSkillPreflightBlock } = await import("../src/index");
    assert.equal(renderSkillPreflightBlock([]), "");
  });
});

describe("isPreferenceModeEnabled", () => {
  test("returns true when env var is unset (default-on)", async () => {
    const { isPreferenceModeEnabled } = await import("../src/index");
    assert.equal(isPreferenceModeEnabled(undefined), true);
  });

  test("returns true when env var is the empty string", async () => {
    const { isPreferenceModeEnabled } = await import("../src/index");
    assert.equal(isPreferenceModeEnabled(""), true);
  });

  test("returns false when env var is the literal string 'off'", async () => {
    const { isPreferenceModeEnabled } = await import("../src/index");
    assert.equal(isPreferenceModeEnabled("off"), false);
  });

  test("treats any other value as enabled", async () => {
    const { isPreferenceModeEnabled } = await import("../src/index");
    assert.equal(isPreferenceModeEnabled("true"), true);
    assert.equal(isPreferenceModeEnabled("on"), true);
    assert.equal(isPreferenceModeEnabled("disabled"), true);
    assert.equal(isPreferenceModeEnabled("false"), true);
    assert.equal(isPreferenceModeEnabled("0"), true);
  });
});
