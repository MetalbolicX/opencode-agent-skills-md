// ---------------------------------------------------------------------------
// src/cli/cache.ts — Cache path resolution and recursive purge for the
// opencode-agent-skills-md plugin.
//
// Resolves paths under ~/.cache/opencode/packages/ that match the plugin name
// (exact and `@<version>` suffix variants). Purge is best-effort via CliFs
// so failures during cleanup never abort the calling command.
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join } from "node:path";
import type { CliFs } from "./config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Package directory used by OpenCode to cache plugin installs. */
export const PACKAGES_DIR_BASENAME = [".cache", "opencode", "packages"] as const;

/** Exact cache directory name we look for (bare specifier, no version suffix). */
export const CACHE_DIR_BASENAME = "opencode-agent-skills-md";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the user's home directory, honoring a custom HOME env var.
 * Used by both resolveCachePaths and the config loader.
 */
export const resolveHome = (env: NodeJS.ProcessEnv = process.env): string => {
  return env.HOME ?? homedir();
};

/**
 * Return the absolute path of the OpenCode packages cache directory.
 */
export const resolvePackagesDir = (env: NodeJS.ProcessEnv = process.env): string => {
  return join(resolveHome(env), ...PACKAGES_DIR_BASENAME);
};

/**
 * Return the cache directories that match the opencode-agent-skills-md prefix.
 *
 * Real-world layout under ~/.cache/opencode/packages/ looks like:
 *   opencode-agent-skills-md/
 *   opencode-agent-skills-md@latest/
 *   some-other-plugin/
 *
 * We glob-match anything starting with `opencode-agent-skills-md` (exact or with
 * an `@<version>` suffix). When an injected fs is provided we list the
 * directory and filter; without one we return the two most common shapes
 * so callers can pre-check existence cheaply.
 */
export const resolveCachePaths = (
  env: NodeJS.ProcessEnv = process.env,
  fs?: CliFs,
): string[] => {
  const packagesDir = resolvePackagesDir(env);
  if (fs && fs.existsSync(packagesDir)) {
    try {
      const entries = fs.readdirSync(packagesDir);
      return entries
        .filter(
          (name) =>
            name === CACHE_DIR_BASENAME ||
            name.startsWith(`${CACHE_DIR_BASENAME}@`),
        )
        .map((name) => join(packagesDir, name));
    } catch {
      return [];
    }
  }
  // No fs injection — return the conventional candidates. Callers that care
  // about existence should still check with existsSync().
  return [
    join(packagesDir, CACHE_DIR_BASENAME),
    join(packagesDir, `${CACHE_DIR_BASENAME}@latest`),
  ];
};

// ---------------------------------------------------------------------------
// Recursive purge
// ---------------------------------------------------------------------------

/**
 * Recursively delete a directory and all its contents using the injected fs.
 * Best-effort — a failed purge is not fatal; we want the update to keep going.
 */
export const purgeDirectory = (fs: CliFs, dirPath: string): void => {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(dirPath, entry);
    try {
      if (!fs.existsSync(entryPath)) continue;
      // Probe to differentiate empty dirs / non-empty dirs / files. The injected
      // fs interface does not expose stat, so we try readdir first and fall back
      // to unlink for leaves.
      try {
        const subEntries = fs.readdirSync(entryPath);
        if (subEntries.length === 0) {
          fs.rmdirSync(entryPath);
        } else {
          purgeDirectory(fs, entryPath);
          fs.rmdirSync(entryPath);
        }
      } catch {
        // Not a directory (or unreadable) — best-effort unlink.
        fs.unlinkSync(entryPath);
      }
    } catch {
      // best-effort per entry
    }
  }

  try {
    fs.rmdirSync(dirPath);
  } catch {
    // best-effort
  }
};
