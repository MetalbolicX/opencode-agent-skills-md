// ---------------------------------------------------------------------------
// src/cli/update.ts — `oaskills update` command.
//
// Rewritten for PR 2: update ALWAYS purges the runtime cache and re-registers
// via `opencode plugin --global --force`. There is no staleness gate — every
// `oaskills update` is a clean re-install. This guarantees the plugin cache
// is always consistent with the latest published version.
//
// Design (Option A from SDD design):
//   - runUpdate MUST purge cache unconditionally — no staleness gate
//   - runUpdate MUST spawn `opencode plugin opencode-agent-skills-md --global --force`
//   - runUpdate signature: (fs, env, log, error, opts?) — full dependency injection
// ---------------------------------------------------------------------------

import { spawnOpencodePlugin, type SpawnFn } from "./spawn";
import { purgeDirectory, resolveCachePaths } from "./cache";
import type { CliFs } from "./config";

export interface UpdateOptions {
  /** Plan the change and print it without writing. */
  dryRun?: boolean;
  /** Override the latest version (for testing). */
  latestVersion?: string;
  /** Injected spawn function for tests. */
  spawn?: SpawnFn;
}

export interface UpdateResult {
  /** Outcome of the update — always 'stale' when update ran (even dry-run). */
  status: "stale" | "noop";
  /** Cache paths that were (or would be) purged. */
  cachePaths: string[];
  /** Instruction string — empty (replaced by spawn). */
  instruction: string;
}

/**
 * Purge all resolved cache directories and re-register the plugin via
 * `opencode plugin opencode-agent-skills-md --global --force`.
 *
 * This is unconditional — no staleness check, no version comparison.
 * The user's cache is always wiped and the plugin is re-registered.
 */
export const runUpdate = async (
  fs: CliFs,
  env: NodeJS.ProcessEnv,
  log: (s: string) => void,
  _error: (s: string) => void,
  opts: UpdateOptions = {},
): Promise<UpdateResult> => {
  const cachePaths = resolveCachePaths(env, fs);
  const instruction = "opencode plugin opencode-agent-skills-md --global --force";

  if (opts.dryRun) {
    log(`oaskills: update check (dry-run)`);
    log(`  would purge: ${cachePaths.join(", ") || "(none found)"}`);
    log(`  would spawn: ${instruction}`);
    return { status: "stale", cachePaths, instruction };
  }

  // Purge each matching cache directory. Best-effort per path.
  for (const cachePath of cachePaths) {
    try {
      if (fs.existsSync(cachePath)) {
        purgeDirectory(fs, cachePath);
        log(`oaskills: purged cache ${cachePath}`);
      }
    } catch {
      // ignore individual purge failures — best-effort
    }
  }

  log(
    `oaskills: re-registering opencode-agent-skills-md`,
  );

  // Re-register via OpenCode's CLI. Failure here is fatal — surface it.
  const spawnOpts = opts.spawn
    ? { spawn: opts.spawn }
    : {};
  const result = await spawnOpencodePlugin(
    ["opencode-agent-skills-md", "--global", "--force"],
    spawnOpts,
  );

  if ((result.status ?? 0) !== 0) {
    throw new Error(
      `opencode plugin opencode-agent-skills-md --global --force exited with status ${String(result.status)}`,
    );
  }

  return { status: "stale", cachePaths, instruction: "" };
};
