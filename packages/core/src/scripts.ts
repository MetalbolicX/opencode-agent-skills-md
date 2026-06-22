/**
 * Script discovery and path-safety helpers.
 *
 * Pure functions: filesystem reads only, no host dependencies.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Script } from "./types";
import { walkDir } from "./walk";

/**
 * Directory names the script walker skips on top of the unconditional
 * `node_modules` / `.git` / hidden-dir rules owned by {@link walkDir}.
 * These are common dependency / cache directories that never host skill
 * scripts and would otherwise inflate the file scan.
 */
const SCRIPT_SKIP_DIRS: ReadonlySet<string> = new Set([
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.nox',
]);

/**
 * Recursively find executable scripts in a skill's directory.
 *
 * Traversal is delegated to the shared {@link walkDir} utility, which owns
 * hidden-dir / `node_modules` / `.git` skip rules and per-entry error
 * isolation. The visitor checks each file entry's executable bit (the
 * `0o111` mode mask) and pushes a `Script` record only for files that
 * qualify.
 *
 * Output is sorted by `relativePath` so callers see a stable order
 * regardless of the underlying `readdir` enumeration order.
 */
export async function findScripts(skillPath: string, maxDepth: number = 10): Promise<Script[]> {
  const scripts: Script[] = [];

  await walkDir(skillPath, maxDepth, async (entry) => {
    if (!entry.isFile()) return;
    const fullPath = path.join(entry.parentPath, entry.name);
    const relPath = path.relative(skillPath, fullPath);

    let stats;
    try {
      stats = await fs.stat(fullPath);
    } catch {
      return;
    }

    if (stats.mode & 0o111) {
      scripts.push({ relativePath: relPath, absolutePath: fullPath });
    }
  }, { skipDirs: SCRIPT_SKIP_DIRS });

  return scripts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Check if a path is safely within a base directory (no escape via ..)
 */
export function isPathSafe(basePath: string, requestedPath: string): boolean {
  const resolved = path.resolve(basePath, requestedPath);
  return resolved.startsWith(basePath + path.sep) || resolved === basePath;
}
