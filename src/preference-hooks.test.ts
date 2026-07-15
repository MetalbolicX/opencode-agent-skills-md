/**
 * Tests for preference-hooks module.
 *
 * These tests verify the preference-layer hooks:
 *   - applySystemTransform pushes the <skill-preference-policy> block to output.system
 *   - applyToolDefinition appends a one-sentence note to output.description for target tools
 *   - isPreferenceLayerEnabled gates on OPENCODE_AGENT_SKILLS_PREFERENCE_MODE
 *
 * RED because src/preference-hooks.ts does not exist yet.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { SkillSummary } from "./types";
import {
  applySystemTransform,
  applyToolDefinition,
  isPreferenceLayerEnabled,
  NATIVE_TOOL_PREFERENCE_NOTE,
  PREFERENCE_TOOL_IDS,
} from "./preference-hooks";

const makeSummary = (overrides: Partial<SkillSummary> = {}): SkillSummary => {
  return {
    name: "default-skill",
    description: "default description",
    ...overrides,
  };
};

const ENV_VAR = "OPENCODE_AGENT_SKILLS_PREFERENCE_MODE";
const PREVIOUS_ENV = process.env[ENV_VAR];

describe("PREFERENCE_TOOL_IDS", () => {
  test("contains the eight documented native tools and nothing else", () => {
    const expected = new Set([
      "read",
      "write",
      "edit",
      "bash",
      "task",
      "glob",
      "grep",
      "webfetch",
    ]);
    assert.deepEqual(
      Array.from(PREFERENCE_TOOL_IDS).sort(),
      Array.from(expected).sort(),
    );
    assert.equal(PREFERENCE_TOOL_IDS.size, expected.size);
  });
});

describe("applySystemTransform", () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (PREVIOUS_ENV === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = PREVIOUS_ENV;
    }
  });

  test("appends the policy block to output.system when enabled", () => {
    const summaries: SkillSummary[] = [
      makeSummary({ name: "alpha", description: "first" }),
      makeSummary({ name: "bravo", description: "second" }),
    ];
    const output: { system: string[] } = { system: ["<existing-system>"] };

    const pushed = applySystemTransform(summaries, output);

    assert.equal(pushed, true, "returns true on success");
    assert.equal(output.system.length, 2, "policy block appended (existing entry preserved)");
    assert.equal(output.system[0], "<existing-system>", "existing entry is not mutated");
    assert.match(output.system[1] ?? "", /<skill-preference-policy>/);
    assert.match(output.system[1] ?? "", /^- alpha: first$/m);
    assert.match(output.system[1] ?? "", /^- bravo: second$/m);
  });

  test("still pushes a valid (but empty-catalog) block when no skills are available", () => {
    const output: { system: string[] } = { system: [] };

    const pushed = applySystemTransform([], output);

    assert.equal(pushed, true);
    assert.equal(output.system.length, 1);
    assert.match(output.system[0] ?? "", /<skill-preference-policy>/);
    assert.match(output.system[0] ?? "", /<skill-catalog>/);
    assert.doesNotMatch(output.system[0] ?? "", /^- /m, "empty catalog must not invent entries");
  });

  test("does nothing when the env var is the literal 'off'", () => {
    process.env[ENV_VAR] = "off";
    const output: { system: string[] } = { system: ["<existing>"] };

    const pushed = applySystemTransform(
      [makeSummary({ name: "alpha", description: "first" })],
      output,
    );

    assert.equal(pushed, false, "returns false when the layer is disabled");
    assert.deepEqual(output.system, ["<existing>"], "no push when the layer is disabled");
  });

  test("recovers gracefully when output.system is missing (defensive push target)", () => {
    const output = {} as { system?: string[] };

    const pushed = applySystemTransform(
      [makeSummary({ name: "alpha", description: "first" })],
      output,
    );

    assert.equal(pushed, true);
    assert.ok(Array.isArray(output.system), "system array is initialized");
    assert.equal(output.system!.length, 1);
    assert.match(output.system![0] ?? "", /<skill-preference-policy>/);
  });
});

describe("applyToolDefinition", () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (PREVIOUS_ENV === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = PREVIOUS_ENV;
    }
  });

  test("appends the note to description when toolID is in PREFERENCE_TOOL_IDS", () => {
    const input: { toolID: string } = { toolID: "read" };
    const output: { description: string; parameters: Record<string, unknown> } = {
      description: "Read a file from disk.",
      parameters: { type: "object" },
    };

    const annotated = applyToolDefinition(input as any, output as any);

    assert.equal(annotated, true);
    assert.match(output.description, /^Read a file from disk\./);
    assert.match(output.description, /skill/i, "note mentions skill");
    assert.ok(
      output.description.includes(NATIVE_TOOL_PREFERENCE_NOTE.trim()),
      "description includes the appended note (trimmed)",
    );
    // parameters must NOT be mutated.
    assert.deepEqual(output.parameters, { type: "object" });
  });

  test("does not annotate tools outside PREFERENCE_TOOL_IDS", () => {
    const input: { toolID: string } = { toolID: "todowrite" };
    const output: { description: string; parameters: Record<string, unknown> } = {
      description: "Original description.",
      parameters: { type: "object" },
    };

    const annotated = applyToolDefinition(input as any, output as any);

    assert.equal(annotated, false, "returns false on a non-target tool");
    assert.equal(output.description, "Original description.", "description is unchanged");
    assert.deepEqual(output.parameters, { type: "object" }, "parameters is unchanged");
  });

  test("does not annotate when the env var is the literal 'off'", () => {
    process.env[ENV_VAR] = "off";
    const input: { toolID: string } = { toolID: "read" };
    const output: { description: string; parameters: Record<string, unknown> } = {
      description: "Original.",
      parameters: { type: "object" },
    };

    const annotated = applyToolDefinition(input as any, output as any);

    assert.equal(annotated, false);
    assert.equal(output.description, "Original.");
  });

  test("does not annotate when input.toolID is missing or not a string", () => {
    const output: { description: string; parameters: Record<string, unknown> } = {
      description: "Original.",
      parameters: { type: "object" },
    };

    assert.equal(
      applyToolDefinition({} as any, output as any),
      false,
      "empty input is ignored",
    );
    assert.equal(
      applyToolDefinition({ toolID: undefined } as any, output as any),
      false,
      "non-string toolID is ignored",
    );
    assert.equal(output.description, "Original.");
  });

  test("recovers gracefully when output.description is missing", () => {
    const input: { toolID: string } = { toolID: "edit" };
    const output = { parameters: { type: "object" } } as { description?: string; parameters: Record<string, unknown> };

    const annotated = applyToolDefinition(input as any, output as any);

    assert.equal(annotated, true);
    assert.match(output.description ?? "", /skill/i, "description was initialized then annotated");
    assert.deepEqual(output.parameters, { type: "object" });
  });

  test("annotates every documented native tool in the set", () => {
    const output: { description: string; parameters: Record<string, unknown> } = {
      description: "base",
      parameters: {},
    };
    for (const toolID of PREFERENCE_TOOL_IDS) {
      const fresh: { description: string; parameters: Record<string, unknown> } = {
        description: "base",
        parameters: {},
      };
      const annotated = applyToolDefinition({ toolID } as any, fresh as any);
      assert.equal(annotated, true, `${toolID} must be annotated`);
      assert.ok(
        fresh.description.length > "base".length,
        `${toolID} description must be longer than the original`,
      );
      assert.match(fresh.description, /skill/i);
    }
  });
});

describe("isPreferenceLayerEnabled", () => {
  const previousEnv = process.env[ENV_VAR];

  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previousEnv;
    }
  });

  test("returns true when env var is unset (default-on)", () => {
    delete process.env[ENV_VAR];
    assert.equal(isPreferenceLayerEnabled(), true);
  });

  test("returns false when env var is 'off'", () => {
    process.env[ENV_VAR] = "off";
    assert.equal(isPreferenceLayerEnabled(), false);
  });

  test("returns true for any other value (literal-match per design)", () => {
    process.env[ENV_VAR] = "true";
    assert.equal(isPreferenceLayerEnabled(), true);
    process.env[ENV_VAR] = "disabled";
    assert.equal(isPreferenceLayerEnabled(), true);
  });
});

describe("NATIVE_TOOL_PREFERENCE_NOTE (model-switching guard)", () => {
  test("does not reference use_skill (OpenCode issue #4475)", () => {
    assert.ok(
      !NATIVE_TOOL_PREFERENCE_NOTE.includes("use_skill"),
      `NATIVE_TOOL_PREFERENCE_NOTE must not reference use_skill — see preference.ts BOUNDARY comment. Got: ${NATIVE_TOOL_PREFERENCE_NOTE}`,
    );
    assert.ok(
      NATIVE_TOOL_PREFERENCE_NOTE.includes('skill("'),
      "NATIVE_TOOL_PREFERENCE_NOTE should reference skill(\"...\") instead",
    );
  });
});
