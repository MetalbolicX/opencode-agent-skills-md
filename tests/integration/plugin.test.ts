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
    const { discoverAllSkills } = await import("../../src/core");

    const skills = await discoverAllSkills(workspace.projectRoot);

    assert.equal(skills.get("shared-skill")?.label, "project");
    assert.equal(skills.get("shared-skill")?.description, "project version wins over user fixture");
    assert.equal(skills.get("nested-skill")?.description, "nested skill fixture");
    assert.equal(skills.get("user-only-skill")?.label, "user");
  });

  test("loads startup context, tools, and reinjection hooks", async () => {
    const { SkillsPlugin } = await import("../../src/opencode");

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
    const { SkillsPlugin } = await import("../../src/opencode");

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
});
