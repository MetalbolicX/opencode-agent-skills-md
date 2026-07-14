/**
 * Tests for fs-walk: additional coverage.
 *
 * Tests:
 *   - walkDir respects maxDepth limit
 *   - walkDir skips hidden directories (starting with .)
 *   - walkDir skips node_modules and .git unconditionally
 *   - per-entry visitor errors are isolated and do not abort the walk
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { walkDir } from "./fs-walk";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("walkDir depth limit", () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "walk-depth-"));
  });

  test.afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("walkDir visits entries at depth 0 and depth 1 with maxDepth=1", async () => {
    // Structure: tmpDir/d0file, tmpDir/d1dir/d1file
    // With depth > maxDepth: entries at depth maxDepth ARE visited (check happens after visit)
    await writeFile(path.join(tmpDir, "d0file.txt"), "d0");
    await mkdir(path.join(tmpDir, "d1dir"), { recursive: true });
    await writeFile(path.join(tmpDir, "d1dir", "d1file.txt"), "d1");

    const visited: string[] = [];
    await walkDir(tmpDir, 1, (entry) => {
      visited.push(`${entry.name}`);
    });

    assert.ok(visited.includes("d0file.txt"), "depth-0 file should be visited");
    assert.ok(visited.includes("d1dir"), "d1dir should be visited at depth 0");
    assert.ok(visited.includes("d1file.txt"), "d1file at depth 1 should be visited with maxDepth=1");
  });

  test("walkDir visits entries up to maxDepth=2 (depth 0, 1, 2)", async () => {
    await mkdir(path.join(tmpDir, "d1dir", "d2dir"), { recursive: true });
    await writeFile(path.join(tmpDir, "d1dir", "d2file.txt"), "d2");

    const visited: string[] = [];
    await walkDir(tmpDir, 2, (entry) => {
      visited.push(`${entry.name}`);
    });

    // With depth > maxDepth: entries at depth 2 are visited (check happens after)
    assert.ok(visited.includes("d2file.txt"), "depth-2 file should be visited when maxDepth=2");
  });

  test("walkDir does not visit entries at depth > maxDepth", async () => {
    await mkdir(path.join(tmpDir, "d1dir", "d2dir", "d3dir"), { recursive: true });
    await writeFile(path.join(tmpDir, "d1dir", "d2dir", "d3dir", "deep.txt"), "deep");

    const visited: string[] = [];
    await walkDir(tmpDir, 2, (entry) => {
      visited.push(`${entry.name}`);
    });

    // deep.txt is at depth 3 (d1dir/d2dir/d3dir/deep.txt), which is > maxDepth=2
    // So deep.txt should NOT be visited
    assert.ok(!visited.includes("deep.txt"), "depth-3 file should NOT be visited when maxDepth=2");
  });
});

describe("walkDir hidden dir skipping", () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "walk-hidden-"));
  });

  test.afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("walkDir skips directories starting with .", async () => {
    await mkdir(path.join(tmpDir, ".hidden-dir"), { recursive: true });
    await writeFile(path.join(tmpDir, ".hidden-dir", "secret.txt"), "secret");
    await writeFile(path.join(tmpDir, "visible.txt"), "visible");

    const visited: string[] = [];
    await walkDir(tmpDir, 10, (entry) => {
      visited.push(entry.name);
    });

    assert.ok(visited.includes("visible.txt"), "visible file should be visited");
    assert.ok(!visited.includes("secret.txt"), "file inside hidden dir should NOT be visited");
    assert.ok(!visited.includes(".hidden-dir"), "hidden dir name should NOT appear in visited");
  });

  test("walkDir skips files starting with . (dotfiles)", async () => {
    await writeFile(path.join(tmpDir, ".dotfile"), "dotfile content");
    await writeFile(path.join(tmpDir, "normal.txt"), "normal content");

    const visited: string[] = [];
    await walkDir(tmpDir, 10, (entry) => {
      visited.push(entry.name);
    });

    assert.ok(visited.includes("normal.txt"), "normal file should be visited");
    assert.ok(!visited.includes(".dotfile"), "dotfile should NOT be visited");
  });
});

describe("walkDir node_modules and .git skipping", () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "walk-skip-"));
  });

  test.afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("walkDir skips node_modules directory", async () => {
    await mkdir(path.join(tmpDir, "node_modules", "some-package"), { recursive: true });
    await writeFile(path.join(tmpDir, "node_modules", "some-package", "index.js"), "module content");
    await writeFile(path.join(tmpDir, "index.js"), "root content");

    const visited: string[] = [];
    await walkDir(tmpDir, 10, (entry) => {
      visited.push(entry.name);
    });

    assert.ok(visited.includes("index.js"), "root-level index.js should be visited");
    assert.ok(!visited.includes("node_modules"), "node_modules should NOT be visited");
    assert.ok(!visited.includes("some-package"), "package inside node_modules should NOT be visited");
  });

  test("walkDir skips .git directory", async () => {
    await mkdir(path.join(tmpDir, ".git", "objects"), { recursive: true });
    await writeFile(path.join(tmpDir, ".git", "config"), "git config");
    await writeFile(path.join(tmpDir, "readme.md"), "readme");

    const visited: string[] = [];
    await walkDir(tmpDir, 10, (entry) => {
      visited.push(entry.name);
    });

    assert.ok(visited.includes("readme.md"), "readme.md should be visited");
    assert.ok(!visited.includes(".git"), ".git should NOT be visited");
    assert.ok(!visited.includes("config"), "file inside .git should NOT be visited");
  });
});

describe("walkDir per-entry error isolation", () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "walk-err-"));
  });

  test.afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("visitor error on one entry does not abort the walk for subsequent entries", async () => {
    await writeFile(path.join(tmpDir, "file1.txt"), "content1");
    await writeFile(path.join(tmpDir, "file2.txt"), "content2");
    await writeFile(path.join(tmpDir, "file3.txt"), "content3");

    const visited: string[] = [];
    let errorCount = 0;

    await walkDir(tmpDir, 10, (entry) => {
      if (entry.name === "file2.txt") {
        errorCount++;
        throw new Error("synthetic visitor error for file2");
      }
      visited.push(entry.name);
    });

    assert.equal(errorCount, 1, "only file2 should have triggered the error");
    assert.ok(visited.includes("file1.txt"), "file1 should still be visited");
    assert.ok(!visited.includes("file2.txt"), "file2 should not appear in visited due to error");
    assert.ok(visited.includes("file3.txt"), "file3 should still be visited after error");
  });
});
