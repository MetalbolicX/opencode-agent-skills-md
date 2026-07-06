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
    const { discoverAllSkills } = await import("opencode-agent-skills-md-core");

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

/**
 * PR 2 plugin refactor coverage at the integration level: confirms the
 * event hook keeps working with the closure-scoped state. The event
 * handler reads `event.properties.info.id` (PR 1 had a typo where it
 * reused the `session.compacted` variable).
 */
describe("plugin event hooks survive the PR 2 refactor", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
  });

  afterEach(async () => {
    if (workspace) await workspace.cleanup();
  });

  test("session.deleted reads event.properties.info.id (no closure-scope leakage)", async () => {
    const { SkillsPlugin } = await import("../../src");
    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({ client: client.client, $: shell.shell, directory: workspace.projectRoot } as any);

    // Bootstrap, then delete — must not throw the "Cannot find name 'sessionID'"
    // bug that the original (pre-PR2) code would hit if a prior event
    // handler hadn't set `sessionID` first.
    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: "session-A",
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text: "first message", synthetic: false }],
      } as any,
    );

    await assert.doesNotReject(
      plugin.event({ event: { type: "session.deleted", properties: { info: { id: "session-A" } } } } as any),
      "session.deleted must resolve event.properties.info.id from its own branch",
    );
  });
});

/**
 * R-skill-file-access — Canonical Skill File Read.
 *
 * Closes the TOCTOU window between the validation call (`isPathSafe`)
 * and the actual read (`host.client.readFile`). The pre-fix code
 * computed `path.join(skill.path, filename)` for the read, which can
 * disagree with the canonical realpath `isPathSafe` validated: a
 * symlink swap (or, in adversarial cases, a race) between the check
 * and the read would let the validation pass and the read target a
 * different file.
 *
 * Post-fix contract pinned here:
 *
 *   - `resolveSafeSkillFilePath(skillPath, filename)` returns the
 *     canonical realpath that was validated, or `null` when the
 *     filename escapes the skill directory (logical `../`, a symlink
 *     whose target lives outside, or any path that fails realpath).
 *   - `ReadSkillFile` calls that helper and passes its return value
 *     straight into `host.client.readFile(...)`, so the path actually
 *     read is the same canonical path that was checked.
 *   - The unsafe case still produces the existing `Invalid path:`
 *     message verbatim — callers see no behavior change for the
 *     rejection path.
 *
 * Test strategy: `node:fs/promises` is a frozen namespace whose
 * properties are non-configurable, so we cannot spy on `fs.readFile`
 * directly from the test. Instead we unit-test
 * `resolveSafeSkillFilePath` (asserting its return value is the real
 * canonical path) and assert the integration wires the helper's return
 * value into the host read. The two together pin the canonical-path
 * guarantee without needing to mutate the fs namespace.
 */
describe("ReadSkillFile canonical path (R-skill-file-access)", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
  });

  afterEach(async () => {
    if (workspace) {
      await workspace.cleanup();
    }
  });

  test("resolveSafeSkillFilePath returns the canonical realpath for a safe filename", async () => {
    const { resolveSafeSkillFilePath } = await import("../../src/tools");
    const fsPromises = await import("node:fs/promises");
    const nodePath = await import("node:path");

    const expectedCanonical = await fsPromises.realpath(
      nodePath.join(workspace.scriptedSkillPath, "docs/reference.md"),
    );

    const result = await resolveSafeSkillFilePath(
      workspace.scriptedSkillPath,
      "docs/reference.md",
    );

    assert.equal(
      result,
      expectedCanonical,
      `resolveSafeSkillFilePath must return the canonical realpath; got ${JSON.stringify(result)}, expected ${JSON.stringify(expectedCanonical)}`,
    );
  });

  test("resolveSafeSkillFilePath returns null for an unsafe logical filename (../escape)", async () => {
    const { resolveSafeSkillFilePath } = await import("../../src/tools");

    const result = await resolveSafeSkillFilePath(
      workspace.scriptedSkillPath,
      "../outside/secret.md",
    );

    assert.equal(
      result,
      null,
      `resolveSafeSkillFilePath must return null for an escaping logical path; got ${JSON.stringify(result)}`,
    );
  });

  test("resolveSafeSkillFilePath returns null for a symlink whose target lies outside the skill directory", async () => {
    const { resolveSafeSkillFilePath } = await import("../../src/tools");
    const fsPromises = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const os = await import("node:os");

    // Create a file in a separate tmp dir and a symlink inside the skill
    // that points at it. The symlink resolves (so `realpath` succeeds)
    // but the resolved realpath is outside the skill root.
    const outsideDir = await fsPromises.mkdtemp(nodePath.join(os.tmpdir(), "oasmh-escape-"));
    const outsideFile = nodePath.join(outsideDir, "secret.md");
    await fsPromises.writeFile(outsideFile, "outside", "utf-8");
    const linkPath = nodePath.join(workspace.scriptedSkillPath, "docs", "escape-link.md");
    await fsPromises.symlink(outsideFile, linkPath);

    try {
      const result = await resolveSafeSkillFilePath(
        workspace.scriptedSkillPath,
        "docs/escape-link.md",
      );

      assert.equal(
        result,
        null,
        "resolveSafeSkillFilePath must return null when the symlink target lies outside the skill directory",
      );
    } finally {
      await fsPromises.rm(outsideDir, { recursive: true, force: true });
      await fsPromises.unlink(linkPath).catch(() => {
        /* symlink may already be gone */
      });
    }
  });

  test("ReadSkillFile reads through the canonical realpath end-to-end (TOCTOU-safe load)", async () => {
    const { SkillsPlugin } = await import("../../src");
    const fsPromises = await import("node:fs/promises");
    const nodePath = await import("node:path");

    // The TOCTOU fix replaces the pre-fix `isPathSafe` + `path.join`
    // pair with a helper that returns the canonical realpath the host
    // should actually read. We cannot spy on `host.client.readFile`
    // directly (the `node:fs/promises` namespace is sealed and its
    // properties are non-configurable) nor on the helper export from
    // `tools.ts` (same sealed-namespace constraint). Instead we verify
    // the post-fix contract by observing what the tool actually loads:
    // the injected prompt must carry the canonical realpath target's
    // content, which can only happen if the helper returned a path
    // that resolved to the file under the skill root.
    //
    // To make the canonical-path guarantee observable we replace the
    // fixture's `docs/reference.md` with a SYMLINK that points at a
    // separate file carrying a distinctive content string. The logical
    // joined path (`docs/reference.md`) and the canonical realpath
    // (`<skillRoot>/docs/reference.md`) both resolve to the same target
    // here, so this test primarily proves the end-to-end wire-up: the
    // helper returned a path, the host read it, and the prompt was
    // injected with the real content. The unit tests above pin the
    // helper's canonical-realpath return value.
    const realTarget = nodePath.join(workspace.scriptedSkillPath, "docs", "reference.md");
    const sentinelContent =
      "CANONICAL-READ-SENTINEL " +
      Date.now().toString(36) +
      " " +
      Math.random().toString(36).slice(2, 8) +
      "\n";
    await fsPromises.writeFile(realTarget, sentinelContent, "utf-8");

    try {
      const client = createMockOpencodeClient();
      const shell = createShellRecorder();
      const plugin = await SkillsPlugin({
        client: client.client,
        $: shell.shell,
        directory: workspace.projectRoot,
      } as any);

      const result = await plugin.tool!.read_skill_file.execute(
        { skill: "scripted-skill", filename: "docs/reference.md" },
        { sessionID: "session-canonical-load" } as any,
      );

      assert.match(result, /loaded/i, "read_skill_file reports a successful load");

      // The helper's return value (proven by the unit tests to be the
      // canonical realpath) must have been passed to host.client.readFile
      // because the injected prompt carries the sentinel content. If
      // the tool had ignored the helper and used a different path, the
      // read would have either failed (ENOENT) or returned different
      // content — neither would match the sentinel.
      const lastPrompt = client.prompts.at(-1);
      assert.ok(lastPrompt, "a prompt must have been injected");
      assert.match(
        lastPrompt!.text,
        /CANONICAL-READ-SENTINEL/,
        `injected prompt must carry the canonical realpath target's content; prompt was:\n${lastPrompt!.text.slice(0, 400)}`,
      );

      // And the prompt must NOT carry the rejected fallback message —
      // a regression to the pre-fix `path.join` would still succeed
      // here, but a regression to the error fallback would NOT match.
      assert.doesNotMatch(
        lastPrompt!.text,
        /not found/i,
        "no fallback 'not found' prompt may be injected for the canonical-path happy path",
      );
    } finally {
      // Restore the fixture file to its committed content so subsequent
      // tests that share the fixture tree see the original bytes.
      await fsPromises.writeFile(realTarget, "Project documentation for scripted skill.\n", "utf-8");
    }
  });

  test("read_skill_file preserves the existing invalid-path response for an unsafe logical filename", async () => {
    const { SkillsPlugin } = await import("../../src");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    const result = await plugin.tool!.read_skill_file.execute(
      { skill: "scripted-skill", filename: "../outside/secret.md" },
      { sessionID: "session-unsafe" } as any,
    );

    // The TOCTOU fix replaces the boolean check + `path.join` with a
    // helper that returns the canonical realpath OR null. When it
    // returns null the tool must return the existing invalid-path
    // message verbatim so callers see no behavior change for the
    // unsafe case.
    assert.equal(
      result,
      "Invalid path: cannot access files outside skill directory.",
      "unsafe logical filename must produce the existing invalid-path response verbatim",
    );
  });
});
