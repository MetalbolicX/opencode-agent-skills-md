// ---------------------------------------------------------------------------
// src/cli/spawn.ts — thin wrapper around `opencode plugin`.
//
// Why a wrapper? Two reasons:
//   1. OpenCode owns the schema for `data['plugin']` (singular) and the cache
//      layout under ~/.cache/opencode/packages/. Re-implementing that logic
//      is drift-prone (the bug we are fixing). Delegating to OpenCode's own CLI
//      keeps us correct by construction.
//   2. Tests need a deterministic, non-blocking seam. Defaulting to
//      spawnSync with `stdio: 'inherit'` lets the real CLI talk directly to
//      the user's terminal; tests inject a stub that returns canned output.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  env: NodeJS.ProcessEnv;
  stdio?: "pipe" | "inherit";
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnResult;

export interface SpawnOpencodePluginOptions {
  /** Injected spawn function for tests. Defaults to node:child_process.spawnSync. */
  spawn?: SpawnFn;
  /** Environment variables passed to the child process. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** stdio mode for the child process. 'inherit' forwards output to the parent. */
  stdio?: "pipe" | "inherit";
}

/**
 * Run `opencode plugin <args...>` and return the exit status plus captured
 * stdout/stderr (only populated when `stdio: 'pipe'`).
 *
 * The default implementation uses spawnSync so the call blocks until the
 * child process exits. This keeps the CLI simple — the user's shell
 * stays put until registration completes, then returns control with a
 * non-zero status on failure.
 */
export async function spawnOpencodePlugin(
  args: string[],
  opts: SpawnOpencodePluginOptions = {},
): Promise<SpawnResult> {
  const env = opts.env ?? process.env;
  const stdio = opts.stdio ?? "inherit";
  const spawnFn = opts.spawn ?? defaultSpawn;
  try {
    return spawnFn("opencode", ["plugin", ...args], { env, stdio });
  } catch (err) {
    // Spawn failure (command not found, permission denied, etc.) — return safe result
    return {
      status: null,
      stdout: "",
      stderr: (err as Error).message,
    };
  }
}

/**
 * Default spawn implementation backed by node:child_process.spawnSync.
 *
 * The require is loaded lazily so test doubles can replace the spawn
 * function entirely without ever touching node:child_process.
 */
function defaultSpawn(
  command: string,
  args: string[],
  options: SpawnOptions,
): SpawnResult {
  const cp = require("node:child_process") as typeof import("node:child_process");
  try {
    const result = cp.spawnSync(command, args, {
      env: options.env,
      stdio: options.stdio,
    });
    return {
      status: result.status,
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
    };
  } catch (err) {
    // Spawn failed (e.g., command not found) — return null status safely
    return {
      status: null,
      stdout: "",
      stderr: (err as Error).message,
    };
  }
}
