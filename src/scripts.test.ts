/**
 * Tests for scripts module.
 *
 * Tests:
 *   - findScripts: discovers executable scripts recursively
 *   - isPathSafe: validates paths don't escape base directory
 *
 * Note: Tests use temporary directories for filesystem isolation.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findScripts, isPathSafe } from "./scripts";
import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import * as path from "path";
import * as os from "os";

describe("findScripts", () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "scripts-test-"));
  });

  test.afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array when no scripts exist", async () => {
    await mkdir(path.join(tmpDir, "subdir"), { recursive: true });
    const scripts = await findScripts(tmpDir);
    assert.deepEqual(scripts, []);
  });

  test("discovers executable scripts in skill root", async () => {
    await writeFile(path.join(tmpDir, "build.sh"), "#!/bin/sh\necho build", { mode: 0o755 });

    const scripts = await findScripts(tmpDir);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0]!.relativePath, "build.sh");
  });

  test("discovers executable scripts in subdirectories", async () => {
    await mkdir(path.join(tmpDir, "bin"), { recursive: true });
    await writeFile(path.join(tmpDir, "bin", "test.sh"), "#!/bin/sh\necho test", { mode: 0o755 });

    const scripts = await findScripts(tmpDir);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0]!.relativePath, "bin/test.sh");
  });

  test("only includes files with execute bit (mode & 0o111)", async () => {
    await writeFile(path.join(tmpDir, "script.sh"), "#!/bin/sh\necho", { mode: 0o644 }); // no execute bit

    const scripts = await findScripts(tmpDir);
    assert.equal(scripts.length, 0);
  });

  test("skips __pycache__, .venv, venv, .tox, .nox directories", async () => {
    await mkdir(path.join(tmpDir, "__pycache__"), { recursive: true });
    await writeFile(path.join(tmpDir, "__pycache__", "script.sh"), "#!/bin/sh\necho", { mode: 0o755 });

    const scripts = await findScripts(tmpDir);
    assert.equal(scripts.length, 0, "scripts in __pycache__ should be skipped");
  });

  test("sorts scripts by relative path", async () => {
    await mkdir(path.join(tmpDir, "bin"), { recursive: true });
    await writeFile(path.join(tmpDir, "bin", "zebra.sh"), "#!/bin/sh", { mode: 0o755 });
    await writeFile(path.join(tmpDir, "bin", "alpha.sh"), "#!/bin/sh", { mode: 0o755 });

    const scripts = await findScripts(tmpDir);
    assert.equal(scripts[0]!.relativePath, "bin/alpha.sh");
    assert.equal(scripts[1]!.relativePath, "bin/zebra.sh");
  });

  test("respects maxDepth limit", async () => {
    await mkdir(path.join(tmpDir, "level1", "level2"), { recursive: true });
    await writeFile(path.join(tmpDir, "level1", "level2", "deep.sh"), "#!/bin/sh", { mode: 0o755 });

    // deep.sh is at depth 2 (level1/level2/deep.sh)
    // With > semantics: maxDepth=3 visits depths 0,1,2; maxDepth=2 visits depths 0,1,2; maxDepth=1 visits depth 0 only
    const scriptsAtDepth3 = await findScripts(tmpDir, 3);
    assert.ok(scriptsAtDepth3.some(s => s.relativePath.includes("deep.sh")), "depth 2 should be visited with maxDepth=3");

    const scriptsAtDepth2 = await findScripts(tmpDir, 2);
    assert.ok(scriptsAtDepth2.some(s => s.relativePath.includes("deep.sh")), "depth 2 should be visited with maxDepth=2");

    const scriptsAtDepth1 = await findScripts(tmpDir, 1);
    assert.ok(!scriptsAtDepth1.some(s => s.relativePath.includes("deep.sh")), "depth 2 should NOT be visited with maxDepth=1");
  });
});

describe("isPathSafe", () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "pathsafe-test-"));
  });

  test.afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns true for file within base directory", async () => {
    await writeFile(path.join(tmpDir, "readme.md"), "content");
    const safe = await isPathSafe(tmpDir, "readme.md");
    assert.equal(safe, true);
  });

  test("returns true for nested path within base directory", async () => {
    await mkdir(path.join(tmpDir, "bin"), { recursive: true });
    await writeFile(path.join(tmpDir, "bin", "script.sh"), "#!/bin/sh");
    const safe = await isPathSafe(tmpDir, "bin/script.sh");
    assert.equal(safe, true);
  });

  test("returns false for path that escapes base directory (traversal)", async () => {
    await writeFile(path.join(tmpDir, "readme.md"), "content");
    const safe = await isPathSafe(tmpDir, "../readme.md");
    assert.equal(safe, false);
  });

  test("returns false for absolute path outside base directory", async () => {
    await writeFile(path.join(tmpDir, "readme.md"), "content");
    const safe = await isPathSafe(tmpDir, "/etc/passwd");
    assert.equal(safe, false);
  });

  test("returns false for traversal that escapes via non-existent intermediate", async () => {
    const safe = await isPathSafe(tmpDir, "../non-existent/../readme.md");
    assert.equal(safe, false);
  });
});
