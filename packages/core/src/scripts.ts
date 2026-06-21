/**
 * Script discovery and path-safety helpers.
 *
 * Pure functions: filesystem reads only, no host dependencies.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Script } from "./types";

/**
 * Recursively find executable scripts in a skill's directory.
 * Skips hidden directories (starting with .) and common dependency dirs.
 * Only files with executable bit set are returned.
 */
export async function findScripts(skillPath: string, maxDepth: number = 10): Promise<Script[]> {
  const scripts: Script[] = [];
  const skipDirs = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv', '.tox', '.nox']);

  async function recurse(dir: string, depth: number, relPath: string) {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (skipDirs.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const newRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          await recurse(fullPath, depth + 1, newRelPath);
        } else if (stats.isFile()) {
          if (stats.mode & 0o111) {
            scripts.push({
              relativePath: newRelPath,
              absolutePath: fullPath
            });
          }
        }
      }
    } catch { }
  }

  await recurse(skillPath, 0, '');
  return scripts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Check if a path is safely within a base directory (no escape via ..)
 */
export function isPathSafe(basePath: string, requestedPath: string): boolean {
  const resolved = path.resolve(basePath, requestedPath);
  return resolved.startsWith(basePath + path.sep) || resolved === basePath;
}
