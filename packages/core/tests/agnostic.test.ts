import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, test, before, after, mock } from "node:test";

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
  const coreDir = path.resolve(import.meta.dirname, "..", "src");

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
    const core = await import("../src/index.ts");

    assert.equal(typeof core.discoverAllSkills, "function");
    assert.equal(typeof core.parseSkillFile, "function");
    assert.equal(typeof core.resolveSkill, "function");
  });

  test("discoverAllSkills finds the foo skill in a temp workspace", async () => {
    const { discoverAllSkills, parseSkillFile, resolveSkill } = await import("../src/index.ts");

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
      `expected zero references to the host SDK under packages/core/src, found: ${JSON.stringify(violations)}`
    );
  });

  test("discovers a SKILL.md placed at the root of a discovery baseDir", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-root-"));
    const opencodeSkills = path.join(rootDir, ".opencode", "skills");
    await mkdir(opencodeSkills, { recursive: true });
    await writeFile(
      path.join(opencodeSkills, "SKILL.md"),
      [
        "---",
        "name: root-skill",
        "description: a skill defined at the baseDir root",
        "---",
        "",
        "# Root",
        "",
        "Body for the root-level skill.",
      ].join("\n"),
      "utf8"
    );

    try {
      const { discoverAllSkills } = await import("../src/index.ts");
      const skills = await discoverAllSkills(rootDir);

      const found = skills.get("root-skill");
      assert.ok(found, "expected root-skill to be discovered from the baseDir root");
      assert.equal(found?.relativePath, "");
      assert.equal(found?.label, "project");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("root-level SKILL.md wins the shadowing tie-break over a same-name subdir", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-root-tie-"));
    const opencodeSkills = path.join(rootDir, ".opencode", "skills");
    await mkdir(opencodeSkills, { recursive: true });

    await writeFile(
      path.join(opencodeSkills, "SKILL.md"),
      [
        "---",
        "name: shared",
        "description: root version wins",
        "---",
        "",
        "# Root",
      ].join("\n"),
      "utf8"
    );

    const subdir = path.join(opencodeSkills, "shared");
    await mkdir(subdir, { recursive: true });
    await writeFile(
      path.join(subdir, "SKILL.md"),
      [
        "---",
        "name: shared",
        "description: subdir version is shadowed",
        "---",
        "",
        "# Subdir",
      ].join("\n"),
      "utf8"
    );

    try {
      const { discoverAllSkills } = await import("../src/index.ts");
      const skills = await discoverAllSkills(rootDir);

      const found = skills.get("shared");
      assert.ok(found, "expected shared skill to be discovered");
      assert.equal(found?.description, "root version wins");
      assert.equal(found?.relativePath, "");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("discovers a nested skill at depth 3 under .claude/skills (maxDepth=3)", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-depth-"));
    const deepDir = path.join(rootDir, ".claude", "skills", "foo", "bar", "baz");
    await mkdir(deepDir, { recursive: true });
    await writeFile(
      path.join(deepDir, "SKILL.md"),
      [
        "---",
        "name: deep-skill",
        "description: nested two subdir levels under .claude/skills",
        "---",
        "",
        "# Deep",
      ].join("\n"),
      "utf8"
    );

    try {
      const { discoverAllSkills } = await import("../src/index.ts");
      const skills = await discoverAllSkills(rootDir);

      const found = skills.get("deep-skill");
      assert.ok(found, "expected deep-skill to be discovered with maxDepth=3");
      assert.equal(found?.label, "claude-project");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("does not discover skills beyond depth 3 (maxDepth cap preserved)", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-deep-cap-"));
    const tooDeep = path.join(rootDir, ".claude", "skills", "a", "b", "c", "d", "e");
    await mkdir(tooDeep, { recursive: true });
    await writeFile(
      path.join(tooDeep, "SKILL.md"),
      [
        "---",
        "name: too-deep",
        "description: lives 4 levels under .claude/skills",
        "---",
        "",
        "# Too Deep",
      ].join("\n"),
      "utf8"
    );

    try {
      const { discoverAllSkills } = await import("../src/index.ts");
      const skills = await discoverAllSkills(rootDir);

      assert.equal(skills.get("too-deep"), undefined, "depth-4 skill must be skipped");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("onDuplicate callback fires when two roots provide the same skill name", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-dup-root-"));
    const homeDir = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-dup-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      const projectSkill = path.join(rootDir, ".opencode", "skills", "shared-skill");
      await mkdir(projectSkill, { recursive: true });
      await writeFile(
        path.join(projectSkill, "SKILL.md"),
        [
          "---",
          "name: shared-skill",
          "description: project version wins",
          "---",
          "",
          "# Project",
        ].join("\n"),
        "utf8"
      );

      const userSkill = path.join(homeDir, ".claude", "skills", "shared-skill");
      await mkdir(userSkill, { recursive: true });
      await writeFile(
        path.join(userSkill, "SKILL.md"),
        [
          "---",
          "name: shared-skill",
          "description: user version should be shadowed",
          "---",
          "",
          "# User",
        ].join("\n"),
        "utf8"
      );

      const duplicateSpy = mock.fn((_existing: unknown, _dup: unknown) => {});
      const { discoverAllSkills } = await import("../src/index.ts");
      const skills = await discoverAllSkills(rootDir, undefined, duplicateSpy);

      // First match wins: project should be retained.
      assert.equal(skills.get("shared-skill")?.label, "project");
      assert.equal(skills.get("shared-skill")?.description, "project version wins");
      assert.equal(duplicateSpy.mock.calls.length, 1);

      const call = duplicateSpy.mock.calls[0];
      assert.ok(call, "expected the duplicate callback to have been called");
      const [existing, duplicate] = call.arguments as [
        { label: string; path: string },
        { label: string; path: string }
      ];
      assert.equal(existing.label, "project");
      assert.equal(duplicate.label, "claude-user");
      assert.match(duplicate.path, new RegExp(`${path.sep}shared-skill$`));
    } finally {
      process.env.HOME = previousHome;
      await rm(rootDir, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("onDuplicate callback is NOT called when all discovered skills are unique", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-uniq-"));
    const opencodeSkills = path.join(rootDir, ".opencode", "skills", "alpha");
    await mkdir(opencodeSkills, { recursive: true });
    await writeFile(
      path.join(opencodeSkills, "SKILL.md"),
      [
        "---",
        "name: alpha",
        "description: only skill in this workspace",
        "---",
        "",
        "# Alpha",
      ].join("\n"),
      "utf8"
    );

    try {
      const duplicateSpy = mock.fn((_existing: unknown, _dup: unknown) => {});
      // Pin roots to a single project root so the user's real HOME does not
      // create an unintended duplicate that would taint the assertion.
      const roots = [
        { path: path.join(rootDir, ".opencode", "skills"), label: "project" as const, maxDepth: 3 },
      ];
      const { discoverAllSkills } = await import("../src/index.ts");
      await discoverAllSkills(rootDir, roots, duplicateSpy);

      assert.equal(duplicateSpy.mock.calls.length, 0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
