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
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-trigger-"));
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

    const { parseSkillFile } = await import("../src/index.ts");
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

    const { parseSkillFile } = await import("../src/index.ts");
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

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "bad-trigger", "project");

    assert.equal(skill, null, "expected parseSkillFile to return null for invalid trigger type");
  });
});

/**
 * Safe narrowing in `validateFrontmatter` (PR1b).
 *
 * Each frontmatter field is validated individually before the result is
 * constructed — no `as unknown as SkillFrontmatter` cast. These tests
 * confirm `parseSkillFile` returns `null` for every shape the validator
 * rejects, and that valid frontmatter round-trips through to the Skill.
 */
describe("parseSkillFile — safe frontmatter narrowing", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-narrow-"));
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

  test("rejects non-string name (parseSkillFile -> null)", async () => {
    const skillPath = await writeSkill(
      "bad-name-type",
      [
        "---",
        "name: 123",
        "description: hi",
        "---",
        "",
        "body",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "bad-name-type", "project");

    assert.equal(skill, null);
  });

  test("rejects name that does not match the kebab-case regex (parseSkillFile -> null)", async () => {
    const skillPath = await writeSkill(
      "bad-name-shape",
      [
        "---",
        "name: BadName",
        "description: hi",
        "---",
        "",
        "body",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "bad-name-shape", "project");

    assert.equal(skill, null);
  });

  test("rejects empty description (parseSkillFile -> null)", async () => {
    const skillPath = await writeSkill(
      "no-description",
      [
        "---",
        "name: no-description",
        "description: \"\"",
        "---",
        "",
        "body",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "no-description", "project");

    assert.equal(skill, null);
  });

  test("rejects non-string license (parseSkillFile -> null)", async () => {
    const skillPath = await writeSkill(
      "bad-license",
      [
        "---",
        "name: bad-license",
        "description: hi",
        "license: 42",
        "---",
        "",
        "body",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "bad-license", "project");

    assert.equal(skill, null);
  });

  test("rejects allowed-tools that is not an array (parseSkillFile -> null)", async () => {
    const skillPath = await writeSkill(
      "bad-tools",
      [
        "---",
        "name: bad-tools",
        "description: hi",
        "allowed-tools: read",
        "---",
        "",
        "body",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "bad-tools", "project");

    assert.equal(skill, null);
  });

  test("rejects metadata that is a primitive (parseSkillFile -> null)", async () => {
    const skillPath = await writeSkill(
      "bad-metadata",
      [
        "---",
        "name: bad-metadata",
        "description: hi",
        "metadata: 7",
        "---",
        "",
        "body",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "bad-metadata", "project");

    assert.equal(skill, null);
  });

  test("valid frontmatter surfaces every optional field on the Skill", async () => {
    const skillPath = await writeSkill(
      "full-frontmatter",
      [
        "---",
        "name: full-frontmatter",
        "description: a skill with every optional field set",
        "trigger: keyword",
        "license: MIT",
        "allowed-tools: [read, write]",
        "metadata:",
        "  namespace: ns",
        "  tags: [a, b]",
        "---",
        "",
        "# body",
      ].join("\n"),
    );

    const { parseSkillFile } = await import("../src/index.ts");
    const skill = await parseSkillFile(skillPath, "full-frontmatter", "project");

    assert.ok(skill, "expected parseSkillFile to return a Skill for valid frontmatter");
    assert.equal(skill?.name, "full-frontmatter");
    assert.equal(skill?.description, "a skill with every optional field set");
    assert.equal(skill?.trigger, "keyword");
    assert.equal(skill?.namespace, "ns");
    assert.deepEqual(skill?.tags, ["a", "b"]);
  });
});
