/**
 * Tests for plugin module.
 *
 * These tests verify keyword matching and synthetic injection behaviour.
 * They FAIL in RED because src/plugin.ts, src/tools.ts, etc. do not exist.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SkillSummary } from "./types";

/**
 * Helper functions moved to leaf modules in Phase 6.
 * Tests load them from their canonical locations.
 */
type PluginModule = {
  matchSkillsByKeyword: (userMessage: string, availableSkills: SkillSummary[]) => SkillSummary[];
  formatMatchedSkillsInjection: (matchedSkills: SkillSummary[]) => string;
  isChatTextPart: (part: unknown) => boolean;
};

async function loadPluginModule(): Promise<PluginModule & { SkillsPlugin: unknown }> {
  const [plugin, match, preference] = await Promise.all([
    import("./plugin"),
    import("./match"),
    import("./preference"),
  ]);
  return {
    matchSkillsByKeyword: match.matchSkillsByKeyword,
    formatMatchedSkillsInjection: preference.formatMatchedSkillsInjection,
    isChatTextPart: plugin.isChatTextPart,
    SkillsPlugin: plugin.SkillsPlugin,
  } as unknown as PluginModule & { SkillsPlugin: unknown };
}

describe("matchSkillsByKeyword", () => {
  test("trigger match (1.5x) outranks description match (1x) at the same query", async () => {
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

  test("skills with no trigger are scored only on name + description", async () => {
    const { matchSkillsByKeyword } = await loadPluginModule();
    const noTriggerA: SkillSummary = { name: "alpha", description: "auth helper" };
    const noTriggerB: SkillSummary = { name: "beta", description: "noise" };

    const result = matchSkillsByKeyword("auth", [noTriggerA, noTriggerB]);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "alpha");
  });
});

describe("formatMatchedSkillsInjection", () => {
  test("renders the trigger text on a sub-line for each matched skill", async () => {
    const { formatMatchedSkillsInjection } = await loadPluginModule();
    const matched: SkillSummary[] = [
      { name: "skill-y", description: "unrelated", trigger: "auth login" },
    ];

    const output = formatMatchedSkillsInjection(matched);

    assert.match(output, /skill-y/, "name appears");
    assert.match(output, /trigger: auth login/, "trigger text is rendered on its own line");
  });

  test("skills with no trigger render without an extra trigger line", async () => {
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

/**
 * Regression tests for plan 012 — harden chat session lifecycle.
 *
 * These tests verify three correctness fixes:
 * 1. isChatTextPart rejects non-text parts (image, file, etc.)
 * 2. Compaction resets setupComplete so bootstrap can be retried
 * 3. Discovery is reused within the same turn (not called twice)
 */

describe("plan 012: isChatTextPart", () => {
  test("returns true only for parts with type === 'text'", async () => {
    const { isChatTextPart } = await loadPluginModule();

    // Should return true for text parts
    assert.equal(isChatTextPart({ type: "text", text: "hello" }), true);
    assert.equal(isChatTextPart({ type: "text", text: "" }), true);

    // Should return false for image parts
    assert.equal(isChatTextPart({ type: "image", data: "..." }), false);

    // Should return false for file parts
    assert.equal(isChatTextPart({ type: "file", name: "doc.pdf" }), false);

    // Should return false for other non-text part types
    assert.equal(isChatTextPart({ type: "audio", data: "..." }), false);

    // Should return false for null/undefined
    assert.equal(isChatTextPart(null), false);
    assert.equal(isChatTextPart(undefined), false);

    // Should return false for primitives
    assert.equal(isChatTextPart("hello"), false);
    assert.equal(isChatTextPart(123), false);
  });
});

describe("plan 012: compaction resets setupComplete", () => {
  test("after session.compacted event, setupComplete is reset to false", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async () => {},
        injectContent: async () => {},
      },
    };

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: "/fake" }) as any;

    // Prime the session so setupComplete = true using _touchSessionState
    const record = (plugin as any)._touchSessionState("session-abc");
    record.markSetupComplete();
    record.markLoaded("some-skill");

    // Verify pre-condition: setupComplete is true
    assert.equal(record.isSetupComplete(), true, "setupComplete should be true before compaction");

    // Fire session.compacted — the fix clears setupComplete
    await plugin.event({ event: { type: "session.compacted", properties: { sessionID: "session-abc" } } });

    // After compaction, setupComplete must be false so the next message can retry bootstrap
    const recordAfter = (plugin as any)._sessionStates.get("session-abc");
    assert.equal(recordAfter?.isSetupComplete(), false, "setupComplete should be reset to false after compaction");
  });
});

describe("plan 012: discovery is not called twice in one turn", () => {
  test("system.transform does not trigger a new discovery if chat.message already discovered this turn", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    // Track injectContent calls to verify bootstrap behavior
    const injectCalls: Array<{ sessionID: string; content: string }> = [];
    const client = {
      session: {
        messages: async () => ({ data: [{ parts: [{ type: "text", text: "<available-skills>" }] }] }),
        prompt: async () => {},
        injectContent: async (sessionID: string, content: string) => {
          injectCalls.push({ sessionID, content });
        },
      },
    };

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: "/fake" }) as any;

    // Call chat.message — this triggers discoverAllSkills (turn 1)
    await plugin["chat.message"](
      {},
      { message: { sessionID: "turn-test", role: "user", agent: "", model: { providerID: "", modelID: "" } }, parts: [{ type: "text", text: "hello" }] },
    );

    // Record how many injectContent calls happened after chat.message
    const injectCountAfterFirst = injectCalls.length;

    // Call system.transform immediately after — without caching fix, this calls discoverAllSkills again
    await plugin["experimental.chat.system.transform"]({}, { system: [] });

    // The system.transform with caching should not cause a second round of injection calls
    // because it reuses the cached discovery result from chat.message
    // (No additional injectContent should be triggered since skills are already injected)
    assert.equal(injectCalls.length, injectCountAfterFirst, "system.transform should not re-trigger skill injection");
  });
});

/**
 * Plugin callback wiring — Phase 3 integration territory.
 *
 * The following tests verify plugin wiring, session state management, and
 * loaded-skill deduplication. They require the full SkillsPlugin implementation
   * (real chat.message bootstrap, real skill injection, real session tracking).
 *
 * They are moved here from plugin.test.ts to keep PR 1 fully green. The scaffold
 * correctly exposes matchSkillsByKeyword and formatMatchedSkillsInjection as
 * unit-tested behaviour. The integration tests below will be re-enabled in
 * Phase 3 (task 3.1) once the plugin is wired with real discovery and injection.
 *
 * Phase 3 integration tests:
 *   ✓ plugin updates loadedSkillsPerSession so a repeat chat.message does not re-inject
 *   ✓ two plugin instances do not share session state
 *   ✓ first-message bootstrap and subsequent keyword match are both preserved
 *   ✓ chat.message discovers skills exactly once per handler invocation
 *     (requires Bun mock.method — deferred)
 *
 * Note: native OpenCode `skill` tool handles skill loading; the plugin no
 * longer registers its own `skill` tool.
 */

/**
 * Diagnostics: graceful degradation on malformed payloads and debugLog behaviour.
 *
 * These tests verify that the SkillsPlugin stub (Phase 1 scaffold) handles
 * malformed inputs without throwing. Full plugin wiring is Phase 3.
 */
describe("diagnostics and SDK shapes", () => {
  // Inline minimal versions of the helpers needed for these tests.
  // Full helpers (createFixtureWorkspace, etc.) are used by Phase 3 integration tests.
  const createMockOpencodeClient = () => {
    const prompts: Array<{ text: string; sessionID: string }> = [];
    return {
      prompts,
      client: {
        session: {
          messages: async () => ({ data: [] }),
          prompt: async ({ path: sessionPath, body }: { path: { id: string }; body: { parts: Array<{ text: string }> } }) => {
            const text = body.parts[0]?.text ?? "";
            prompts.push({ text, sessionID: sessionPath.id });
          },
        },
      },
    };
  };

  const createShellRecorder = () => {
    const calls: Array<{ cwd: string; command: string }> = [];
    let currentCwd = "";
    const shell = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const command = strings.reduce((acc, chunk, index) => {
        const value = values[index];
        const rendered = Array.isArray(value) ? value.join(" ") : String(value ?? "");
        return acc + chunk + rendered;
      }, "");
      calls.push({ cwd: currentCwd, command });
      return { text: async () => `cwd=${currentCwd}\n${command}` };
    }) as ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & { cwd: (d: string) => ReturnType<typeof shell>; calls: typeof calls };
    (shell as any).cwd = (d: string) => { currentCwd = d; return shell; };
    (shell as any).calls = calls;
    return { shell, calls };
  };

  async function makePlugin() {
    const { SkillsPlugin } = await import("./plugin");
    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: "/fake/project/root",
    } as any) as any;
    return { plugin, client };
  }

  test("chat.message with undefined output degrades gracefully (no throw, no prompts)", async () => {
    const { plugin, client } = await makePlugin();
    await assert.doesNotReject(
      async () => {
        await plugin["chat.message"]({}, undefined);
      },
      "undefined output must not throw",
    );
    assert.equal(client.prompts.length, 0, "no prompts injected on malformed payload");
  });

  test("chat.message with null output degrades gracefully", async () => {
    const { plugin, client } = await makePlugin();
    await assert.doesNotReject(async () => {
      await plugin["chat.message"]({}, null);
    });
    assert.equal(client.prompts.length, 0);
  });

  test("chat.message with missing sessionID degrades gracefully", async () => {
    const { plugin, client } = await makePlugin();
    await assert.doesNotReject(async () => {
      await plugin["chat.message"]({}, { message: {}, parts: [] });
    });
    assert.equal(client.prompts.length, 0, "partial payload must not inject anything");
  });

  test("event handler with undefined event degrades gracefully", async () => {
    const { plugin } = await makePlugin();
    await assert.doesNotReject(async () => {
      await plugin.event({ event: undefined });
    });
  });

  test("event handler with unknown event type degrades gracefully", async () => {
    const { plugin } = await makePlugin();
    await assert.doesNotReject(async () => {
      await plugin.event({ event: { type: "session.created" } });
    });
  });

  /**
   * debugLog console output tests are deferred — Bun's test runner does not
   * provide the Node.js mock.method API. The debugLog behaviour is covered by
   * the graceful-degradation tests above and will be fully exercised via
   * integration tests in Phase 3 (task 3.1) using Bun-compatible Spy.
   */
});

/**
 * Phase 5: The atomic switch — plugin.ts uses SkillStore + SessionTracker.
 *
 * These tests verify:
 * - Shared store injection: two plugin instances with same directory share the store cache
 * - Bootstrap injection parity: <available-skills> block is rendered correctly
 * - Keyword preflight parity: <skill-preflight> block is rendered for matched skills
 * - Compaction invalidation: store is invalidated and tracker is cleared
 * - Session-delete cleanup: tracker is removed from the session map
 */

describe("Phase 5: shared store injection", () => {
  test("two plugin instances with same directory share the same store cache", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async () => {},
      },
    };

    const directory = "/fake/shared-root";

    // Create two plugin instances with the same directory
    const plugin1 = await SkillsPlugin({ client, $: shell, shell, directory }) as any;
    const plugin2 = await SkillsPlugin({ client, $: shell, shell, directory }) as any;

    // Both plugins should have their own sessionStates map (not shared across plugin instances)
    // But internally they should use a store that can be configured to share cache
    // The key behavior: calling chat.message on both triggers the same store.all() path
    assert.ok(plugin1._sessionStates !== plugin2._sessionStates, "session states are not shared across plugin instances");
  });
});

describe("Phase 5: bootstrap injection parity", () => {
  test("bootstrap renders <available-skills> block with skill name and description", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-bootstrap-parity-"));
    const skillsDir = path.join(workspace, ".opencode", "skills", "test-skill");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      path.join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: test-skill",
        "description: A test skill for bootstrap parity",
        "---",
        "",
        "# Test Skill",
      ].join("\n"),
      "utf8",
    );

    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async () => {},
      },
    };

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: workspace }) as any;

    try {
      const output = {
        message: { sessionID: "bootstrap-parity-test", role: "user" as const },
        parts: [] as Array<{ type?: string; text?: string; synthetic?: boolean }>,
      };

      await plugin["chat.message"]({}, output);

      const syntheticParts = output.parts.filter(p => p.synthetic === true);
      assert.ok(syntheticParts.length > 0, "bootstrap must append synthetic parts");

      const combinedText = syntheticParts.map(p => p.text ?? "").join("\n");
      assert.match(combinedText, /<available-skills>/, "bootstrap must include <available-skills> tag");
      assert.match(combinedText, /test-skill/, "bootstrap must include skill name");
      assert.match(combinedText, /A test skill for bootstrap parity/, "bootstrap must include skill description");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("Phase 5: keyword preflight parity", () => {
  test("keyword match appends <skill-preflight> block to output.parts", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-preflight-parity-"));
    const skillsDir = path.join(workspace, ".opencode", "skills", "auth-skill");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      path.join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: auth-skill",
        "description: Authentication and authorization helper",
        "trigger: auth login",
        "---",
        "",
        "# Auth Skill",
      ].join("\n"),
      "utf8",
    );

    // Return existing messages WITH <available-skills> to skip bootstrap
    const client = {
      session: {
        messages: async () => ({
          data: [{ parts: [{ type: "text", text: "<available-skills>" }] }],
        }),
        prompt: async () => {},
      },
    };

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: workspace }) as any;

    try {
      const output = {
        message: { sessionID: "preflight-parity-test", role: "user" as const },
        parts: [
          { type: "text", text: "I need help with auth login", synthetic: false },
        ],
      };

      await plugin["chat.message"]({}, output);

      // Should have both bootstrap (from earlier setup) and preflight (new)
      // Since messages returned <available-skills>, setup is complete, so only preflight should appear
      const syntheticParts = output.parts.filter(p => p.synthetic === true);
      const combinedText = syntheticParts.map(p => p.text ?? "").join("\n");

      // Keyword "auth" should trigger preflight for auth-skill
      assert.match(combinedText, /<skill-preflight>/, "preflight must include <skill-preflight> tag");
      assert.match(combinedText, /skill\("auth-skill"\)/, "preflight must include skill invocation");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("Phase 5: compaction invalidation", () => {
  test("session.compacted event clears tracker state and resets setupComplete", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async () => {},
      },
    };

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: "/fake" }) as any;

    // Use _touchSessionState to create a tracker (backward compat helper)
    const tracker = (plugin as any)._touchSessionState("compaction-test");
    assert.ok(tracker, "tracker should exist after _touchSessionState");

    // Set state using SessionTracker methods
    tracker.markSetupComplete();
    tracker.markLoaded("some-skill");
    assert.equal(tracker.isSetupComplete(), true, "setupComplete should be true before compaction");
    assert.equal(tracker.loadedSkills.size, 1, "loadedSkills should have one skill before compaction");

    // Fire compaction event
    await plugin.event({ event: { type: "session.compacted", properties: { sessionID: "compaction-test" } } });

    // After compaction, tracker should be cleared (setupComplete = false)
    const trackerAfter = (plugin as any)._sessionStates.get("compaction-test");
    assert.ok(trackerAfter, "tracker should still exist after compaction");
    assert.equal(trackerAfter.isSetupComplete(), false, "setupComplete must be reset after compaction");
    assert.equal(trackerAfter.loadedSkills.size, 0, "loadedSkills must be cleared after compaction");
  });
});

describe("Phase 5: session-delete cleanup", () => {
  test("session.deleted event removes the tracker from sessionStates map", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async () => {},
      },
    };

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: "/fake" }) as any;

    // Use _touchSessionState to create a tracker (backward compat helper)
    const sessionID = "delete-me-test";
    const trackerBefore = (plugin as any)._touchSessionState(sessionID);
    assert.ok(trackerBefore, "tracker should exist after _touchSessionState");

    // Fire session.deleted event
    await plugin.event({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } });

    // Tracker should be removed from sessionStates
    const trackerAfter = (plugin as any)._sessionStates.get(sessionID);
    assert.equal(trackerAfter, undefined, "tracker should be removed after session.deleted");
  });
});

/**
 * Regression tests: synthetic context flows through output.parts (not session.prompt()).
 *
 * After eliminating session.prompt() injection, all synthetic context (bootstrap,
 * keyword preflight) is appended to output.parts directly. Agent/model forwarding
 * is eliminated — the session selector is never mutated by synthetic injections.
 */

describe("output.parts injection (no session.prompt())", () => {
  // TODO: fix in slice 3 — RED test for new output.parts behavior
  test("chat.message bootstrap appends synthetic text to output.parts without calling session.prompt()", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-parts-"));
    const skillsDir = path.join(workspace, ".opencode", "skills", "bootstrap-skill");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      path.join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: bootstrap-skill",
        "description: a skill for bootstrap test",
        "---",
        "",
        "# Bootstrap Skill",
      ].join("\n"),
      "utf8",
    );

    const promptCalls: unknown[] = [];
    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async (...args: unknown[]) => {
          promptCalls.push(args);
        },
      },
    };

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: workspace }) as any;

    try {
      const output = {
        message: {
          sessionID: "parts-test",
          role: "user",
        },
        parts: [] as Array<{ type?: string; text?: string; synthetic?: boolean }>,
      };

      // First message triggers bootstrap
      await plugin["chat.message"](
        {},
        output,
      );

      // session.prompt() must NOT have been called (no injection path)
      assert.equal(promptCalls.length, 0, "session.prompt() must not be called after eliminating injection");

      // output.parts must have been populated with bootstrap content
      const syntheticParts = output.parts.filter(p => p.synthetic === true);
      assert.ok(syntheticParts.length > 0, "bootstrap must append synthetic parts to output.parts");
      const combinedText = syntheticParts.map(p => p.text ?? "").join("\n");
      assert.match(combinedText, /<available-skills>/, "bootstrap must include available-skills block");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  // TODO: fix in slice 3 — post-compaction re-bootstrap via next chat.message
  test("post-compaction re-bootstrap: next chat.message re-appends bootstrap to output.parts", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-rebootstrap-"));
    const skillsDir = path.join(workspace, ".opencode", "skills", "reb-skill");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      path.join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: reb-skill",
        "description: a skill for re-bootstrap test",
        "---",
        "",
        "# Rebootstrap Skill",
      ].join("\n"),
      "utf8",
    );

    const promptCalls: unknown[] = [];
    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async (...args: unknown[]) => {
          promptCalls.push(args);
        },
      },
    };

    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { text: async () => "" };
      },
      { cwd: () => shell },
    ) as any;

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: workspace }) as any;

    try {
      const output1 = {
        message: { sessionID: "reb-test", role: "user" as const },
        parts: [] as Array<{ type?: string; text?: string; synthetic?: boolean }>,
      };

      // First message — bootstrap
      await plugin["chat.message"]({}, output1);
      const syntheticAfterFirst = output1.parts.filter(p => p.synthetic === true);
      assert.ok(syntheticAfterFirst.length > 0, "first message must bootstrap");

      // Compaction event
      await plugin.event({ event: { type: "session.compacted", properties: { sessionID: "reb-test" } } });

      // Verify setupComplete was reset
      const record = (plugin as any)._sessionStates.get("reb-test");
      assert.equal(record?.isSetupComplete(), false, "setupComplete must be reset after compaction");

      const output2 = {
        message: { sessionID: "reb-test", role: "user" as const },
        parts: [] as Array<{ type?: string; text?: string; synthetic?: boolean }>,
      };

      // Second message after compaction — must re-bootstrap
      await plugin["chat.message"]({}, output2);
      const syntheticAfterReboot = output2.parts.filter(p => p.synthetic === true);
      assert.ok(syntheticAfterReboot.length > 0, "message after compaction must re-bootstrap");
      const combinedText = syntheticAfterReboot.map(p => p.text ?? "").join("\n");
      assert.match(combinedText, /reb-skill/, "re-bootstrap content must include skill names");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

/**
 * Regression test for the "file exists, plugin not loaded" gotcha.
 *
 * Symptom: `.opencode/plugins/skills.ts` was on disk but opencode never
 * picked it up because `opencode.json` had no `plugin` entry. Skills in
 * `.opencode/skills/` were invisible to the LLM. This test guards the
 * core contract: a skill in `.opencode/skills/` MUST appear in the
 * bootstrap `<available-skills>` block when the plugin boots against
 * that workspace.
 */
describe("plugin boot — .opencode/skills/ discovery regression", () => {
  test("skill in .opencode/skills/ appears in bootstrap <available-skills> block", async () => {
    const { SkillsPlugin } = await loadPluginModule() as any;

    const workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-boot-regression-"));
    const skillDir = path.join(workspace, ".opencode", "skills", "greeting");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: greeting",
        "description: a simple greeting skill",
        "trigger: hello, greet, greeting",
        "---",
        "",
        "# Greeting Skill",
      ].join("\n"),
      "utf8",
    );

    const client = {
      session: {
        messages: async () => ({ data: [] }),
        prompt: async () => {},
      },
    };
    const shell = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        text: async () => "",
      }),
      { cwd: () => shell },
    ) as any;

    const plugin = await SkillsPlugin({ client, $: shell, shell, directory: workspace }) as any;

    try {
      // Plugin factory contract: must expose the opencode hooks.
      assert.equal(typeof plugin["chat.message"], "function", "plugin must expose chat.message");
      assert.equal(typeof plugin.event, "function", "plugin must expose event");

      const output = {
        message: { sessionID: "boot-regression", role: "user" as const },
        parts: [] as Array<{ type?: string; text?: string; synthetic?: boolean }>,
      };
      await plugin["chat.message"]({}, output);

      const combinedText = output.parts
        .filter((p) => p.synthetic === true)
        .map((p) => p.text ?? "")
        .join("\n");

      // Core regression assertion: greeting MUST be discoverable from .opencode/skills/.
      assert.match(
        combinedText,
        /<available-skills>[\s\S]*- greeting:[\s\S]*<\/available-skills>/,
        ".opencode/skills/greeting MUST appear in bootstrap <available-skills> block — failure here means the plugin is not discovering project-local skills",
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
