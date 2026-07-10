/**
 * Script discovery and path-safety helpers.
 *
 * Mirrors packages/core/src/scripts.ts behaviour.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Script } from "./types";
import { walkDir } from "./utils";

const SCRIPT_SKIP_DIRS: ReadonlySet<string> = new Set([
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.nox',
]);

export const findScripts = async (skillPath: string, maxDepth: number = 10): Promise<Script[]> => {
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
};

export const isPathSafe = async (basePath: string, requestedPath: string): Promise<boolean> => {
  const resolved = path.resolve(basePath, requestedPath);
  try {
    const resolvedReal = await fs.realpath(resolved);
    const baseReal = await fs.realpath(basePath);
    return resolvedReal.startsWith(baseReal + path.sep) || resolvedReal === baseReal;
  } catch {
    return false;
  }
};
