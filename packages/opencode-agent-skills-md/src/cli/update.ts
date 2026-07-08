// ---------------------------------------------------------------------------
// src/cli/update.ts — `oas update` command.
// ---------------------------------------------------------------------------

import { rmSync } from "node:fs";
import { type CliFs } from "./config";
import { createRealFs } from "./real-fs";
import {
  fetchLatestVersion,
  getInstalledVersion,
  isStale,
  type LatestVersionFetcher,
} from "./registry";
import { cachePath } from "./uninstall";

export interface UpdateOptions {
  /** Plan the change and print it without writing. */
  dryRun?: boolean;
}

export interface UpdateResult {
  status: "wrote" | "planned" | "noop";
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  cachePath: string;
  purged: string[];
}

const RECOVERY_COMMAND = `npx opencode-agent-skills-md@latest install`;

const purgeDir = (path: string): string | null => {
  try {
    rmSync(path, { recursive: true, force: true });
    return path;
  } catch {
    return null;
  }
};

/**
 * Run `oas update`.
 *
 * The command never auto-installs. It only checks freshness, clears the
 * runtime cache when stale, and points the user at the canonical recovery
 * command so they can reinstall the latest release explicitly.
 */
export const runUpdate = async (
  opts: UpdateOptions = {},
  fs: CliFs = createRealFs(),
  fetchLatestVersionFn: LatestVersionFetcher = fetchLatestVersion,
  purge: (path: string) => string | null = purgeDir,
): Promise<UpdateResult> => {
  const installedVersion = getInstalledVersion(fs);
  const latestVersion = await fetchLatestVersionFn();
  const updateAvailable = isStale(installedVersion, latestVersion);
  const target = cachePath();

  if (installedVersion === null || latestVersion === null || updateAvailable !== true) {
    if (installedVersion === null) {
      console.log(`✓ Update check skipped: bundled package version is unavailable`);
    } else if (latestVersion === null) {
      console.log(`✓ Update check skipped: registry version is unavailable`);
    } else {
      console.log(`✓ Already up to date (${installedVersion})`);
    }

    return {
      status: "noop",
      installedVersion,
      latestVersion,
      updateAvailable,
      cachePath: target,
      purged: [],
    };
  }

  if (opts.dryRun) {
    console.log(`[dry-run] Would purge: ${target}`);
    console.log(`[dry-run] Next step: ${RECOVERY_COMMAND}`);
    return {
      status: "planned",
      installedVersion,
      latestVersion,
      updateAvailable,
      cachePath: target,
      purged: [target],
    };
  }

  const purgedPath = purge(target);

  console.log(`✓ Update available (${installedVersion} → ${latestVersion})`);
  if (purgedPath) console.log(`  purged: ${purgedPath}`);
  console.log(`  next: ${RECOVERY_COMMAND}`);

  return {
    status: "wrote",
    installedVersion,
    latestVersion,
    updateAvailable,
    cachePath: target,
    purged: purgedPath ? [purgedPath] : [],
  };
};
