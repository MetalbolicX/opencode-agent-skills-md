// ---------------------------------------------------------------------------
// src/cli/main.ts — `oaskills` CLI entry point.
//
// Parses argv with `node:util.parseArgs` and dispatches to install,
// uninstall, status, doctor, or update. Exit codes follow the standard CLI
// convention:
//
//   0 — success (including idempotent no-ops)
//   1 — operational / health failure
//   2 — invalid usage (unknown command, missing required arg, etc.)
//
// When the file is built (bun build, PR 3), the shebang stays in place via
// banner prepending so `dist/cli.mjs` is directly executable as `oaskills`.
// During dev, `bun run src/cli/main.ts ...` works the same way.
// ---------------------------------------------------------------------------

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { CliFs } from "./config";
import { createRealFs } from "./real-fs";
import { runInstall } from "./install";
import { runDoctor, runStatus } from "./status";
import { runUninstall } from "./uninstall";
import { runUpdate } from "./update";

const USAGE = `Usage: oaskills <command> [options]

Commands:
  install     Register the plugin in the global OpenCode config
  uninstall   Remove the plugin from the global OpenCode config
  status      Show current installation status
  doctor      Run health checks against the global config
  update      Check for updates and purge stale cache

Options (install):
  -v, --version <v>  Install a specific version (default: latest)
      --latest       Alias for --version latest
      --dry-run      Print the planned change without writing
      --yes          Skip confirmation prompts (reserved)

Options (uninstall):
      --purge        Also remove the Bun/npm runtime cache
      --dry-run      Print the planned change without writing
      --yes          Skip confirmation prompts (reserved)

Options (update):
      --dry-run      Print the planned purge without writing

Options (all):
  -h, --help    Show this help and exit
`;

const printUsage = (): void => {
  console.log(USAGE);
};

const setExit = (code: 0 | 1 | 2): void => {
  process.exitCode = code;
};

interface ParsedArgs {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

const parseCliArgs = (argv: readonly string[]): ParsedArgs => {
  // parseArgs with `strict: true` (the default) rejects unknown options
  // with a clean error message — we surface that as exit code 2.
  const parsed = parseArgs({
    args: argv as string[],
    allowPositionals: true,
    strict: true,
    options: {
      version: { type: "string", short: "v" },
      latest: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      "dry-run": { type: "boolean" },
      purge: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  return {
    values: parsed.values as Record<string, string | boolean | undefined>,
    positionals: parsed.positionals,
  };
};

/**
 * Strip Node + script argv entries when the entry point is invoked via
 * the shell (shebang) or via `node ./dist/cli.mjs`. When called from a
 * test harness with synthetic args, no stripping happens.
 */
const sliceProcessArgv = (argv: readonly string[]): readonly string[] => {
  if (argv.length < 2) return argv;
  const first = argv[0] ?? "";
  if (first.endsWith("node") || first.endsWith("node.exe")) {
    return argv.slice(2);
  }
  return argv;
};

export interface MainResult {
  command: string | null;
  exitCode: 0 | 1 | 2;
}

/**
 * Pure(ish) dispatcher: takes argv, runs the matching command, sets
 * `process.exitCode`, and returns a structured result so tests can assert
 * without reading the exit code.
 *
 * `opts.fs` and `opts.env` are forwarded to every command so tests can
 * inject an in-memory `CliFs` and a fake env instead of hitting the
 * real filesystem and process environment.
 */
export interface MainOptions {
  fs?: CliFs;
  env?: NodeJS.ProcessEnv;
}

export const runMain = async (
  argv: readonly string[] = process.argv,
  opts: MainOptions = {},
): Promise<MainResult> => {
  const fs = opts.fs ?? createRealFs();
  const env = opts.env ?? process.env;
  const args = sliceProcessArgv(argv);

  // Short-circuit `--help` / `-h` before `parseArgs` so the user can ask
  // for help without supplying a command.
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    printUsage();
    return { command: "help", exitCode: 0 };
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseCliArgs(args);
  } catch (err) {
    console.error(`oaskills: ${(err as Error).message}`);
    setExit(2);
    return { command: null, exitCode: 2 };
  }

  if (parsed.values.help) {
    printUsage();
    return { command: "help", exitCode: 0 };
  }

  const command = parsed.positionals[0];

  if (!command) {
    console.error("oaskills: missing command. Run `oaskills --help` for usage.");
    setExit(2);
    return { command: null, exitCode: 2 };
  }

  try {
    switch (command) {
      case "install": {
        const versionRaw = parsed.values.version;
        const version =
          parsed.values.latest === true
            ? "latest"
            : typeof versionRaw === "string"
              ? versionRaw
              : undefined;
        runInstall(
          {
            version,
            dryRun: parsed.values["dry-run"] === true,
            yes: parsed.values.yes === true,
          },
          fs,
          env,
        );
        return { command, exitCode: 0 };
      }
      case "uninstall": {
        runUninstall(
          {
            purge: parsed.values.purge === true,
            dryRun: parsed.values["dry-run"] === true,
            yes: parsed.values.yes === true,
          },
          fs,
          env,
        );
        return { command, exitCode: 0 };
      }
      case "status": {
        await runStatus(fs, env);
        return { command, exitCode: 0 };
      }
      case "doctor": {
        const result = await runDoctor(fs, env);
        if (!result.ok) setExit(1);
        return { command, exitCode: result.ok ? 0 : 1 };
      }
      case "update": {
        await runUpdate({ dryRun: parsed.values["dry-run"] === true });
        return { command, exitCode: 0 };
      }
      default:
        console.error(`oaskills: unknown command '${command}'. Run \`oaskills --help\` for usage.`);
        setExit(2);
        return { command, exitCode: 2 };
    }
  } catch (err) {
    console.error(`oaskills: ${(err as Error).message}`);
    setExit(1);
    return { command, exitCode: 1 };
  }
};

/**
 * `true` when the file is the program's entry point (shebang / `node
 * cli.mjs`), `false` when it was imported from a test harness. We avoid
 * `import.meta.main` because the package floor is Node 20 and that field
 * only landed in Node 22.
 *
 * Symlink-aware: when the script is invoked through a symlink (e.g. the
 * pnpm global store, where `node_modules/<pkg>` is a symlink into a
 * content-addressable store), `process.argv[1]` carries the symlink path
 * while `import.meta.url` carries the real path after symlink resolution.
 * Comparing the two verbatim would always be `false` under pnpm, causing
 * the CLI to silently exit. We resolve both sides through `realpathSync`
 * before comparing.
 */
const invokedAsMain = ((): boolean => {
  if (!process.argv[1]) return false;
  try {
    const realArgv = pathToFileURL(realpathSync(process.argv[1])).href;
    return import.meta.url === realArgv;
  } catch {
    try {
      return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
      return false;
    }
  }
})();

if (invokedAsMain) {
  runMain(process.argv);
}
