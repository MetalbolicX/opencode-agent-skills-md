// ---------------------------------------------------------------------------
// src/cli/spawn.ts — thin wrapper around `opencode plugin`.
//
// Why a wrapper? Two reasons:
//   1. OpenCode owns the schema for `data['plugin']` (singular) and the cache
//      layout under ~/.cache/opencode/packages/. Re-implementing that logic
//      is drift-prone (the bug we are fixing). Delegating to OpenCode's own CLI
//      keeps us correct by construction.
//   2. Tests need a deterministic, non-blocking seam. Default spawn uses async
//      `spawn` with a hard 30 s kill timer so the CLI never hangs; tests
//      inject a stub that returns canned output.
// ---------------------------------------------------------------------------

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
) => Promise<SpawnResult> | SpawnResult;

export interface SpawnOpencodePluginOptions {
  /** Injected spawn function for tests. Defaults to async spawn with 30 s timeout. */
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
 * The default spawn uses async `spawn` with a 30-second SIGKILL timer so
 * the call never blocks the CLI indefinitely even when the opencode CLI hangs.
 */
export const spawnOpencodePlugin = async (
  args: string[],
  opts: SpawnOpencodePluginOptions = {},
): Promise<SpawnResult> => {
  const env = opts.env ?? process.env;
  const stdio = opts.stdio ?? "inherit";
  const spawnFn = opts.spawn ?? defaultSpawn;

  // Build the args list: ["plugin", ...userArgs]
  const pluginArgs = ["plugin", ...args];

  let result: SpawnResult;
  try {
    result = await Promise.resolve(spawnFn("opencode", pluginArgs, { env, stdio }));
  } catch (err) {
    // Spawn failure (command not found, permission denied, etc.) — return safe result
    result = { status: null, stdout: "", stderr: (err as Error).message };
  }

  return result;
}

/**
 * Default spawn — async `spawn` with a 30-second SIGKILL timer.
 *
 * Uses `spawn` (async) so the Node.js event loop is NOT blocked. A separate
 * kill timer fires after 30 s to ensure the opencode CLI never hangs the
 * CLI indefinitely.
 */
const defaultSpawn = async (
  command: string,
  args: string[],
  options: SpawnOptions,
): Promise<SpawnResult> => {
  const { spawn } = await import("node:child_process");
  const stdio = options.stdio ?? "pipe";

  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    // Hard timeout: SIGKILL after 30 s
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore if already exited */ }
    }, 30_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: err.message });
    });
  });
}
