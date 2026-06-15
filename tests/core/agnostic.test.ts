import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, test, before, after } from "node:test";

/**
 * Agnostic-core contract test.
 *
 * Proves two things about `src/core/`:
 *   1. The core can be exercised end-to-end (discover -> parse -> resolve)
 *      against a throwaway workspace with no OpenCode coupling in the test.
 *   2. No file under `src/core/` references the OpenCode host SDK anywhere
 *      in its source text (imports, comments, strings).
 *
 * The static walk uses literal text matching instead of `require.resolve` so
 * it is deterministic across machines and does not depend on the build.
 */
describe("agnostic core", () => {
  let workspace: string;
  const coreDir = path.resolve(import.meta.dirname, "..", "..", "src", "core");

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-core-agnostic-"));
    const skillDir = path.join(workspace, ".opencode", "skills", "foo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: foo",
        "description: a fixture skill for the agnostic core test",
        "metadata:",
        "  namespace: fixtures",
        "---",
        "",
        "# Foo",
        "",
        "Body content for the foo skill.",
      ].join("\n"),
      "utf8"
    );
  });

  after(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("core exposes discoverAllSkills, parseSkillFile, and resolveSkill", async () => {
    const core = await import("../../src/core/index.ts");

    assert.equal(typeof core.discoverAllSkills, "function");
    assert.equal(typeof core.parseSkillFile, "function");
    assert.equal(typeof core.resolveSkill, "function");
  });

  test("discoverAllSkills finds the foo skill in a temp workspace", async () => {
    const { discoverAllSkills, parseSkillFile, resolveSkill } = await import("../../src/core/index.ts");

    const skills = await discoverAllSkills(workspace);
    const foo = skills.get("foo");

    assert.ok(foo, "expected foo skill to be discovered");
    assert.equal(foo?.description, "a fixture skill for the agnostic core test");
    assert.equal(foo?.label, "project");
    assert.equal(foo?.namespace, "fixtures");

    // Re-parse through the public parseSkillFile entrypoint and confirm the
    // returned Skill is structurally equivalent to the discovered one.
    const skillPath = path.join(workspace, ".opencode", "skills", "foo", "SKILL.md");
    const reparsed = await parseSkillFile(skillPath, "foo", "project");
    assert.ok(reparsed, "expected parseSkillFile to return a Skill");
    assert.equal(reparsed?.name, "foo");
    assert.equal(reparsed?.template.includes("Body content for the foo skill."), true);

    // resolveSkill handles the bare name and the namespaced form.
    assert.equal(resolveSkill("foo", skills)?.name, "foo");
    assert.equal(resolveSkill("project:foo", skills)?.name, "foo");
    assert.equal(resolveSkill("fixtures:foo", skills)?.name, "foo");
    assert.equal(resolveSkill("nope", skills), null);
  });

  test("src/core contains zero references to the OpenCode host SDK", async () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.name.endsWith(".ts")) {
          const text = await readFile(fullPath, "utf8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            if (line.includes("@opencode-ai/plugin")) {
              violations.push({ file: fullPath, line: i + 1, text: line.trim() });
            }
          }
        }
      }
    }

    await walk(coreDir);

    assert.deepEqual(
      violations,
      [],
      `expected zero references to the host SDK under src/core, found: ${JSON.stringify(violations)}`
    );
  });
});
