/**
 * RED phase: Port of packages/core/tests/discovery.test.ts into root src/.
 *
 * These tests verify discovery behaviour (walkDir, findSkillsRecursive, listSkillFiles)
 * against the new root-level modules. They FAIL in RED because src/skills.ts etc. do not exist.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Skill } from "./types";

/**
 * `getSkillSummaries` is the preflight path that builds the list of
 * `SkillSummary` records the plugin feeds into the keyword matcher.
 */
describe("getSkillSummaries trigger passthrough", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-summaries-"));
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
    const { getSkillSummaries } = await import("./skills");
    const summaries = await getSkillSummaries(workspace);

    const withTrigger = summaries.find((s) => s.name === "with-trigger");
    assert.ok(withTrigger, "with-trigger summary is present");
    assert.equal(withTrigger!.trigger, "auth, login", "trigger is preserved on the summary");
  });

  test("leaves `trigger` undefined when the skill has no trigger key", async () => {
    const { getSkillSummaries } = await import("./skills");
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

/**
 * `walkDir` is the shared directory walker backing findSkillsRecursive.
 * These tests pin: hidden-dir skip, dependency-dir skip, depth bounds,
 * per-entry error isolation, and caller-extensible skipDirs.
 */
describe("walkDir shared walker", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-walk-"));
    await mkdir(path.join(workspace, "visible"), { recursive: true });
    await mkdir(path.join(workspace, ".hidden"), { recursive: true });
    await mkdir(path.join(workspace, "node_modules", "dep"), { recursive: true });
    await mkdir(path.join(workspace, ".git", "objects"), { recursive: true });
    await mkdir(path.join(workspace, "extra", "sub"), { recursive: true });
    await writeFile(path.join(workspace, "visible", "file.txt"), "ok", "utf8");
    await writeFile(path.join(workspace, ".hidden", "file.txt"), "skip", "utf8");
    await writeFile(path.join(workspace, "node_modules", "dep", "file.txt"), "skip", "utf8");
    await writeFile(path.join(workspace, ".git", "objects", "file.txt"), "skip", "utf8");
    await writeFile(path.join(workspace, "extra", "sub", "file.txt"), "ok", "utf8");
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("skips hidden directories and the unconditional dependency dirs", async () => {
    const { walkDir } = await import("./fs-walk");
    const visited: string[] = [];
    await walkDir(workspace, 3, (entry) => {
      visited.push(entry.name);
    });
    assert.ok(visited.includes("visible"), "visible dir is visited");
    assert.ok(visited.includes("extra"), "extra dir is visited");
    assert.ok(!visited.includes(".hidden"), "hidden dir is skipped");
    assert.ok(!visited.includes("node_modules"), "node_modules is skipped");
    assert.ok(!visited.includes(".git"), ".git is skipped");
  });

  test("honors maxDepth and stops recursing beyond it", async () => {
    const { walkDir } = await import("./fs-walk");
    const visited: string[] = [];
    await walkDir(path.join(workspace, "extra"), 0, (entry) => {
      visited.push(entry.name);
    });
    assert.deepEqual(visited, ["sub"], "only depth-0 entries are visited at maxDepth=0");
  });

  test("isolates a throwing visitor so siblings still get visited", async () => {
    const { walkDir } = await import("./fs-walk");
    const visited: string[] = [];
    await walkDir(workspace, 1, (entry) => {
      if (entry.name === "visible") throw new Error("boom");
      visited.push(entry.name);
    });
    assert.ok(visited.includes("extra"), "sibling dirs are visited even when a peer throws");
    assert.ok(!visited.includes("file.txt"), "the throwing dir's children are still skipped");
  });

  test("accepts a caller-supplied skipDirs set", async () => {
    const { walkDir } = await import("./fs-walk");
    const customSkip = new Set(["extra"]);
    const visited: string[] = [];
    await walkDir(workspace, 3, (entry) => {
      visited.push(entry.name);
    }, { skipDirs: customSkip });
    assert.ok(visited.includes("visible"), "non-skipped dir is visited");
    assert.ok(!visited.includes("extra"), "caller-supplied skipDirs is honored");
  });

  test("is graceful when baseDir does not exist", async () => {
    const { walkDir } = await import("./fs-walk");
    const ghost = path.join(workspace, "does-not-exist");
    let called = false;
    await walkDir(ghost, 3, () => { called = true; });
    assert.equal(called, false, "visitor is never invoked for a missing baseDir");
  });
});

/**
 * `findSkillsRecursive` pins: root-first check, depth-bounded descent,
 * sorted output, and graceful handling of missing roots.
 */
describe("findSkillsRecursive on walkDir", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-fsr-"));
    const root = path.join(workspace, "skills");
    await mkdir(path.join(root, "alpha"), { recursive: true });
    await mkdir(path.join(root, "beta", "nested"), { recursive: true });
    await mkdir(path.join(root, ".hidden-skill"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "skill"), { recursive: true });

    await writeFile(
      path.join(root, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: top skill\n---\n# alpha\n",
      "utf8"
    );
    await writeFile(
      path.join(root, "beta", "SKILL.md"),
      "---\nname: beta\ndescription: mid skill\n---\n# beta\n",
      "utf8"
    );
    await writeFile(
      path.join(root, "beta", "nested", "SKILL.md"),
      "---\nname: beta-nested\ndescription: nested skill\n---\n# beta nested\n",
      "utf8"
    );
    await writeFile(
      path.join(root, ".hidden-skill", "SKILL.md"),
      "---\nname: hidden\ndescription: must be skipped\n---\n",
      "utf8"
    );
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("discovers SKILL.md at every depth the walker reaches", async () => {
    const { findSkillsRecursive } = await import("./skills");
    const results = await findSkillsRecursive(
      path.join(workspace, "skills"),
      "project",
      3
    );
    const names = results.map((r) => r.relativePath).sort();
    assert.deepEqual(
      names,
      ["alpha", "beta", "beta/nested"],
      "alpha, beta, and beta/nested are discovered"
    );
  });

  test("skips hidden directories and node_modules", async () => {
    const { findSkillsRecursive } = await import("./skills");
    const results = await findSkillsRecursive(
      path.join(workspace, "skills"),
      "project",
      3
    );
    const rels = results.map((r) => r.relativePath);
    assert.ok(!rels.some((r) => r.includes(".hidden-skill")), "hidden dir is skipped");
    assert.ok(!rels.some((r) => r.includes("node_modules")), "node_modules is skipped");
  });

  test("returns results sorted by relativePath", async () => {
    const { findSkillsRecursive } = await import("./skills");
    const results = await findSkillsRecursive(
      path.join(workspace, "skills"),
      "project",
      3
    );
    const rels = results.map((r) => r.relativePath);
    const sorted = [...rels].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(rels, sorted, "result order is sorted by relativePath");
  });

  test("returns [] when baseDir is missing", async () => {
    const { findSkillsRecursive } = await import("./skills");
    const results = await findSkillsRecursive(
      path.join(workspace, "does-not-exist"),
      "project",
      3
    );
    assert.deepEqual(results, [], "missing baseDir yields no results");
  });
});

/**
 * `listSkillFiles` pins: sorted relative paths, SKILL.md exclusion,
 * hidden-dir / node_modules / .git skip, and maxDepth.
 */
describe("listSkillFiles", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-lsf-"));
    const root = path.join(workspace, "skill-dir");
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, ".hidden"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "some-dep"), { recursive: true });
    await mkdir(path.join(root, ".git", "objects"), { recursive: true });
    await mkdir(path.join(root, "nested", "deep"), { recursive: true });

    await writeFile(path.join(root, "SKILL.md"), "# skill\n", "utf8");
    await writeFile(path.join(root, "docs", "guide.md"), "# guide\n", "utf8");
    await writeFile(path.join(root, ".hidden", "secret.txt"), "skip\n", "utf8");
    await writeFile(path.join(root, "node_modules", "some-dep", "index.js"), "skip\n", "utf8");
    await writeFile(path.join(root, ".git", "objects", "pack.idx"), "skip\n", "utf8");
    await writeFile(path.join(root, "nested", "deep", "file.txt"), "ok\n", "utf8");
    await writeFile(path.join(root, "nested", "README.md"), "ok\n", "utf8");
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("returns sorted relative paths for visible files, excluding SKILL.md", async () => {
    const { listSkillFiles } = await import("./skills");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.deepEqual(files, ["docs/guide.md", "nested/README.md", "nested/deep/file.txt"]);
  });

  test("skips hidden directories", async () => {
    const { listSkillFiles } = await import("./skills");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.ok(!files.some((f) => f.includes(".hidden")), "no files from hidden dirs");
  });

  test("skips node_modules", async () => {
    const { listSkillFiles } = await import("./skills");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.ok(!files.some((f) => f.includes("node_modules")), "node_modules is skipped");
  });

  test("skips .git", async () => {
    const { listSkillFiles } = await import("./skills");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.ok(!files.some((f) => f.includes(".git")), ".git is skipped");
  });

  test("returns empty array when base directory does not exist", async () => {
    const { listSkillFiles } = await import("./skills");
    const ghost = path.join(workspace, "does-not-exist");
    const files = await listSkillFiles(ghost, 3);
    assert.deepEqual(files, []);
  });

  test("honors maxDepth", async () => {
    const { listSkillFiles } = await import("./skills");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 1);
    assert.deepEqual(files, ["docs/guide.md", "nested/README.md"]);
  });
});

/**
 * `discoverAllSkills` pins: all four default roots are searched,
 * first-found-wins priority for duplicate names, and each skill
 * carries the correct label from its discovery root.
 */
describe("discoverAllSkills — four-root priority and labels", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-discover-"));
    const r1 = path.join(workspace, ".opencode", "skills");
    const r2 = path.join(workspace, ".claude", "skills");
    const r3 = path.join(workspace, "user-opencode", "skills");
    const r4 = path.join(workspace, "user-claude", "skills");
    await mkdir(r1, { recursive: true });
    await mkdir(r2, { recursive: true });
    await mkdir(r3, { recursive: true });
    await mkdir(r4, { recursive: true });
    await writeFile(path.join(r1, "SKILL.md"),
      "---\nname: alpha\ndescription: from .opencode/skills\n---\n# alpha\n", "utf8");
    await writeFile(path.join(r2, "SKILL.md"),
      "---\nname: bravo\ndescription: from .claude/skills\n---\n# bravo\n", "utf8");
    await writeFile(path.join(r3, "SKILL.md"),
      "---\nname: charlie\ndescription: from user opencode\n---\n# charlie\n", "utf8");
    await writeFile(path.join(r4, "SKILL.md"),
      "---\nname: delta\ndescription: from user claude\n---\n# delta\n", "utf8");
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("discovers skills from all four roots and labels them correctly", async () => {
    const { discoverAllSkills } = await import("./skills");
    const roots: import("./types").DiscoveryPath[] = [
      { path: path.join(workspace, ".opencode", "skills"), label: "project", maxDepth: 3 },
      { path: path.join(workspace, ".claude", "skills"), label: "claude-project", maxDepth: 3 },
      { path: path.join(workspace, "user-opencode", "skills"), label: "user", maxDepth: 3 },
      { path: path.join(workspace, "user-claude", "skills"), label: "claude-user", maxDepth: 3 },
    ];
    const skills = await discoverAllSkills(workspace, roots);
    assert.equal(skills.size, 4, "all four skills are discovered");
    assert.equal(skills.get("alpha")?.label, "project", "alpha is project label");
    assert.equal(skills.get("bravo")?.label, "claude-project", "bravo is claude-project label");
    assert.equal(skills.get("charlie")?.label, "user", "charlie is user label");
    assert.equal(skills.get("delta")?.label, "claude-user", "delta is claude-user label");
  });

  test("first-found skill wins when the same name appears in multiple roots", async () => {
    const { discoverAllSkills } = await import("./skills");
    // Use a separate subdir to avoid interfering with the shared workspace
    const subWs = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-priority-"));
    const r1 = path.join(subWs, ".opencode", "skills");
    const r2 = path.join(subWs, "user-opencode", "skills");
    await mkdir(r1, { recursive: true });
    await mkdir(r2, { recursive: true });
    await writeFile(path.join(r1, "SKILL.md"),
      "---\nname: shared\ndescription: from project root\n---\n# shared\n", "utf8");
    await writeFile(path.join(r2, "SKILL.md"),
      "---\nname: shared\ndescription: from user root\n---\n# shared\n", "utf8");

    const roots: import("./types").DiscoveryPath[] = [
      { path: r1, label: "project", maxDepth: 3 },
      { path: r2, label: "user", maxDepth: 3 },
    ];
    const skills = await discoverAllSkills(subWs, roots);
    assert.equal(skills.get("shared")?.description, "from project root",
      "first root (project) wins over second root (user)");
    await rm(subWs, { recursive: true, force: true });
  });

  test("onDuplicate callback fires when two roots provide the same skill name", async () => {
    const { discoverAllSkills } = await import("./skills");
    // Use a separate subdir to avoid interfering with the shared workspace
    const subWs = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-dup-"));
    const r1 = path.join(subWs, ".opencode", "skills");
    const r2 = path.join(subWs, "user-opencode", "skills");
    await mkdir(r1, { recursive: true });
    await mkdir(r2, { recursive: true });
    // Same name "alpha" in both roots
    await writeFile(path.join(r1, "SKILL.md"),
      "---\nname: alpha\ndescription: first alpha\n---\n# alpha\n", "utf8");
    await writeFile(path.join(r2, "SKILL.md"),
      "---\nname: alpha\ndescription: second alpha\n---\n# alpha\n", "utf8");

    const roots: import("./types").DiscoveryPath[] = [
      { path: r1, label: "project", maxDepth: 3 },
      { path: r2, label: "user", maxDepth: 3 },
    ];
    const duplicateCalls: Array<{ existing: string; duplicate: string }> = [];
    await discoverAllSkills(subWs, roots, (existing, duplicate) => {
      duplicateCalls.push({ existing: existing.description, duplicate: duplicate.description });
    });
    assert.equal(duplicateCalls.length, 1, "onDuplicate was called once");
    const first = duplicateCalls[0];
    assert.ok(first);
    assert.equal(first!.existing, "first alpha", "existing is the first-discovered");
    assert.equal(first!.duplicate, "second alpha", "duplicate is the second-discovered");
    await rm(subWs, { recursive: true, force: true });
  });
});

/**
 * `resolveSkill` pins: plain name lookup, namespace prefix parsing,
 * and null for unknown names.
 */
describe("resolveSkill", () => {
  let skillsMap: Map<string, import("./types").Skill>;

  before(async () => {
    const { discoverAllSkills } = await import("./skills");
    // Bootstrap a minimal workspace
    const workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-resolve-"));
    await mkdir(path.join(workspace, ".opencode", "skills", "proj-skill"), { recursive: true });
    await mkdir(path.join(workspace, ".claude", "skills", "claude-skill"), { recursive: true });
    await writeFile(
      path.join(workspace, ".opencode", "skills", "proj-skill", "SKILL.md"),
      "---\nname: proj-skill\ndescription: a project skill\n---\n# proj-skill\n",
      "utf8"
    );
    await writeFile(
      path.join(workspace, ".claude", "skills", "claude-skill", "SKILL.md"),
      "---\nname: claude-skill\ndescription: a claude skill\n---\n# claude-skill\n",
      "utf8"
    );
    skillsMap = await discoverAllSkills(workspace);
    await rm(workspace, { recursive: true, force: true });
  });

  test("resolves a plain skill name", async () => {
    const { resolveSkill } = await import("./skills");
    const skill = resolveSkill("proj-skill", skillsMap);
    assert.ok(skill, "skill is found");
    assert.equal(skill!.name, "proj-skill");
  });

  test("resolves a namespace-prefixed skill name", async () => {
    const { resolveSkill } = await import("./skills");
    const skill = resolveSkill("project:proj-skill", skillsMap);
    assert.ok(skill, "namespaced skill is found");
    assert.equal(skill!.name, "proj-skill");
  });

  test("returns null for an unknown skill name", async () => {
    const { resolveSkill } = await import("./skills");
    const skill = resolveSkill("does-not-exist", skillsMap);
    assert.equal(skill, null, "unknown name returns null");
  });
});

/**
 * `formatSkillListing` and `renderAvailableSkillsBlock` pin: compact bullet
 * format, no trigger leakage, and proper XML tag wrapping.
 */
describe("formatSkillListing — compact bullet format without trigger leakage", () => {
  test("renders `- name: description` for each skill and omits trigger", async () => {
    const { formatSkillListing } = await import("./preference");
    const skills: Skill[] = [
      {
        name: "alpha",
        description: "first skill",
        path: "/a",
        relativePath: "a",
        label: "project",
        scripts: [],
        template: "",
        tags: [],
        trigger: "auth, login",
      },
      {
        name: "bravo",
        description: "second skill",
        path: "/b",
        relativePath: "b",
        label: "user",
        scripts: [],
        template: "",
        tags: [],
      },
    ];

    const output = formatSkillListing(skills);

    assert.match(output, /^- alpha: first skill$/m);
    assert.match(output, /^- bravo: second skill$/m);
    assert.doesNotMatch(output, /trigger:/, "trigger must NOT appear in the listing");
  });

  test("returns empty string for an empty skill list", async () => {
    const { formatSkillListing } = await import("./preference");
    assert.equal(formatSkillListing([]), "");
  });
});

describe("renderAvailableSkillsBlock — XML wrapper without trigger leakage", () => {
  test("wraps listing in `<available-skills>` tags and never leaks trigger", async () => {
    const { renderAvailableSkillsBlock } = await import("./skills");
    const skills: Skill[] = [
      {
        name: "alpha",
        description: "first skill",
        path: "/a",
        relativePath: "a",
        label: "project",
        scripts: [],
        template: "",
        tags: [],
        trigger: "auth, login",
      },
    ];

    const output = renderAvailableSkillsBlock(skills);

    assert.match(output, /<available-skills>/);
    assert.match(output, /<\/available-skills>/);
    assert.match(output, /^- alpha: first skill$/m);
    assert.doesNotMatch(output, /trigger:/, "trigger text must NOT appear in the block");
  });
});

/**
 * `parseSkillFile` frontmatter validation — safe narrowing edge cases.
 * Ported from packages/core/tests/parse-trigger.test.ts safe-narrowing suite.
 */
describe("parseSkillFile — frontmatter safe narrowing (valid/invalid)", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-parse-"));
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  async function writeSkill(relDir: string, body: string): Promise<string> {
    const dir = path.join(workspace, relDir);
    await mkdir(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    await writeFile(skillPath, body, "utf8");
    return skillPath;
  }

  test("rejects non-string name (parseSkillFile -> null)", async () => {
    const { parseSkillFile } = await import("./skills");
    const skillPath = await writeSkill("bad-name-type", [
      "---",
      "name: 123",
      "description: hi",
      "---",
      "",
      "body",
    ].join("\n"));
    assert.equal(await parseSkillFile(skillPath, "bad-name-type", "project"), null);
  });

  test("rejects name that does not match the kebab-case regex (parseSkillFile -> null)", async () => {
    const { parseSkillFile } = await import("./skills");
    const skillPath = await writeSkill("bad-name-shape", [
      "---",
      "name: BadName",
      "description: hi",
      "---",
      "",
      "body",
    ].join("\n"));
    assert.equal(await parseSkillFile(skillPath, "bad-name-shape", "project"), null);
  });

  test("rejects empty description (parseSkillFile -> null)", async () => {
    const { parseSkillFile } = await import("./skills");
    const skillPath = await writeSkill("no-description", [
      "---",
      "name: no-description",
      'description: ""',
      "---",
      "",
      "body",
    ].join("\n"));
    assert.equal(await parseSkillFile(skillPath, "no-description", "project"), null);
  });

  test("rejects non-string license (parseSkillFile -> null)", async () => {
    const { parseSkillFile } = await import("./skills");
    const skillPath = await writeSkill("bad-license", [
      "---",
      "name: bad-license",
      "description: hi",
      "license: 42",
      "---",
      "",
      "body",
    ].join("\n"));
    assert.equal(await parseSkillFile(skillPath, "bad-license", "project"), null);
  });

  test("rejects allowed-tools that is not an array (parseSkillFile -> null)", async () => {
    const { parseSkillFile } = await import("./skills");
    const skillPath = await writeSkill("bad-tools", [
      "---",
      "name: bad-tools",
      "description: hi",
      "allowed-tools: read",
      "---",
      "",
      "body",
    ].join("\n"));
    assert.equal(await parseSkillFile(skillPath, "bad-tools", "project"), null);
  });

  test("rejects metadata that is a primitive (parseSkillFile -> null)", async () => {
    const { parseSkillFile } = await import("./skills");
    const skillPath = await writeSkill("bad-metadata", [
      "---",
      "name: bad-metadata",
      "description: hi",
      "metadata: 7",
      "---",
      "",
      "body",
    ].join("\n"));
    assert.equal(await parseSkillFile(skillPath, "bad-metadata", "project"), null);
  });

  test("valid frontmatter surfaces every optional field on the Skill", async () => {
    const { parseSkillFile } = await import("./skills");
    // Use inline object for metadata (block-style indented YAML is not supported by manual parser)
    const skillPath = await writeSkill("full-frontmatter", [
      "---",
      "name: full-frontmatter",
      "description: a skill with every optional field set",
      "trigger: keyword",
      "license: MIT",
      "allowed-tools: [read, write]",
      "metadata: {namespace: ns, tags: [a, b]}",
      "---",
      "",
      "# body",
    ].join("\n"));

    const skill = await parseSkillFile(skillPath, "full-frontmatter", "project");

    assert.ok(skill, "expected parseSkillFile to return a Skill for valid frontmatter");
    assert.equal(skill?.name, "full-frontmatter");
    assert.equal(skill?.description, "a skill with every optional field set");
    assert.equal(skill?.trigger, "keyword");
    assert.equal(skill?.namespace, "ns");
    assert.deepEqual(skill?.tags, ["a", "b"]);
  });

  test("non-string trigger value rejects the file (parseSkillFile -> null)", async () => {
    const { parseSkillFile } = await import("./skills");
    const skillPath = await writeSkill("bad-trigger", [
      "---",
      "name: bad-trigger",
      "description: skill with invalid trigger",
      "trigger: 123",
      "---",
      "",
      "# body",
    ].join("\n"));
    assert.equal(await parseSkillFile(skillPath, "bad-trigger", "project"), null);
  });
});
