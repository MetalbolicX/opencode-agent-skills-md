import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";

describe("plugin startup smoke", () => {
  let projectRoot: string;

  before(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-e2e-"));
    const skillDir = path.join(projectRoot, ".opencode", "skills", "smoke-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: smoke-skill",
        "description: minimal smoke skill",
        "---",
        "",
        "# Smoke Skill",
        "",
        "Smoke test content.",
      ].join("\n"),
      "utf8"
    );
  });

  test("imports the built plugin and completes a first message", async () => {
    const module = await import("../../dist/plugin.mjs");
    const SkillsPlugin = module.SkillsPlugin as (input: any) => Promise<any>;

    const prompts: Array<{ text: string }> = [];
    const plugin = await SkillsPlugin({
      client: {
        session: {
          messages: async () => ({ data: [] }),
          prompt: async ({ body }: any) => {
            prompts.push({ text: body.parts[0].text });
          },
        },
      },
      $: Object.assign(((strings: TemplateStringsArray, ...values: unknown[]) => ({ text: async () => String(values.join(" ")) })) as any, {
        cwd: () => undefined,
      }),
      directory: projectRoot,
    });

    await plugin["chat.message"](
      {},
      {
        message: {
          sessionID: "smoke-session",
          model: { providerID: "test-provider", modelID: "test-model" },
          agent: "smoke-agent",
        },
        parts: [{ type: "text", text: "hello smoke", synthetic: false }],
      } as any
    );

    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!.text, /<available-skills>/);
  });
});
