import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import type { SkillSummary } from "opencode-agent-skills-core";
import {
  createFixtureWorkspace,
  createMockOpencodeClient,
  createShellRecorder,
  type FixtureWorkspace,
} from "../integration/helpers/mock-opencode";

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
  return (await import("../../src/plugin")) as unknown as PluginModule;
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

/**
 * Regression coverage for the skill-loading callback wiring (PR 1 of
 * `fix-skill-loading-regression`). After the core-decoupling refactor,
 * `createSkillTools()` stopped threading `onSkillLoaded` through to
 * `UseSkill`, so a successful `use_skill` call no longer updated the
 * session's loaded-skill set, and a subsequent keyword-matched
 * `chat.message` re-injected an evaluation prompt for the already-loaded
 * skill.
 *
 * These tests pin both ends of the wiring at the host-adapter boundary:
 *   1. The factory accepts a callback and the tool calls it.
 *   2. The full plugin path (createSkillTools + UseSkill + plugin
 *      bookkeeping) updates `loadedSkillsPerSession` so a second
 *      matching chat.message does NOT re-inject the skill evaluation.
 */
describe("use_skill callback wiring (PR 1)", () => {
  let workspace: FixtureWorkspace;
  const previousSuperpowersMode = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
    process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = "true";
  });

  afterEach(async () => {
    if (workspace) {
      await workspace.cleanup();
    }
    if (previousSuperpowersMode === undefined) {
      delete process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;
    } else {
      process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = previousSuperpowersMode;
    }
  });

  /** Drive `chat.message` with a plain text part (the only path the plugin's matcher inspects). */
  async function sendMessage(
    plugin: { "chat.message": (input: unknown, output: unknown) => Promise<void> },
    sessionID: string,
    text: string,
  ): Promise<void> {
    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID,
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text, synthetic: false }],
      } as any,
    );
  }

  test("createSkillTools forwards onSkillLoaded so UseSkill invokes it (R3)", async () => {
    const { createSkillTools } = await import("../../src/tools");
    const { createOpencodeSkillHost } = await import("../../src/host");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const host = createOpencodeSkillHost(client.client as any);
    const calls: Array<{ sessionID: string; skillName: string }> = [];

    const tools = createSkillTools(
      host,
      shell.shell,
      workspace.projectRoot,
      (sessionID, skillName) => calls.push({ sessionID, skillName }),
    );

    const result = await tools.UseSkill.execute(
      { skill: "scripted-skill" },
      { sessionID: "callback-test" } as any,
    );

    assert.match(result, /loaded\./i, "skill load returns the success message");
    assert.equal(calls.length, 1, "onSkillLoaded should fire exactly once on a successful load");
    assert.deepEqual(calls[0], { sessionID: "callback-test", skillName: "scripted-skill" });
  });

  test("plugin updates loadedSkillsPerSession so a repeat chat.message does not re-inject (R3 dedupe)", async () => {
    const { SkillsPlugin } = await import("../../src");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    const SESSION = "session-dedupe-callback";

    // First chat.message: bootstrap the session with the available-skills
    // block; the keyword matcher is short-circuited on the first message.
    await sendMessage(plugin, SESSION, "hello");
    const promptsAfterBootstrap = client.prompts.length;
    assert.ok(
      client.prompts.some((p) => /<available-skills>/.test(p.text)),
      "first message injects the available-skills block",
    );

    // Load scripted-skill via use_skill. With the regression, no callback
    // fires and loadedSkillsPerSession is NOT updated.
    const loadResult = await plugin.tool.use_skill.execute(
      { skill: "scripted-skill" },
      { sessionID: SESSION } as any,
    );
    assert.match(loadResult, /loaded\./i, "use_skill reports a successful load");
    assert.ok(
      client.prompts.slice(promptsAfterBootstrap).some((p) =>
        /<skill name="scripted-skill">/.test(p.text),
      ),
      "use_skill injects the skill content",
    );

    // Second chat.message with a keyword that also matches scripted-skill.
    // Other skills may legitimately match too, but scripted-skill MUST be
    // filtered out by the loaded-skill set after the fix. Before the fix,
    // scripted-skill appears because loadedSkillsPerSession was never
    // updated by use_skill (no callback was wired).
    const promptsBeforeRepeat = client.prompts.length;
    await sendMessage(plugin, SESSION, "use the script skill");
    const newPrompts = client.prompts.slice(promptsBeforeRepeat);
    const evaluationInjections = newPrompts.filter((p) =>
      /<skill-evaluation-required>/.test(p.text),
    );
    for (const prompt of evaluationInjections) {
      assert.doesNotMatch(
        prompt.text,
        /^- scripted-skill:/m,
        "loaded-skill state must suppress scripted-skill from re-injection",
      );
    }
  });

  test("use_skill still loads when no callback is registered (R3 missing-callback)", async () => {
    const { SkillsPlugin } = await import("../../src");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    const result = await plugin.tool.use_skill.execute(
      { skill: "scripted-skill" },
      { sessionID: "session-no-callback" } as any,
    );

    assert.match(result, /loaded\./i, "skill load returns the success message");
    assert.ok(
      client.prompts.some((p) => /<skill name="scripted-skill">/.test(p.text)),
      "skill content was injected even with no callback registered",
    );
  });
});

/**
 * PR 2 plugin refactor coverage. The closure-scoped refactor must:
 *   1. Keep two plugin instances isolated (no shared session state).
 *   2. Trigger exactly one discovery per chat.message handler call.
 *   3. Preserve first-message bootstrap and subsequent-message matcher
 *      behavior.
 */
describe("plugin refactor (PR 2)", () => {
  let workspace: FixtureWorkspace;
  const previousSuperpowersMode = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
    process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = "true";
  });

  afterEach(async () => {
    if (workspace) await workspace.cleanup();
    if (previousSuperpowersMode === undefined) {
      delete process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;
    } else {
      process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = previousSuperpowersMode;
    }
  });

  async function sendMessage(
    plugin: { "chat.message": (input: unknown, output: unknown) => Promise<void> },
    sessionID: string,
    text: string,
  ): Promise<void> {
    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID,
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text, synthetic: false }],
      } as any,
    );
  }

  test("two plugin instances do not share session state (PR 2 isolation)", async () => {
    const { SkillsPlugin } = await import("../../src");
    const clientA = createMockOpencodeClient();
    const clientB = createMockOpencodeClient();
    const shell = createShellRecorder();
    const pluginA = await SkillsPlugin({ client: clientA.client, $: shell.shell, directory: workspace.projectRoot } as any);
    const pluginB = await SkillsPlugin({ client: clientB.client, $: shell.shell, directory: workspace.projectRoot } as any);

    await sendMessage(pluginA, "shared-session-id", "hello");
    assert.ok(clientA.prompts.some((p) => /<available-skills>/.test(p.text)), "plugin A bootstraps");

    const promptsBBefore = clientB.prompts.length;
    await sendMessage(pluginB, "shared-session-id", "hello");
    assert.ok(
      clientB.prompts.slice(promptsBBefore).some((p) => /<available-skills>/.test(p.text)),
      "plugin B independently bootstraps the same session id",
    );

    await pluginA.tool.use_skill.execute(
      { skill: "scripted-skill" },
      { sessionID: "shared-session-id" } as any,
    );
    const promptsBBeforeKeyword = clientB.prompts.length;
    await sendMessage(pluginB, "shared-session-id", "use the script skill");
    const evaluationB = clientB.prompts
      .slice(promptsBBeforeKeyword)
      .filter((p) => /<skill-evaluation-required>/.test(p.text));
    assert.ok(
      evaluationB.some((p) => /^- scripted-skill:/m.test(p.text)),
      "plugin B sees scripted-skill as not-loaded (its own loaded set is independent)",
    );
  });

  test("chat.message discovers skills exactly once per handler invocation (PR 2 R3+R4+R5)", async () => {
    const { SkillsPlugin } = await import("../../src");
    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({ client: client.client, $: shell.shell, directory: workspace.projectRoot } as any);

    // The fixture has one duplicate (project + user `shared-skill`); each
    // `discoverAllSkills` triggers exactly one `console.warn` via the
    // default duplicate callback, so counting warns counts discoveries.
    const warnSpy = mock.method(console, "warn", () => {});
    try {
      const warns = (): number => warnSpy.mock.calls.filter(
        (c) => typeof c.arguments[0] === "string" && c.arguments[0].startsWith("Skill name conflict:"),
      ).length;

      await sendMessage(plugin, "spy-session", "use the script skill");
      assert.equal(warns(), 1, "single chat.message = single discovery");

      const before = warns();
      await sendMessage(plugin, "spy-session", "use the script skill again");
      assert.equal(warns() - before, 1, "no cross-request caching");
    } finally {
      warnSpy.mock.restore();
    }
  });

  test("first-message bootstrap and subsequent keyword match are both preserved (PR 2)", async () => {
    const { SkillsPlugin } = await import("../../src");
    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({ client: client.client, $: shell.shell, directory: workspace.projectRoot } as any);
    const SESSION = "preserved-session";

    await sendMessage(plugin, SESSION, "first message");
    assert.ok(client.prompts.some((p) => /<available-skills>/.test(p.text)), "first injects available-skills");
    assert.ok(client.prompts.some((p) => /You have superpowers\./.test(p.text)), "first injects superpowers");
    assert.ok(
      !client.prompts.some((p) => /<skill-evaluation-required>/.test(p.text)),
      "first message does NOT run matcher",
    );

    await plugin.tool.use_skill.execute({ skill: "scripted-skill" }, { sessionID: SESSION } as any);

    const before = client.prompts.length;
    await sendMessage(plugin, SESSION, "use the script skill");
    const newPrompts = client.prompts.slice(before);
    assert.ok(!newPrompts.some((p) => /<available-skills>/.test(p.text)), "subsequent does NOT re-inject available-skills");
    const evals = newPrompts.filter((p) => /<skill-evaluation-required>/.test(p.text));
    for (const p of evals) {
      assert.doesNotMatch(p.text, /^- scripted-skill:/m, "loaded skills are filtered from match");
    }
  });
});
