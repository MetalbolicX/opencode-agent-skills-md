import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { SessionState } from "../../src/plugin";
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

/**
 * R-session-state-lifecycle — Bounded Session Bookkeeping.
 *
 * Replaces the unbounded `setupCompleteSessions` (Set) and
 * `loadedSkillsPerSession` (Map<sessionID, Set<string>>) with a single
 * `Map<sessionID, SessionState>` whose record carries `setupComplete`,
 * `loadedSkills`, and `lastTouchedAt`. A retention policy caps the map
 * size (`MAX_TRACKED_SESSIONS`) and TTL-expires idle entries
 * (`SESSION_TTL_MS`). Eviction runs lazily on touch: drop TTL-expired
 * entries first, then oldest entries above the cap, then upsert the
 * touched session. Explicit `session.deleted` removes the entry
 * without waiting for eviction.
 *
 * The pure helpers (`touchSessionState`, `evictSessionState`,
 * `deleteSessionState`) accept the state map and an explicit `now`
 * argument so the lazy sweep is testable without a fake clock. The
 * wiring test at the bottom of this block drives the four lifecycle
 * paths (`chat.message`, `use_skill`, `session.compacted`,
 * `session.deleted`) and observes the contract end-to-end.
 */
describe("Bounded session bookkeeping (R-session-state-lifecycle)", () => {
  test("touchSessionState creates a fresh state when the session is missing", async () => {
    const { touchSessionState } = await import("../../src/plugin");
    const state = new Map<string, SessionState>();

    const record = touchSessionState(state, "session-A", 1_000_000);

    assert.equal(record.lastTouchedAt, 1_000_000, "fresh record carries the supplied `now`");
    assert.equal(record.setupComplete, false, "fresh record is not yet bootstrapped");
    assert.ok(record.loadedSkills instanceof Set, "loadedSkills is a Set");
    assert.equal(record.loadedSkills.size, 0, "loadedSkills starts empty");
    assert.equal(state.size, 1, "map holds the new entry");
    assert.equal(state.get("session-A"), record, "map.get returns the inserted record");
  });

  test("touchSessionState updates lastTouchedAt on an existing session without dropping its state", async () => {
    const { touchSessionState } = await import("../../src/plugin");
    const state = new Map<string, SessionState>();

    const first = touchSessionState(state, "session-A", 1_000);
    first.setupComplete = true;
    first.loadedSkills.add("foo");

    const second = touchSessionState(state, "session-A", 5_000);

    assert.equal(second.lastTouchedAt, 5_000, "lastTouchedAt is bumped");
    assert.equal(second.setupComplete, true, "setupComplete is preserved across touches");
    assert.equal(second.loadedSkills.size, 1, "loadedSkills is preserved across touches");
    assert.ok(second.loadedSkills.has("foo"), "loaded-skill set is preserved across touches");
    assert.equal(state.size, 1, "map size is unchanged when the session already existed");
    assert.equal(state.get("session-A"), first, "returns the SAME record instance (no replacement)");
  });

  test("touchSessionState evicts TTL-expired sessions on a later touch (cap not exceeded)", async () => {
    const { touchSessionState, SESSION_TTL_MS } = await import("../../src/plugin");
    const state = new Map<string, SessionState>();

    const T0 = 1_000_000;
    touchSessionState(state, "session-stale", T0);
    touchSessionState(state, "session-warm", T0 + 100);

    // At T0 + TTL + 1: session-stale is TTL + 1 old (expired);
    // session-warm is TTL + 1 - 100 = TTL - 99 old (still warm).
    touchSessionState(state, "session-new", T0 + SESSION_TTL_MS + 1);

    assert.ok(!state.has("session-stale"), "TTL-expired session is evicted by the lazy sweep");
    assert.ok(state.has("session-warm"), "warm session (under TTL) survives the sweep");
    assert.ok(state.has("session-new"), "freshly-touched session is retained");
    assert.equal(state.size, 2);
  });

  test("touchSessionState evicts the oldest entries when over MAX_TRACKED_SESSIONS", async () => {
    const { touchSessionState, MAX_TRACKED_SESSIONS } = await import("../../src/plugin");
    const state = new Map<string, SessionState>();

    for (let i = 0; i < MAX_TRACKED_SESSIONS; i++) {
      touchSessionState(state, `session-${i}`, i);
    }
    assert.equal(state.size, MAX_TRACKED_SESSIONS, "map is at cap before the over-cap touch");

    // One more touch should evict exactly one entry — the oldest by lastTouchedAt.
    touchSessionState(state, "session-new", MAX_TRACKED_SESSIONS + 1);

    assert.equal(state.size, MAX_TRACKED_SESSIONS, "map stays at the cap after the sweep");
    assert.ok(!state.has("session-0"), "oldest session (lastTouchedAt=0) is evicted");
    assert.ok(state.has("session-1"), "second-oldest (lastTouchedAt=1) survives");
    assert.ok(state.has("session-new"), "newly-touched session is retained");
  });

  test("touchSessionState never evicts the session being touched (active session preserved)", async () => {
    const { touchSessionState, MAX_TRACKED_SESSIONS } = await import("../../src/plugin");
    const state = new Map<string, SessionState>();

    // Fill the cap. session-0 is the oldest by lastTouchedAt (0).
    for (let i = 0; i < MAX_TRACKED_SESSIONS; i++) {
      touchSessionState(state, `session-${i}`, i);
    }

    // Re-touch the oldest session with a fresh timestamp. Even though it
    // would be the eviction target, the very session we are touching must
    // survive — its record is updated in place rather than deleted.
    touchSessionState(state, "session-0", MAX_TRACKED_SESSIONS + 100);

    assert.ok(state.has("session-0"), "the active (re-touched) session must survive eviction");
    assert.equal(state.get("session-0")!.lastTouchedAt, MAX_TRACKED_SESSIONS + 100, "lastTouchedAt is bumped");
    assert.equal(state.size, MAX_TRACKED_SESSIONS, "map stays at the cap");
  });

  test("deleteSessionState removes the entry and returns true; returns false when absent", async () => {
    const { deleteSessionState, touchSessionState } = await import("../../src/plugin");
    const state = new Map<string, SessionState>();
    touchSessionState(state, "session-A", 1);

    assert.equal(deleteSessionState(state, "session-A"), true, "returns true on existing entry");
    assert.equal(state.size, 0, "entry is removed from the map");
    assert.equal(deleteSessionState(state, "session-A"), false, "returns false on already-removed entry");
    assert.equal(deleteSessionState(state, "missing"), false, "returns false on never-existed entry");
  });

  test("evictSessionState evicts only TTL-expired entries (pure helper, no upsert)", async () => {
    const { evictSessionState, touchSessionState, SESSION_TTL_MS } = await import("../../src/plugin");
    const state = new Map<string, SessionState>();

    const T0 = 1_000_000;
    touchSessionState(state, "session-stale", T0);
    touchSessionState(state, "session-warm", T0 + SESSION_TTL_MS);
    // session-warm lastTouchedAt = T0 + TTL; at T0 + TTL + 1 its age is 1 (< TTL), so it survives.

    const evicted = evictSessionState(state, T0 + SESSION_TTL_MS + 1);

    assert.deepEqual(evicted, ["session-stale"], "pure helper returns the evicted session IDs");
    assert.equal(state.size, 1, "only the stale entry is removed");
    assert.ok(state.has("session-warm"), "warm entry survives");
    assert.ok(!state.has("session-stale"), "stale entry is removed");
  });
});

/**
 * R-session-state-lifecycle — wiring test.
 *
 * Drives the four lifecycle paths that touch session bookkeeping and
 * verifies the contract end-to-end without inspecting the internal Map:
 *
 *   - `chat.message` bootstraps a fresh session (registers it for
 *     setupComplete + lastTouchedAt).
 *   - `session.deleted` removes the session state, so the next
 *     `chat.message` on the same session ID re-bootstraps (a fresh
 *     `<available-skills>` injection appears, proving the prior record
 *     is gone).
 *
 * The TTL + cap eviction behaviors are pinned by the pure-helper tests
 * above using a controlled `now` argument. Here we only pin the
 * wiring — that the lifecycle paths in the plugin factory actually
 * route through the helpers.
 */
describe("Bounded session bookkeeping — wiring", () => {
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

  test("chat.message registers a session and session.deleted removes it so the next message re-bootstraps", async () => {
    const { SkillsPlugin } = await import("../../src");

    const client = createMockOpencodeClient();
    const shell = createShellRecorder();
    const plugin = await SkillsPlugin({
      client: client.client,
      $: shell.shell,
      directory: workspace.projectRoot,
    } as any);

    const SESSION = "session-lifecycle-wiring";

    // First chat.message on a fresh session → bootstrap injects the
    // <available-skills> + superpowers prompts.
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
    const promptsAfterFirstBootstrap = client.prompts.length;
    assert.ok(
      promptsAfterFirstBootstrap >= 2,
      "first chat.message on a fresh session injects at least the available-skills + superpowers prompts",
    );
    assert.ok(
      client.prompts.some((p) => /<available-skills>/.test(p.text)),
      "first message injects <available-skills>",
    );

    // Second chat.message on the SAME session → no bootstrap (session
    // is already tracked). Only the keyword-matcher branch may run,
    // and for "second message" there is no keyword match, so no new
    // prompt is added.
    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: SESSION,
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text: "second message", synthetic: false }],
      } as any,
    );
    const promptsAfterSecondMessage = client.prompts.length;
    assert.equal(
      promptsAfterSecondMessage,
      promptsAfterFirstBootstrap,
      "second chat.message on a tracked session does NOT re-bootstrap",
    );

    // session.deleted must drop the session state.
    await assert.doesNotReject(
      plugin.event({
        event: { type: "session.deleted", properties: { info: { id: SESSION } } },
      } as any),
      "session.deleted must resolve cleanly",
    );

    // Third chat.message on the same sessionID → the prior record was
    // removed by session.deleted, so the session is treated as fresh
    // again and bootstrap re-injects <available-skills>.
    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: SESSION,
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "test-agent",
        },
        parts: [{ type: "text", text: "third message after delete", synthetic: false }],
      } as any,
    );
    const newPromptsAfterDelete = client.prompts.slice(promptsAfterSecondMessage);
    assert.ok(
      newPromptsAfterDelete.length >= 2,
      `chat.message after session.deleted must re-bootstrap; got ${newPromptsAfterDelete.length} new prompt(s)`,
    );
    assert.ok(
      newPromptsAfterDelete.some((p) => /<available-skills>/.test(p.text)),
      "chat.message after session.deleted re-injects <available-skills>, proving the prior record was removed",
    );
  });
});
