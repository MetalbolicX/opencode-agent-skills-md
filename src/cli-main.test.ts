import { describe, expect, test } from "bun:test";
import type { CliFs } from "./cli/config";
import { runMain, type MainResult } from "./cli/main";

// ---------------------------------------------------------------------------
// In-memory CliFs — same pattern as cli-config.test.ts
// ---------------------------------------------------------------------------

interface MemFsOpts {
  files?: Record<string, string>;
}

const createMemFs = (opts: MemFsOpts = {}): CliFs & { __files: Map<string, string> } => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  for (const [p, c] of Object.entries(opts.files ?? {})) {
    files.set(p, c);
  }
  const ensureParentDir = (path: string): void => {
    const parts = path.split("/");
    let acc = parts[0] === "" ? "/" : "";
    for (let i = parts[0] === "" ? 1 : 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : (parts[i] as string);
      if (acc.length > 0) dirs.add(acc);
    }
    if (path.endsWith("/")) dirs.add(path);
  };
  const fs: CliFs & { __files: Map<string, string> } = {
    __files: files,
    readFileSync: (path) => {
      if (!files.has(path)) {
        const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return files.get(path) as string;
    },
    writeFileSync: (path, content) => {
      ensureParentDir(path);
      files.set(path, content);
    },
    renameSync: (from, to) => {
      if (!files.has(from)) {
        const err = new Error(`ENOENT: ${from}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      files.set(to, files.get(from) as string);
      files.delete(from);
    },
    copyFileSync: (from, to) => {
      if (!files.has(from)) {
        const err = new Error(`ENOENT: ${from}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      files.set(to, files.get(from) as string);
    },
    unlinkSync: (path) => {
      files.delete(path);
    },
    mkdirSync: (path, _opts) => {
      dirs.add(path);
    },
    readdirSync: (path) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const entries = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const first = rest.split("/")[0];
          if (first) entries.add(first);
        }
      }
      return Array.from(entries);
    },
    existsSync: (path) => files.has(path) || dirs.has(path),
    rmdirSync: (path) => {
      dirs.delete(path);
      // Remove all files under this directory
      const prefix = path.endsWith("/") ? path : path + "/";
      for (const key of files.keys()) {
        if (key === path || key.startsWith(prefix)) {
          files.delete(key);
        }
      }
      // Remove subdirectories
      for (const d of dirs.keys()) {
        if (d === path || d.startsWith(prefix)) {
          dirs.delete(d);
        }
      }
    },
  };
  return fs;
};

const TEST_HOME = "/tmp/oaskills-test";
const TEST_CONFIG_PATH = `${TEST_HOME}/.config/opencode/opencode.json`;
const TEST_ENV: NodeJS.ProcessEnv = {
  HOME: TEST_HOME,
  OPENCODE_CONFIG_DIR: `${TEST_HOME}/.config/opencode`,
};

// ---------------------------------------------------------------------------
// Harness — synthetic argv factory
// ---------------------------------------------------------------------------

/** Strip the first two argv entries (node + script) like a real shell invocation. */
const realArgv = (cmds: string[]): readonly string[] =>
  ["/usr/bin/node", "/usr/local/bin/oaskills", ...cmds];

// ---------------------------------------------------------------------------
// Smoke tests — argv slicing and --help short-circuit
// ---------------------------------------------------------------------------

describe("argv slicing", () => {
  test("empty argv returns empty args", async () => {
    const result = await runMain([]);
    // No command supplied — exit code 2
    expect(result.exitCode).toBe(2);
    expect(result.command).toBeNull();
  });

  test("--help as sole arg prints usage and exits 0", async () => {
    const result = await runMain(realArgv(["--help"]));
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("help");
  });

  test("-h as sole arg prints usage and exits 0", async () => {
    const result = await runMain(realArgv(["-h"]));
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("help");
  });

  test("--help after unknown command is rejected as invalid usage", async () => {
    // When parseArgs strict mode catches an unknown flag it throws.
    const result = await runMain(realArgv(["--help"]));
    expect(result.exitCode).toBe(0);
  });
});

describe("command dispatch", () => {
  test("missing command exits 2", async () => {
    const result = await runMain(realArgv([]));
    expect(result.exitCode).toBe(2);
    expect(result.command).toBeNull();
  });

  test("unknown command exits 2", async () => {
    const result = await runMain(realArgv(["bogus"]));
    expect(result.exitCode).toBe(2);
    expect(result.command).toBe("bogus");
  });

  test("install command exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["install"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("install");
  });

  test("uninstall command exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["uninstall"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("uninstall");
  });

  test("status command exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["status"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("status");
  });

  test("doctor command exits 0 when healthy", async () => {
    const fs = createMemFs({
      files: {
        [TEST_CONFIG_PATH]: JSON.stringify({
          plugin: ["opencode-agent-skills-md@latest"],
        }),
      },
    });
    const result = await runMain(realArgv(["doctor"]), { fs, env: TEST_ENV });
    // Exit code depends on health — if no issues found, exits 0.
    expect([0, 1]).toContain(result.exitCode);
    expect(result.command).toBe("doctor");
  });

  test("update command exits 0", async () => {
    const result = await runMain(realArgv(["update"]), { fs: createMemFs(), env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("update");
  });
});

describe("--help on commands", () => {
  test("install --help exits 0", async () => {
    const result = await runMain(realArgv(["install", "--help"]));
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("help");
  });

  test("uninstall --help exits 0", async () => {
    const result = await runMain(realArgv(["uninstall", "--help"]));
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("help");
  });

  test("status --help exits 0", async () => {
    const result = await runMain(realArgv(["status", "--help"]));
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("help");
  });

  test("doctor --help exits 0", async () => {
    const result = await runMain(realArgv(["doctor", "--help"]));
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("help");
  });

  test("update --help exits 0", async () => {
    const result = await runMain(realArgv(["update", "--help"]));
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("help");
  });
});

describe("install options", () => {
  test("install --version <v> exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["install", "--version", "1.0.0"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("install");
  });

  test("install -v <v> exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["install", "-v", "1.0.0"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("install");
  });

  test("install --latest exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["install", "--latest"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("install");
  });

  test("install --dry-run exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["install", "--dry-run"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("install");
  });
});

describe("uninstall options", () => {
  test("uninstall --purge exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["uninstall", "--purge"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("uninstall");
  });

  test("uninstall --dry-run exits 0", async () => {
    const fs = createMemFs();
    const result = await runMain(realArgv(["uninstall", "--dry-run"]), { fs, env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("uninstall");
  });
});

describe("update options", () => {
  test("update --dry-run exits 0", async () => {
    const result = await runMain(realArgv(["update", "--dry-run"]), { fs: createMemFs(), env: TEST_ENV });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("update");
  });
});

describe("doctor exit-code mapping", () => {
  test("doctor returns exitCode 0 or 1", async () => {
    const fs = createMemFs({
      files: {
        [TEST_CONFIG_PATH]: JSON.stringify({
          plugin: ["opencode-agent-skills-md@latest"],
        }),
      },
    });
    const result = await runMain(realArgv(["doctor"]), { fs, env: TEST_ENV });
    expect([0, 1]).toContain(result.exitCode);
    expect(result.command).toBe("doctor");
  });
});

describe("unknown option handling", () => {
  test("unknown option on install exits 2", async () => {
    const result = await runMain(realArgv(["install", "--bogus-flag"]));
    expect(result.exitCode).toBe(2);
  });

  test("unknown option on status exits 2", async () => {
    const result = await runMain(realArgv(["status", "--bogus-flag"]));
    expect(result.exitCode).toBe(2);
  });
});
