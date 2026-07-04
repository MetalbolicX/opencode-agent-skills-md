import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
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
    const { getSkillSummaries } = await import("../src/index");
    const summaries = await getSkillSummaries(workspace);

    const withTrigger = summaries.find((s) => s.name === "with-trigger");
    assert.ok(withTrigger, "with-trigger summary is present");
    assert.equal(withTrigger!.trigger, "auth, login", "trigger is preserved on the summary");
  });

  test("leaves `trigger` undefined when the skill has no trigger key", async () => {
    const { getSkillSummaries } = await import("../src/index");
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
 * `walkDir` (R2 of source-improvements-p1) is the shared directory walker
 * that backs `findSkillsRecursive` and `findScripts`. These tests pin the
 * cross-cutting behavior those callers depend on: hidden / dependency
 * skip rules, depth bounds, per-entry error isolation, and the
 * caller-extensible `skipDirs` option.
 */
describe("walkDir (R2 shared walker)", () => {
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
    const { walkDir } = await import("../src/walk");
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
    const { walkDir } = await import("../src/walk");
    const visited: string[] = [];
    await walkDir(path.join(workspace, "extra"), 0, (entry) => {
      visited.push(entry.name);
    });
    assert.deepEqual(visited, ["sub"], "only depth-0 entries are visited at maxDepth=0");
  });

  test("isolates a throwing visitor so siblings still get visited", async () => {
    const { walkDir } = await import("../src/walk");
    const visited: string[] = [];
    await walkDir(workspace, 1, (entry) => {
      if (entry.name === "visible") throw new Error("boom");
      visited.push(entry.name);
    });
    assert.ok(visited.includes("extra"), "sibling dirs are visited even when a peer throws");
    assert.ok(!visited.includes("file.txt"), "the throwing dir's children are still skipped");
  });

  test("accepts a caller-supplied skipDirs set", async () => {
    const { walkDir } = await import("../src/walk");
    const customSkip = new Set(["extra"]);
    const visited: string[] = [];
    await walkDir(workspace, 3, (entry) => {
      visited.push(entry.name);
    }, { skipDirs: customSkip });
    assert.ok(visited.includes("visible"), "non-skipped dir is visited");
    assert.ok(!visited.includes("extra"), "caller-supplied skipDirs is honored");
  });

  test("is graceful when baseDir does not exist", async () => {
    const { walkDir } = await import("../src/walk");
    const ghost = path.join(workspace, "does-not-exist");
    let called = false;
    await walkDir(ghost, 3, () => { called = true; });
    assert.equal(called, false, "visitor is never invoked for a missing baseDir");
  });
});

/**
 * `findSkillsRecursive` was refactored onto `walkDir`. These tests pin
 * the behavior the refactor must preserve: root-first check, depth-bounded
 * descent, sorted output, and graceful handling of missing roots.
 */
describe("findSkillsRecursive on walkDir (R2)", () => {
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
    const { findSkillsRecursive } = await import("../src/discovery");
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
    const { findSkillsRecursive } = await import("../src/discovery");
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
    const { findSkillsRecursive } = await import("../src/discovery");
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
    const { findSkillsRecursive } = await import("../src/discovery");
    const results = await findSkillsRecursive(
      path.join(workspace, "does-not-exist"),
      "project",
      3
    );
    assert.deepEqual(results, [], "missing baseDir yields no results");
  });
});

/**
 * `findScripts` was refactored onto `walkDir` with the script-specific
 * `skipDirs` set. These tests pin the executable-bit filter and the
 * `__pycache__` / `.venv` skip semantics the refactor must preserve.
 */
describe("findScripts on walkDir (R2)", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-fs-"));
    await mkdir(path.join(workspace, "scripts", "bin"), { recursive: true });
    await mkdir(path.join(workspace, "scripts", "__pycache__"), { recursive: true });
    await mkdir(path.join(workspace, "scripts", ".venv", "bin"), { recursive: true });

    const exec = path.join(workspace, "scripts", "bin", "run.sh");
    const plain = path.join(workspace, "scripts", "bin", "README.md");
    const pyCache = path.join(workspace, "scripts", "__pycache__", "mod.pyc");
    const venvExec = path.join(workspace, "scripts", ".venv", "bin", "python");

    await writeFile(exec, "#!/bin/sh\necho hi\n", "utf8");
    await writeFile(plain, "not executable", "utf8");
    await writeFile(pyCache, "fake bytecode", "utf8");
    await writeFile(venvExec, "fake venv binary", "utf8");

    await chmod(exec, 0o755);
    await chmod(pyCache, 0o755);
    await chmod(venvExec, 0o755);
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("returns only files with the executable bit set", async () => {
    const { findScripts } = await import("../src/scripts");
    const scripts = await findScripts(path.join(workspace, "scripts"), 3);
    const rels = scripts.map((s) => s.relativePath);
    assert.deepEqual(rels, ["bin/run.sh"], "only the executable file is returned");
  });

  test("skips __pycache__ and .venv via the caller-supplied skipDirs", async () => {
    const { findScripts } = await import("../src/scripts");
    const scripts = await findScripts(path.join(workspace, "scripts"), 3);
    const rels = scripts.map((s) => s.relativePath);
    assert.ok(!rels.some((r) => r.includes("__pycache__")), "__pycache__ is skipped");
    assert.ok(!rels.some((r) => r.includes(".venv")), ".venv is skipped");
  });
});

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
    const { listSkillFiles } = await import("../src/discovery");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.deepEqual(files, ["docs/guide.md", "nested/README.md", "nested/deep/file.txt"]);
  });

  test("skips hidden directories", async () => {
    const { listSkillFiles } = await import("../src/discovery");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.ok(!files.some((f) => f.includes(".hidden")), "no files from hidden dirs");
  });

  test("skips node_modules", async () => {
    const { listSkillFiles } = await import("../src/discovery");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.ok(!files.some((f) => f.includes("node_modules")), "node_modules is skipped");
  });

  test("skips .git", async () => {
    const { listSkillFiles } = await import("../src/discovery");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 3);
    assert.ok(!files.some((f) => f.includes(".git")), ".git is skipped");
  });

  test("returns empty array when base directory does not exist", async () => {
    const { listSkillFiles } = await import("../src/discovery");
    const ghost = path.join(workspace, "does-not-exist");
    const files = await listSkillFiles(ghost, 3);
    assert.deepEqual(files, []);
  });

  test("honors maxDepth", async () => {
    const { listSkillFiles } = await import("../src/discovery");
    const root = path.join(workspace, "skill-dir");
    const files = await listSkillFiles(root, 1);
    assert.deepEqual(files, ["docs/guide.md", "nested/README.md"]);
  });
});
