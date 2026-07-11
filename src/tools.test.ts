/**
 * RED phase: Port of packages/opencode-agent-skills-md/tests/opencode/tools.test.ts
 * into root src/tools.test.ts.
 *
 * These tests verify the four skill tools:
 *   - GetAvailableSkills trigger rendering
 *   - resolveSkillOrSuggest shared resolver
 *   - single-pass tool discovery
 *   - runBoundSkillScript bounded execution
 *   - RunSkillScript tool integration
 *
 * RED because src/tools.ts stub does not implement the full tool factories yet.
 */

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
} from "./test-helpers";
import { createOpencodeSkillHost } from "./host";
import {
  createSkillTools,
  resolveSkillOrSuggest,
  runBoundSkillScript,
  SKILL_SCRIPT_TIMEOUT_MS,
} from "./tools";

/**
 * Hand-rolled stub OpenCode client for tools tests.
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
 * GetAvailableSkills trigger behaviour:
 *   - skills with a non-empty `trigger` get a `trigger: <text>` line under the description
 *   - skills with no trigger stay exactly as before
 */
describe("GetAvailableSkills trigger rendering", () => {
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

    // The compact listing keeps `- name: description` for the no-trigger fixture.
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
 * resolveSkillOrSuggest — the shared resolver for use_skill, read_skill_file, run_skill_script.
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
    // "alph" is a prefix of "alpha" — findClosestMatch scores this well above threshold.
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
 * Single-pass tool discovery. Each tool invocation must complete with exactly one
 * discoverAllSkills pass.
 *
 * Implementation note: Bun's test runner does not implement `mock.method`
 * (a Node-only API). We replace it with a lightweight spy that wraps
 * `console.warn` and records the raw arguments so we can count only the
 * duplicate-discovery warnings surfaced by `defaultOnDuplicate`.
 */
describe("single-pass tool discovery", () => {
  type WarnSpy = {
    calls: unknown[][];
    restore: () => void;
  };

  function spyConsoleWarn(): WarnSpy {
    const original = console.warn;
    const calls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
    return {
      calls,
      restore: () => {
        console.warn = original;
      },
    };
  }


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
  function discoveryCount(warnSpy: WarnSpy): () => number {
    return () => warnSpy.calls.filter(
      (c) => typeof c[0] === "string"
        && (c[0] as string).startsWith("Skill name conflict:"),
    ).length;
  }

  test("use_skill runs exactly one discovery pass per successful invocation", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell as any, workspace.projectRoot);

    const warnSpy = spyConsoleWarn();
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
      warnSpy.restore();
    }
  });

  test("read_skill_file runs exactly one discovery pass per successful invocation", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell as any, workspace.projectRoot);

    const warnSpy = spyConsoleWarn();
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
      warnSpy.restore();
    }
  });

  test("run_skill_script runs exactly one discovery pass per successful invocation", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell as any, workspace.projectRoot);

    const warnSpy = spyConsoleWarn();
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
      warnSpy.restore();
    }
  });

  test("missing skill preserves the Did-you-mean miss message and runs one discovery", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell as any, workspace.projectRoot);

    const warnSpy = spyConsoleWarn();
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
      warnSpy.restore();
    }
  });

  test("missing skill with no close match preserves the bare not-found message and runs one discovery", async () => {
    const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
    const shell = createShellRecorder();
    const tools = createSkillTools(host, shell.shell as any, workspace.projectRoot);

    // Pick a string far from any fixture skill name to stay below the match threshold.
    const FAR_OFF_NAME = "zzqqxxccvvbbnnmm";
    const warnSpy = spyConsoleWarn();
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
      warnSpy.restore();
    }
  });
});

/**
 * runBoundSkillScript bounded execution.
 *
 * Implementation note: Bun's test runner does not implement `mock.timers`
 * (a Node-only API). The abort and cancellation tests work with real timers
 * because the abort/resolve always wins before the timeout fires and the
 * cleanup clears the timer. The pure-helper timeout test uses a tiny real
 * timeout (10ms) instead of a mocked 30000ms clock. The integration timeout
 * test relies on the optional `scriptTimeoutMs` parameter of
 * `createSkillTools` so the bound stays small.
 */
describe("runBoundSkillScript bounded execution", () => {
  /**
   * Drain microtasks queued after an async resolution to let `.then` callbacks run.
   */
  async function drainMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  }

  describe("runBoundSkillScript helper (pure)", () => {
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

    test("returns the deterministic timeout message after the bound elapses (real clock)", async () => {
      const neverResolving = new Promise<string>(() => {});
      const result = await runBoundSkillScript(
        neverResolving,
        undefined,
        10,
        "/skills/foo/build.sh",
      );
      assert.equal(
        result,
        `Script "/skills/foo/build.sh" timed out after 10ms.`,
        "timeout message must be deterministic and carry the script path + bound",
      );
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

      ac.abort();
      await drainMicrotasks();

      assert.equal(resolved, true, "helper must resolve after abort fires");
      assert.equal(
        resolvedValue,
        `Script "/skills/foo/build.sh" cancelled.`,
        "abort message must be deterministic and carry the script path",
      );
    });
  });

  describe("RunSkillScript tool integration", () => {
    let workspace: FixtureWorkspace;
    const previousSuperpowersMode = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;

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

    test("returns the deterministic timeout message after 10ms with a never-resolving shell stub", async () => {
      const { shell, textCalledPromise } = createNeverResolvingShellStub();
      const host = createOpencodeSkillHost(createMockOpencodeClient().client as any);
      const tools = createSkillTools(host, shell as any, workspace.projectRoot, undefined, 10);

      const toolPromise = tools.RunSkillScript.execute(
        { skill: "scripted-skill", script: "bin/echo.sh", arguments: ["hi"] },
        { sessionID: "u3-timeout" } as any,
      );

      await textCalledPromise;

      const result = await toolPromise;
      assert.equal(
        result,
        `Script "${path.join(workspace.scriptedSkillPath, "bin/echo.sh")}" timed out after 10ms.`,
        "tool must surface the deterministic timeout message carrying the script path + bound",
      );
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
