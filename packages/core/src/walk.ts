/**
 * Internal shared directory walker.
 *
 * Walks `baseDir` recursively up to `maxDepth` and invokes `visitor` for each
 * non-skipped entry. The walker owns the traversal rules shared by skill
 * discovery (`findSkillsRecursive`) and script enumeration (`findScripts`):
 *
 *   - hidden directories (names starting with `.`) are skipped
 *   - `node_modules` and `.git` are skipped unconditionally
 *   - per-entry errors (read, stat, or visitor throw) are isolated so a
 *     single broken symlink or throwing visitor does not abort the walk
 *
 * Callers that need extra skip sets (e.g. `__pycache__`, `.venv` for the
 * scripts layer) pass them via {@link WalkOptions.skipDirs}. The walker does
 * NOT re-export its skip rules — each caller decides what extra paths are
 * not its business to enter.
 *
 * The walker is internal to the core package: it is intentionally NOT
 * re-exported from `packages/core/src/index.ts`. Callers import it
 * directly from `./walk`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";

/** Directories the walker skips on every invocation, regardless of caller. */
const ALWAYS_SKIP = new Set(["node_modules", ".git"]);

/**
 * Optional walker configuration.
 *
 * Kept narrow on purpose: only fields both callers need belong here.
 * Anything caller-specific (e.g. script executable-bit filter) lives in
 * the visitor, not in the walker.
 */
export interface WalkOptions {
  /**
   * Extra directory names the walker should skip in addition to the
   * unconditional `node_modules` / `.git` and the hidden-dir rule.
   * Use this for caller-specific skip sets such as Python cache dirs
   * or virtualenvs in the scripts layer.
   */
  skipDirs?: ReadonlySet<string>;
}

/**
 * Walk `baseDir` recursively, invoking `visitor` for each non-skipped entry.
 *
 * The visitor is called depth-first with the entry's `parentPath` already
 * populated (Node 20.12+), so callers can build absolute paths via
 * `path.join(entry.parentPath, entry.name)` without restating the parent.
 *
 * `currentDepth` is the depth of the directory containing the entry:
 * `0` for entries inside `baseDir`, `1` for entries inside its subdirs,
 * and so on. Entries beyond `maxDepth` are never visited.
 *
 * The visitor may be sync or async; the walker awaits it so any state
 * the visitor records (e.g. "skip this subtree") is visible to the
 * subsequent recursive step.
 *
 * A missing or unreadable `baseDir` is not an error: the walker simply
 * yields nothing. Per-entry failures (read, stat, or a throwing visitor)
 * are likewise isolated to the offending entry.
 */
export async function walkDir(
  baseDir: string,
  maxDepth: number,
  visitor: (entry: Dirent, currentDepth: number) => void | Promise<void>,
  options: WalkOptions = {}
): Promise<void> {
  const skipDirs = options.skipDirs;
  await walk(baseDir, 0, maxDepth, visitor, skipDirs);
}

async function walk(
  dir: string,
  depth: number,
  maxDepth: number,
  visitor: (entry: Dirent, currentDepth: number) => void | Promise<void>,
  skipDirs: ReadonlySet<string> | undefined
): Promise<void> {
  if (depth > maxDepth) return;

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // baseDir missing or unreadable: stay graceful, the walker is a utility.
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (ALWAYS_SKIP.has(entry.name)) continue;
    if (skipDirs?.has(entry.name)) continue;

    try {
      await visitor(entry, depth);
    } catch {
      // Per-entry error isolation: a throwing visitor must not abort the walk.
      continue;
    }

    if (entry.isDirectory()) {
      await walk(path.join(dir, entry.name), depth + 1, maxDepth, visitor, skipDirs);
    }
  }
}