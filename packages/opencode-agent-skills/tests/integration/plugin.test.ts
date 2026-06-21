import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  createFixtureWorkspace,
  createMockOpencodeClient,
  createShellRecorder,
} from "./helpers/mock-opencode";

describe("plugin integration", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;
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

  test("discovers project and user skills deterministically", async () => {
    const { discoverAllSkills } = await import("opencode-agent-skills-core");

    const skills = await discoverAllSkills(workspace.projectRoot);

    assert.equal(skills.get("shared-skill")?.label, "project");
    assert.equal(skills.get("shared-skill")?.description, "project version wins over user fixture");
    assert.equal(skills.get("nested-skill")?.description, "nested skill fixture");
    assert.equal(skills.get("user-only-skill")?.label, "user");
  });

  test("loads startup context, tools, and reinjection hooks", async () => {
    const { SkillsPlugin } = await import("../../src");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({ client: client.client, $: shell.shell, directory: workspace.projectRoot } as any);

    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: "session-startup",
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text: "use the discovery skill", synthetic: false }],
      } as any
    );

    assert.equal(client.prompts.length, 2);
    assert.ok(client.prompts.some((prompt) => /<available-skills>/.test(prompt.text)));
    assert.ok(client.prompts.some((prompt) => /You have superpowers\./.test(prompt.text)));

    await plugin.event({ event: { type: "session.compacted", properties: { sessionID: "session-startup" } } } as any);

    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: "session-startup",
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text: "run the script skill", synthetic: false }],
      } as any
    );

    assert.ok(client.prompts.length >= 2);
  });

  test("skill tools load content and execute scripts", async () => {
    const { SkillsPlugin } = await import("../../src");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({ client: client.client, $: shell.shell, directory: workspace.projectRoot } as any);

    const loaded = await plugin.tool.use_skill.execute({ skill: "scripted-skill" }, { sessionID: "session-tools" } as any);
    assert.match(loaded, /loaded\./i);
    assert.equal(client.prompts.at(-1)?.text.includes("<skill name=\"scripted-skill\">"), true);

    const fileLoaded = await plugin.tool.read_skill_file.execute(
      { skill: "scripted-skill", filename: "docs/reference.md" },
      { sessionID: "session-tools" } as any
    );
    assert.match(fileLoaded, /loaded/i);

    const output = await plugin.tool.run_skill_script.execute(
      { skill: "scripted-skill", script: "bin/echo.sh", arguments: ["hello"] },
      { sessionID: "session-tools" } as any
    );
    assert.match(output, /hello/);
    assert.equal(shell.calls[0]?.cwd, workspace.scriptedSkillPath);
  });

  /**
   * Regression coverage for the skill-loading callback wiring (PR 1 of
   * `fix-skill-loading-regression`). Asserts the end-to-end behavior at the
   * integration layer:
   *   - after `use_skill`, `onSkillLoaded` is observable via the session's
   *     loaded-skill state
   *   - the same keyword in a subsequent chat.message does NOT re-trigger
   *     a <skill-evaluation-required> injection for the loaded skill
   *
   * With the regression, the loader does not update loaded-skill state so
   * the matcher re-emits an evaluation prompt for the already-loaded skill.
   */
  test("use_skill callback updates loaded-skill state and prevents duplicate match injection (PR 1)", async () => {
    const { SkillsPlugin } = await import("../../src");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    const SESSION = "session-loaded-state";

    // Bootstrap the session: first message injects <available-skills>.
    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: SESSION,
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text: "first message", synthetic: false }],
      } as any,
    );
    const promptsAfterBootstrap = client.prompts.length;

    // Load scripted-skill via use_skill.
    const loadResult = await plugin.tool.use_skill.execute(
      { skill: "scripted-skill" },
      { sessionID: SESSION } as any,
    );
    assert.match(loadResult, /loaded\./i, "use_skill reports a successful load");
    assert.ok(
      client.prompts.slice(promptsAfterBootstrap).some((p) =>
        /<skill name="scripted-skill">/.test(p.text),
      ),
      "use_skill injects the skill content into the session",
    );

    // Subsequent chat.message with a keyword that also matches scripted-skill.
    // Other skills may legitimately match too, but scripted-skill MUST be
    // filtered out by the loaded-skill set after the fix. Before the fix,
    // scripted-skill appears because loadedSkillsPerSession was never updated.
    const promptsBeforeRepeat = client.prompts.length;
    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: SESSION,
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text: "use the script skill", synthetic: false }],
      } as any,
    );
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
});

/**
 * `GetAvailableSkills` with the new `keywords` parameter and the safe-input
 * `query` path. These are RED tests for PR2 — the current tool has no
 * `keywords` arg, and the existing `new RegExp(args.query)` path crashes
 * on regex-special characters. The fixture skills in
 * `tests/fixtures/skills/project/.opencode/skills/{go-tester,rust-tester}`
 * carry `metadata.tags` so the search layer can filter against them.
 */
describe("GetAvailableSkills with keywords", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
  });

  afterEach(async () => {
    if (workspace) {
      await workspace.cleanup();
    }
  });

  test("keywords=['go'] returns only skills whose tags include 'go'", async () => {
    const { SkillsPlugin } = await import("../../src");
    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    const result = await plugin.tool.get_available_skills.execute(
      { keywords: ["go"] } as any,
      { sessionID: "keywords-test" } as any
    );

    assert.match(result, /go-tester/);
    assert.doesNotMatch(result, /rust-tester/);
  });

  test("query + keywords applies both filters", async () => {
    const { SkillsPlugin } = await import("../../src");
    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    const result = await plugin.tool.get_available_skills.execute(
      { query: "tester", keywords: ["go"] } as any,
      { sessionID: "combined-test" } as any
    );

    // Only `go-tester` is tagged "go"; "rust-tester" is filtered out.
    assert.match(result, /go-tester/);
    assert.doesNotMatch(result, /rust-tester/);
  });

  test("query with regex-special characters does not throw", async () => {
    const { SkillsPlugin } = await import("../../src");
    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    // The legacy implementation crashed here because `new RegExp("(test+", "i")`
    // throws — the unescaped `(` and `+` are invalid regex syntax. After
    // the search-layer wiring, the tool must produce a string result
    // (matches or a clean no-match) without throwing. The fuzzy scorer
    // legitimately matches "go-tester" and "rust-tester" against the
    // substring "test" inside the escaped token, so a non-empty result
    // is expected and acceptable.
    const result = await plugin.tool.get_available_skills.execute(
      { query: "(test+" } as any,
      { sessionID: "regex-test" } as any
    );

    assert.ok(typeof result === "string", "returns a string result");
  });
});
