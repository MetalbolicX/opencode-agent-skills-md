import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";

/**
 * `getSkillSummaries` is the preflight path that builds the list of
 * `SkillSummary` records the plugin feeds into the keyword matcher and
 * the `<available-skills>` injection. PR 2 threads the `trigger`
 * frontmatter key through it so the matcher can rank by trigger and
 * the targeted outputs can render trigger text.
 */
describe("getSkillSummaries trigger passthrough (PR 2)", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-summaries-"));
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
  });

  after(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("threads `trigger` through to SkillSummary when present", async () => {
    const { getSkillSummaries } = await import("../../src/core/index");
    const summaries = await getSkillSummaries(workspace);

    const withTrigger = summaries.find((s) => s.name === "with-trigger");
    assert.ok(withTrigger, "with-trigger summary is present");
    assert.equal(withTrigger!.trigger, "auth, login", "trigger is preserved on the summary");
  });

  test("leaves `trigger` undefined when the skill has no trigger key", async () => {
    const { getSkillSummaries } = await import("../../src/core/index");
    const summaries = await getSkillSummaries(workspace);

    const noTrigger = summaries.find((s) => s.name === "no-trigger");
    assert.ok(noTrigger, "no-trigger summary is present");
    assert.equal(
      noTrigger!.trigger,
      undefined,
      "trigger is undefined for skills that omit the frontmatter key"
    );
  });
});
