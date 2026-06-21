import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { createOpencodeSkillHost } from "../../src/host";
import { createSkillTools } from "../../src/tools";

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
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-tools-trigger-"));
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
