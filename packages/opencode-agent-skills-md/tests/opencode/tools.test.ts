import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import {
  createFixtureWorkspace,
  createMockOpencodeClient,
  createShellRecorder,
  type FixtureWorkspace,
} from "../integration/helpers/mock-opencode";
import { createOpencodeSkillHost } from "../../src/host";
import {
  createSkillTools,
  resolveSkillOrSuggest,
  runBoundSkillScript,
  SKILL_SCRIPT_TIMEOUT_MS,
} from "../../src/tools";

/**
 * Hand-rolled stub OpenCode client. Only the methods the four skill
 * tools need (`session.prompt`, `session.messages`) are wired up.
 */
function createStubClient() {
  const prompts: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = [];
  return {
    client: {
      session: {
        prompt: async (input: typeof prompts[number]) => {
          prompts.push(input);
        },
        messages: async () => ({ data: [] }),
      },
    },
    prompts,
  };
}

/**
 * `GetAvailableSkills` trigger behaviour (R5):
 *   - skills with a non-empty `trigger` get a `trigger: <text>` line
 *     under the description
 *   - skills with no trigger stay exactly as before
 *
 * The tool factory is driven by a real `createSkillTools` instance; the
 * discovery root is a temp workspace we set up with fixture SKILL.md
 * files, so the test exercises the real `discoverAllSkills` path.
 */
describe("GetAvailableSkills trigger rendering (R5)", () => {
  let workspace: string;
  const previousSuperpowersMode = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-tools-trigger-"));
    const projectRoot = path.join(workspace, ".opencode", "skills");
    await mkdir(path.join(projectRoot, "with-trigger"), { recursive: true });
    await mkdir(path.join(projectRoot, "no-trigger"), { recursive: true });

    await writeFile(
      path.join(projectRoot, "with-trigger", "SKILL.md"),
      [
        "---",
        "name: with-trigger",
        "description: skill whose frontmatter carries a trigger",
        "trigger: auth, login",
        "---",
        "",
        "# With Trigger",
        "",
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(projectRoot, "no-trigger", "SKILL.md"),
      [
        "---",
        "name: no-trigger",
        "description: skill without a trigger",
        "---",
        "",
        "# No Trigger",
        "",
      ].join("\n"),
      "utf8"
    );

    // createSkillTools uses OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE to gate
    // superpowers behaviour; set it so the tools behave the same way the
    // plugin does in production.
    process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = "true";
  });

  after(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
    if (previousSuperpowersMode === undefined) {
      delete process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;
    } else {
      process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = previousSuperpowersMode;
    }
  });

  test("renders a `trigger: <text>` line under the description when trigger is set", async () => {
    const stub = createStubClient();
    const host = createOpencodeSkillHost(stub.client as any);
    const tools = createSkillTools(host, (() => {}) as any, workspace);

    const result = await tools.GetAvailableSkills.execute({ query: "" } as any, { sessionID: "sess-tools" } as any);

    assert.match(result, /with-trigger/, "the skill is listed");
    assert.match(result, /trigger: auth, login/, "trigger line is rendered below the description");
  });

  test("omits the `trigger:` line when the skill has no trigger", async () => {
    const stub = createStubClient();
    const host = createOpencodeSkillHost(stub.client as any);
    const tools = createSkillTools(host, (() => {}) as any, workspace);

    const result = (await tools.GetAvailableSkills.execute(
      { query: "" } as any,
      { sessionID: "sess-tools" } as any
    )) as string;

    // The compact listing keeps `- name: description` for the no-trigger
    // fixture and never appends a `trigger:` line to it. The block for
    // the no-trigger skill is split by `\n\n` so we can inspect just
    // that block (other skills in the user's home dir may legitimately
    // render their own trigger lines and must not affect this check).
    const blocks = result.split("\n\n");
    const noTriggerBlock = blocks.find((b) => b.startsWith("no-trigger "));
    assert.ok(noTriggerBlock, "the no-trigger fixture is listed");
    assert.doesNotMatch(
      noTriggerBlock!,
      /\n\s*trigger:/,
      "no-trigger skill block must NOT contain a trigger line"
    );

    // Sanity check: the with-trigger fixture still renders its trigger line.
    const withTriggerBlock = blocks.find((b) => b.startsWith("with-trigger "));
    assert.ok(withTriggerBlock, "the with-trigger fixture is listed");
    assert.match(
      withTriggerBlock!,
      /\n\s*trigger: auth, login/,
      "with-trigger skill block must contain its trigger line"
    );
  });
});

/**
 * `resolveSkillOrSuggest` — the shared resolver used by the three skill
 * tools (use_skill, read_skill_file, run_skill_script).
 *
 * Three paths exercised:
 *   - hit: skill exists        → returns the skill's `name`
 *   - miss + suggestion: close-match skill exists → "Did you mean ..." message
 *   - miss, no suggestion: nothing close         → bare "not found" message
 *
 * We deliberately do NOT test the empty-workspace discovery path: home
 * dir skills make that non-deterministic in CI.
 */
describe("resolveSkillOrSuggest", () => {
  let workspace: string;
  const previousSuperpowersMode = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-resolver-"));
    const projectRoot = path.join(workspace, ".opencode", "skills");
    await mkdir(path.join(projectRoot, "alpha"), { recursive: true });
    await mkdir(path.join(projectRoot, "beta"), { recursive: true });

    const fixture = (name: string) => [
      "---",
      `name: ${name}`,
      `description: fixture skill ${name}`,
      "---",
      "",
      `# ${name}`,
      "",
    ].join("\n");

    await writeFile(path.join(projectRoot, "alpha", "SKILL.md"), fixture("alpha"), "utf8");
    await writeFile(path.join(projectRoot, "beta", "SKILL.md"), fixture("beta"), "utf8");

    process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = "true";
  });

  after(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
    if (previousSuperpowersMode === undefined) {
      delete process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;
    } else {
      process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE = previousSuperpowersMode;
    }
  });

  test("returns the resolved Skill on hit", async () => {
    const result = await resolveSkillOrSuggest(workspace, "alpha");
    assert.equal(result.ok, true, "hit must surface ok:true");
    if (result.ok) {
      assert.equal(result.skill.name, "alpha");
      assert.ok(typeof result.skill.path === "string" && result.skill.path.length > 0,
        "the resolved Skill carries the on-disk path");
    }
  });

  test("returns a Did-you-mean message on miss with a close match", async () => {
    // "alph" is a prefix of "alpha" — findClosestMatch scores this well above
    // its 0.4 threshold, so the helper must surface the suggestion.
    const result = await resolveSkillOrSuggest(workspace, "alph");
    assert.equal(result.ok, false, "miss must surface ok:false");
    if (!result.ok) {
      assert.equal(
        result.message,
        `Skill "alph" not found. Did you mean "alpha"?`,
      );
    }
  });

  test("returns the bare not-found message when no close match exists", async () => {
    // Far from any fixture; nothing in the project's `.opencode/skills` will
    // score above the findClosestMatch threshold.
    const result = await resolveSkillOrSuggest(workspace, "xyzzy");
    assert.equal(result.ok, false, "miss must surface ok:false");
    if (!result.ok) {
      assert.equal(
        result.message,
        `Skill "xyzzy" not found. Use get_available_skills to list available skills.`,
      );
    }
  });
});

/**
 * Unit 1 (plan 015) — Single-pass discovery.
 *
 * Each tool invocation (`use_skill`, `read_skill_file`, `run_skill_script`)
 * MUST complete a successful resolution with a single discovery pass.
 * Pre-refactor, the tools called `resolveSkillOrSuggest` (which discovers)
 * and then re-discovered again to obtain the full `Skill` object —
 * two `discoverAllSkills` calls per invocation.
 *
 * The fixture's `shared-skill` is duplicated across project and user
 * roots, so each `discoverAllSkills` call emits exactly one
 * `console.warn` via `defaultOnDuplicate`. Counting those warnings
 * gives a deterministic proxy for the discovery count, identical to
 * the pattern already used by `tests/opencode/plugin.test.ts`.
 */
describe("single-pass tool discovery (R-skill-tool-discovery)", () => {
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

  /** Build a counting predicate that filters to duplicate-discovery warnings only. */
  function discoveryCount(warnSpy: ReturnType<typeof mock.method>): () => number {
    return () => warnSpy.mock.calls.filter(
      (c) => typeof c.arguments[0] === "string"
        && (c.arguments[0] as string).startsWith("Skill name conflict:"),
    ).length;
  }

  test("use_skill runs exactly one discovery pass per successful invocation", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell, workspace.projectRoot);

    const warnSpy = mock.method(console, "warn", () => {});
    try {
      const countBefore = discoveryCount(warnSpy)();
      const result = await tools.UseSkill.execute(
        { skill: "scripted-skill" },
        { sessionID: "one-pass-use-skill" } as any,
      );
      const discovered = discoveryCount(warnSpy)() - countBefore;
      assert.match(result, /loaded\./i, "use_skill reports a successful load");
      assert.equal(discovered, 1, "exactly one discoverAllSkills pass per successful use_skill");
    } finally {
      warnSpy.mock.restore();
    }
  });

  test("read_skill_file runs exactly one discovery pass per successful invocation", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell, workspace.projectRoot);

    const warnSpy = mock.method(console, "warn", () => {});
    try {
      const countBefore = discoveryCount(warnSpy)();
      const result = await tools.ReadSkillFile.execute(
        { skill: "scripted-skill", filename: "docs/reference.md" },
        { sessionID: "one-pass-read-skill-file" } as any,
      );
      const discovered = discoveryCount(warnSpy)() - countBefore;
      assert.match(result, /loaded\./i, "read_skill_file reports a successful read");
      assert.equal(discovered, 1, "exactly one discoverAllSkills pass per successful read_skill_file");
    } finally {
      warnSpy.mock.restore();
    }
  });

  test("run_skill_script runs exactly one discovery pass per successful invocation", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell, workspace.projectRoot);

    const warnSpy = mock.method(console, "warn", () => {});
    try {
      const countBefore = discoveryCount(warnSpy)();
      const result = await tools.RunSkillScript.execute(
        { skill: "scripted-skill", script: "bin/echo.sh", arguments: ["one"] },
        { sessionID: "one-pass-run-skill-script" } as any,
      );
      const discovered = discoveryCount(warnSpy)() - countBefore;
      assert.ok(typeof result === "string", "run_skill_script returns a string result");
      assert.equal(discovered, 1, "exactly one discoverAllSkills pass per successful run_skill_script");
    } finally {
      warnSpy.mock.restore();
    }
  });

  /**
   * Triangulation: a missing skill must keep its existing miss-message
   * contract. The resolver still discovers once (to score suggestions),
   * but the tool body MUST NOT trigger a second discovery before
   * returning the miss. This pins both the discovery count and the
   * existing user-facing message text.
   */
  test("missing skill preserves the Did-you-mean miss message and runs one discovery", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell, workspace.projectRoot);

    const warnSpy = mock.method(console, "warn", () => {});
    try {
      const countBefore = discoveryCount(warnSpy)();
      const result = await tools.UseSkill.execute(
        { skill: "scripte-skill" }, // typo close to scripted-skill
        { sessionID: "miss-with-suggestion" } as any,
      );
      const discovered = discoveryCount(warnSpy)() - countBefore;
      assert.match(
        result,
        /Skill "scripte-skill" not found\. Did you mean "scripted-skill"\?/,
        "miss message preserves the existing Did-you-mean contract",
      );
      assert.equal(discovered, 1, "missing skill resolution still runs exactly one discovery");
    } finally {
      warnSpy.mock.restore();
    }
  });

  test("missing skill with no close match preserves the bare not-found message and runs one discovery", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell, workspace.projectRoot);

    // Pick a string whose characters and length keep the Levenshtein score
    // below the 0.4 threshold against every fixture skill name, so the
    // helper falls through to the bare not-found message.
    const FAR_OFF_NAME = "zzqqxxccvvbbnnmm";
    const warnSpy = mock.method(console, "warn", () => {});
    try {
      const countBefore = discoveryCount(warnSpy)();
      const result = await tools.ReadSkillFile.execute(
        { skill: FAR_OFF_NAME, filename: "anything.md" },
        { sessionID: "miss-no-suggestion" } as any,
      );
      const discovered = discoveryCount(warnSpy)() - countBefore;
      assert.match(
        result,
        new RegExp(`Skill "${FAR_OFF_NAME}" not found\\. Use get_available_skills to list available skills\\.`),
        "miss message preserves the bare not-found contract",
      );
      assert.equal(discovered, 1, "missing skill resolution still runs exactly one discovery");
    } finally {
      warnSpy.mock.restore();
    }
  });
});

/**
 * Unit 3 (plan 012) — Bounded Script Execution.
 *
 * `runBoundSkillScript` races a shell `.text()` promise against a
 * wall-clock timeout (`SKILL_SCRIPT_TIMEOUT_MS`) and an optional
 * `AbortSignal`. Timeout / cancel return deterministic messages;
 * success returns the shell output verbatim. `apis: ['setTimeout']`
 * keeps the `mock.timers` scope from touching `setImmediate`.
 */
describe("RunSkillScript bounded execution (R-skill-script-execution)", () => {
  describe("runBoundSkillScript helper (pure)", () => {
    /**
     * Drain microtasks queued by a `mock.timers.tick`. The race
     * resolution inside `runBoundSkillScript` settles across a few
     * microtask hops (timeout → race → outer handler), and a single
     * `await Promise.resolve()` is not always enough to drain them.
     * Five sequential drains is empirically safe.
     */
    async function drainMicrotasks(): Promise<void> {
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
    }

    test("returns the shell output verbatim when the shell resolves within the bound", async () => {
      const result = await runBoundSkillScript(
        Promise.resolve("multi\nline\noutput"),
        undefined,
        30_000,
        "/skills/foo/build.sh",
      );
      assert.equal(
        result,
        "multi\nline\noutput",
        "successful shell output must be returned unchanged — no trim, no wrapping",
      );
    });

    test("returns the deterministic timeout message after the bound elapses (mocked clock)", async () => {
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        // A promise that never resolves. The race winner must be the
        // timeout branch, not this branch.
        const neverResolving = new Promise<string>(() => {});
        const helperPromise = runBoundSkillScript(
          neverResolving,
          undefined,
          30_000,
          "/skills/foo/build.sh",
        );

        let resolved = false;
        let resolvedValue: string | undefined;
        helperPromise.then((v) => {
          resolved = true;
          resolvedValue = v;
        });

        await drainMicrotasks();
        assert.equal(resolved, false, "helper must not resolve before the timeout fires");

        mock.timers.tick(30_000);
        await drainMicrotasks();

        assert.equal(resolved, true, "helper must resolve after the timeout fires");
        assert.equal(
          resolvedValue,
          `Script "/skills/foo/build.sh" timed out after 30000ms.`,
          "timeout message must be deterministic and carry the script path + bound",
        );
      } finally {
        mock.timers.reset();
      }
    });

    test("returns the cancellation message when the abort signal is already aborted at call time", async () => {
      const ac = new AbortController();
      ac.abort();
      const result = await runBoundSkillScript(
        new Promise<string>(() => {}),
        ac.signal,
        30_000,
        "/skills/foo/build.sh",
      );
      assert.equal(
        result,
        `Script "/skills/foo/build.sh" cancelled.`,
        "pre-aborted signal must short-circuit to the cancellation branch",
      );
    });

    test("returns the cancellation message when the abort signal fires mid-flight", async () => {
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        const ac = new AbortController();
        const neverResolving = new Promise<string>(() => {});
        const helperPromise = runBoundSkillScript(
          neverResolving,
          ac.signal,
          30_000,
          "/skills/foo/build.sh",
        );

        let resolved = false;
        let resolvedValue: string | undefined;
        helperPromise.then((v) => {
          resolved = true;
          resolvedValue = v;
        });

        await drainMicrotasks();
        assert.equal(resolved, false, "helper must not resolve before abort fires");

        // Fire abort at 100ms (well below the 30s timeout) so the
        // cancellation branch wins the race.
        ac.abort();
        await drainMicrotasks();

        assert.equal(resolved, true, "helper must resolve after abort fires");
        assert.equal(
          resolvedValue,
          `Script "/skills/foo/build.sh" cancelled.`,
          "abort message must be deterministic and carry the script path",
        );
      } finally {
        mock.timers.reset();
      }
    });
  });

  describe("RunSkillScript tool integration", () => {
    let workspace: FixtureWorkspace;
    const previousSuperpowersMode = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;

    /**
     * Shell stub whose `.text()` never resolves. `textCalledPromise`
     * resolves on the `.text()` call so tests can wait for the helper
     * to register its setTimeout / abort listener before racing it.
     */
    function createNeverResolvingShellStub(): {
      shell: unknown;
      calls: Array<{ cwd: string; command: string }>;
      textCalledPromise: Promise<void>;
    } {
      const calls: Array<{ cwd: string; command: string }> = [];
      let currentCwd = "";
      let signalTextCalled: () => void = () => {};
      const textCalledPromise = new Promise<void>((resolve) => {
        signalTextCalled = resolve;
      });
      const shell = Object.assign(
        ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
          calls.push({ cwd: currentCwd, command: "<never-resolving>" });
          return {
            text: () => {
              // Signal AFTER the promise object is constructed so the
              // helper's `await runBoundSkillScript(...)` has already
              // wrapped the shell promise (and scheduled its race).
              signalTextCalled();
              return new Promise<string>(() => {});
            },
          };
        }) as any,
        {
          cwd(directory: string) {
            currentCwd = directory;
            return shell;
          },
          calls,
        },
      );
      return { shell, calls, textCalledPromise };
    }

    /**
     * Shell stub whose `.text()` rejects with a BunShellError-shaped
     * error (`exitCode`, `stdout`, `stderr` Buffers). Pins the
     * exit-code formatting contract.
     */
    function createFailingShellStub(opts: {
      exitCode: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    }): { shell: unknown; calls: Array<{ cwd: string; command: string }> } {
      const calls: Array<{ cwd: string; command: string }> = [];
      let currentCwd = "";
      const shell = Object.assign(
        ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
          calls.push({ cwd: currentCwd, command: "<failing>" });
          const err = Object.assign(
            new Error(opts.message ?? "shell exit error"),
            {
              exitCode: opts.exitCode,
              stdout: Buffer.from(opts.stdout ?? ""),
              stderr: Buffer.from(opts.stderr ?? ""),
            },
          );
          return {
            text: () => Promise.reject(err),
          };
        }) as any,
        {
          cwd(directory: string) {
            currentCwd = directory;
            return shell;
          },
          calls,
        },
      );
      return { shell, calls };
    }

    async function drainMicrotasks(): Promise<void> {
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
    }

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

    test("returns the deterministic timeout message after 30000ms with a never-resolving shell stub", async () => {
      const { shell, textCalledPromise } = createNeverResolvingShellStub();
      const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
      const tools = createSkillTools(host, shell as any, workspace.projectRoot);

      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        const toolPromise = tools.RunSkillScript.execute(
          { skill: "scripted-skill", script: "bin/echo.sh", arguments: ["hi"] },
          { sessionID: "u3-timeout" } as any,
        );

        let resolved = false;
        let resolvedValue: string | undefined;
        toolPromise.then((v) => {
          resolved = true;
          resolvedValue = v as string;
        });

        // Wait for the tool's async setup (skill discovery + script
        // resolution) to reach the helper. Until `.text()` is called,
        // the helper's setTimeout is not yet registered in the mock
        // clock and ticking would be a no-op.
        await textCalledPromise;
        await drainMicrotasks();
        assert.equal(resolved, false, "tool must not resolve before the bound elapses");

        mock.timers.tick(30_000);
        await drainMicrotasks();

        assert.equal(resolved, true, "tool must resolve after 30000ms of mocked time");
        assert.equal(
          resolvedValue,
          `Script "${path.join(workspace.scriptedSkillPath, "bin/echo.sh")}" timed out after 30000ms.`,
          "tool must surface the deterministic timeout message carrying the script path + bound",
        );
      } finally {
        mock.timers.reset();
      }
    });

    test("returns the cancellation message when ctx.abort fires while the shell is still running", async () => {
      const { shell, textCalledPromise } = createNeverResolvingShellStub();
      const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
      const tools = createSkillTools(host, shell as any, workspace.projectRoot);

      const ac = new AbortController();
      const toolPromise = tools.RunSkillScript.execute(
        { skill: "scripted-skill", script: "bin/echo.sh", arguments: ["hi"] },
        { sessionID: "u3-cancel", abort: ac.signal } as any,
      );

      let resolved = false;
      let resolvedValue: string | undefined;
      toolPromise.then((v) => {
        resolved = true;
        resolvedValue = v as string;
      });

      // Wait until the helper has registered its abort listener.
      // Otherwise firing `ac.abort()` before the helper's
      // `addEventListener` runs would silently miss the event and the
      // tool would hang on the 30s timer instead of cancelling.
      await textCalledPromise;
      await drainMicrotasks();
      assert.equal(resolved, false, "tool must not resolve before abort fires");

      ac.abort();
      await drainMicrotasks();

      assert.equal(resolved, true, "tool must resolve after ctx.abort fires");
      assert.equal(
        resolvedValue,
        `Script "${path.join(workspace.scriptedSkillPath, "bin/echo.sh")}" cancelled.`,
        "tool must surface the deterministic cancellation message carrying the script path",
      );
    });

    test("preserves the exit-code formatting `Script failed (exit <code>): <stderr|stdout|message>` on a normal shell failure", async () => {
      // The pre-Unit-3 contract:
      //   - error has `exitCode` and at least one of `stderr` / `stdout` /
      //     `message`
      //   - tool returns: `Script failed (exit <code>): <stderr or stdout or message>`
      // This regression guards the wire-up so Unit 3 doesn't accidentally
      // swallow the error path inside the helper.
      const { shell } = createFailingShellStub({
        exitCode: 42,
        stderr: "boom: command not found",
        stdout: "",
        message: "shell exit error",
      });
      const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
      const tools = createSkillTools(host, shell as any, workspace.projectRoot);

      const result = await tools.RunSkillScript.execute(
        { skill: "scripted-skill", script: "bin/echo.sh", arguments: ["hi"] },
        { sessionID: "u3-exit-code" } as any,
      );

      assert.equal(
        result,
        "Script failed (exit 42): boom: command not found",
        "exit-code formatting must remain byte-identical to the pre-Unit-3 contract",
      );
    });
  });
});
