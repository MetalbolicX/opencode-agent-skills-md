import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, test, before, after } from "node:test";

/**
 * `trigger` frontmatter parsing — exercises the contract in R1/R2 of the
 * `sdd/trigger-aware-skill-discovery` spec.
 *
 * Scenarios covered:
 *   - trigger string is parsed and surfaced on the resulting Skill
 *   - missing trigger is accepted; `Skill.trigger` is `undefined`
 *   - invalid (non-string) trigger rejects the file (parseSkillFile -> null)
 */
describe("parseSkillFile — trigger frontmatter", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-trigger-"));
  });

  after(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  async function writeSkill(
    relDir: string,
    body: string
  ): Promise<string> {
    const dir = path.join(workspace, relDir);
    await mkdir(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    await writeFile(skillPath, body, "utf8");
    return skillPath;
  }

  test("parses a non-empty trigger string into Skill.trigger", async () => {
    const skillPath = await writeSkill(
      "with-trigger",
      [
        "---",
        "name: with-trigger",
        "description: skill whose frontmatter carries a trigger",
        "trigger: auth, login",
        "---",
        "",
        "# With Trigger",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../../src/core/index.ts");
    const skill = await parseSkillFile(skillPath, "with-trigger", "project");

    assert.ok(skill, "expected parseSkillFile to return a Skill for valid trigger");
    assert.equal(skill?.name, "with-trigger");
    assert.equal(skill?.trigger, "auth, login");
  });

  test("omitted trigger leaves Skill.trigger as undefined and still parses", async () => {
    const skillPath = await writeSkill(
      "no-trigger",
      [
        "---",
        "name: no-trigger",
        "description: skill whose frontmatter omits trigger",
        "---",
        "",
        "# No Trigger",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../../src/core/index.ts");
    const skill = await parseSkillFile(skillPath, "no-trigger", "project");

    assert.ok(skill, "expected parseSkillFile to succeed without trigger");
    assert.equal(skill?.name, "no-trigger");
    assert.equal(skill?.trigger, undefined);
  });

  test("non-string trigger value rejects the file (parseSkillFile -> null)", async () => {
    const skillPath = await writeSkill(
      "bad-trigger",
      [
        "---",
        "name: bad-trigger",
        "description: skill whose frontmatter has an invalid trigger",
        "trigger: 123",
        "---",
        "",
        "# Bad Trigger",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../../src/core/index.ts");
    const skill = await parseSkillFile(skillPath, "bad-trigger", "project");

    assert.equal(skill, null, "expected parseSkillFile to return null for invalid trigger type");
  });
});
