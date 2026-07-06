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
import { createSkillTools, resolveSkillOrSuggest } from "../../src/tools";

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
