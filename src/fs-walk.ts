/**
 * Filesystem directory walker.
 *
 * Mirrors packages/core/src/walk.ts behaviour.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";

/** Directories the walker skips unconditionally. */
const ALWAYS_SKIP = new Set(["node_modules", ".git"]);

export interface WalkOptions {
  skipDirs?: ReadonlySet<string>;
}

/**
 * Walk `baseDir` recursively up to `maxDepth`, invoking `visitor` for each entry.
 * Hidden directories, node_modules, and .git are skipped unconditionally.
 * Per-entry errors are isolated so a single broken entry does not abort the walk.
 */
export const walkDir = async (
  baseDir: string,
  maxDepth: number,
  visitor: (entry: Dirent, currentDepth: number) => void | Promise<void>,
  options: WalkOptions = {}
): Promise<void> => {
  const skipDirs = options.skipDirs;
  await walk(baseDir, 0, maxDepth, visitor, skipDirs);
};

const walk = async (
  dir: string,
  depth: number,
  maxDepth: number,
  visitor: (entry: Dirent, currentDepth: number) => void | Promise<void>,
  skipDirs: ReadonlySet<string> | undefined
): Promise<void> => {
  if (depth > maxDepth) return;

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (ALWAYS_SKIP.has(entry.name)) continue;
    if (skipDirs?.has(entry.name)) continue;

    try {
      await visitor(entry, depth);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      await walk(path.join(dir, entry.name), depth + 1, maxDepth, visitor, skipDirs);
    }
  }
};
