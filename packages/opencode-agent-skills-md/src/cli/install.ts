// ---------------------------------------------------------------------------
// src/cli/install.ts — `oas install` command.
//
// Edits the global OpenCode config so `plugin` contains exactly one
// `opencode-agent-skills-md[@version]` entry. The flow is idempotent:
// existing oas entries are filtered out before the new one is appended,
// and re-running with the same version is a no-op. With `--dry-run` the
// pipeline runs end-to-end but no bytes hit disk.
//
// The function is pure of side effects beyond what it prints and writes
// through `fs`. Tests can inject an in-memory `CliFs` to exercise every
// branch deterministically.
// ---------------------------------------------------------------------------

import {
  backupIfWritable,
  buildSpecifier,
  type CliFs,
  dedupePlugins,
  loadGlobalConfig,
  matchesPlugin,
  normalizePlugin,
  writeAtomically,
} from "./config";
import { createRealFs } from "./real-fs";

export interface InstallOptions {
  /** Optional version pin (e.g. `"1.2.3"`, `"latest"`). Omit for bare specifier. */
  version?: string;
  /** Plan the change and print it without writing. */
  dryRun?: boolean;
  /** Reserved for future confirmation prompts; accepted but unused for now. */
  yes?: boolean;
}

export interface InstallResult {
  /** Outcome of the command. */
  status: "wrote" | "planned" | "noop";
  /** Resolved config path (existing or newly-targeted). */
  path: string;
  /** Specifier that was added (or would be added under `--dry-run`). */
  specifier: string;
  /** Backup path created before the write, or `null` when no backup was needed. */
  backup: string | null;
}

const JSON_INDENT = 2;

/**
 * Run `oas install` against the global OpenCode config.
 *
 * Steps: load → normalize → drop existing oas variants → dedupe surviving
 * entries → append one requested specifier → backup → atomic write. The
 * backup is a timestamped sibling of the config file; rotation to
 * `BACKUP_LIMIT` is handled inside `backupIfWritable`.
 *
 * Idempotency: re-running with the same specifier resolves to a `noop`
 * result without touching disk. A malformed config triggers an error so
 * the user can fix the JSONC instead of silently losing it to an empty
 * overwrite.
 */
export const runInstall = (
  opts: InstallOptions = {},
  fs: CliFs = createRealFs(),
): InstallResult => {
  const specifier = buildSpecifier(opts.version);
  const loaded = loadGlobalConfig(fs);

  if (loaded.parseError) {
    throw new Error(
      `oas: config file is malformed JSON — aborting to avoid data loss.\n` +
        `  path:  ${loaded.path}\n` +
        `  error: ${loaded.parseError}\n` +
        `Fix the JSON error, or delete the file and re-run to create a fresh config.`,
    );
  }

  const config: Record<string, unknown> = { ...loaded.config };
  const existing = normalizePlugin(config.plugin);

  // Compute the post-install plugin list: keep non-oas entries in their
  // original order and append the requested specifier at the end. Comparing
  // against `existing` is the canonical no-op check — if the post-install
  // state equals what we already have, no write is needed.
  const nonOas = existing.filter((entry) => !matchesPlugin(entry));
  const dedupedNonOas = dedupePlugins(nonOas);
  const finalPlugins = [...dedupedNonOas, specifier];
  const isNoop = !opts.dryRun && JSON.stringify(finalPlugins) === JSON.stringify(existing);

  if (isNoop) {
    console.log(`✓ Already installed (${specifier}) at ${loaded.path}`);
    return { status: "noop", path: loaded.path, specifier, backup: null };
  }

  config.plugin = finalPlugins;

  if (opts.dryRun) {
    console.log(`[dry-run] Would write to ${loaded.path}:`);
    console.log(JSON.stringify(config, null, JSON_INDENT));
    return { status: "planned", path: loaded.path, specifier, backup: null };
  }

  const backup = backupIfWritable(loaded.path, fs);
  writeAtomically(loaded.path, JSON.stringify(config, null, JSON_INDENT), fs);

  console.log(`✓ Installed ${specifier}`);
  console.log(`  config: ${loaded.path}`);
  if (backup) console.log(`  backup: ${backup}`);

  return { status: "wrote", path: loaded.path, specifier, backup };
};
