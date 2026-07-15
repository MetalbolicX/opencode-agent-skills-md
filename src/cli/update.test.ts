import { describe, expect, test } from "bun:test";
import type { CliFs } from "./config";
import type { SpawnResult, SpawnFn } from "./spawn";
import { runUpdate } from "./update";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

type SpawnCall = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdio: "pipe" | "inherit";
};

const createFakeSpawn = (results: SpawnResult[]): {
  spawnFn: SpawnFn;
  calls: SpawnCall[];
} => {
  const calls: SpawnCall[] = [];
  let callIndex = 0;
  const spawnFn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, env: options.env, stdio: options.stdio });
    return results[callIndex++] ?? { status: 0, stdout: "", stderr: "" };
  };
  return { spawnFn, calls };
};

type MemStore = Record<string, string>;

const createMemFs = (initial: MemStore = {}): CliFs & { store: MemStore } => {
  const store: MemStore = { ...initial };
  return {
    store,
    readFileSync: (path: string) => {
      const v = store[path];
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    writeFileSync: (path: string, content: string) => {
      store[path] = content;
    },
    renameSync: (from: string, to: string) => {
      if (store[from] === undefined) throw new Error(`ENOENT: ${from}`);
      store[to] = store[from];
      delete store[from];
    },
    copyFileSync: (from: string, to: string) => {
      const v = store[from];
      if (v === undefined) throw new Error(`ENOENT: ${from}`);
      store[to] = v;
    },
    unlinkSync: (path: string) => {
      if (store[path] === undefined) throw new Error(`ENOENT: ${path}`);
      delete store[path];
    },
    mkdirSync: (_path: string, _opts?: { recursive?: boolean }) => {
      // no-op
    },
    readdirSync: (path: string) => {
      // ENOENT when the path is a file (not a directory)
      if (store[path] !== undefined) {
        throw new Error(`ENOENT: not a directory '${path}'`);
      }
      const dir = path.endsWith("/") ? path : path + "/";
      const entries = Object.keys(store).filter((k) => k.startsWith(dir) && k !== dir);
      // ENOENT when the directory does not exist (no entries at or under this path)
      if (entries.length === 0) {
        const hasAny = Object.keys(store).some((k) => k.startsWith(dir));
        if (!hasAny) throw new Error(`ENOENT: no such directory '${path}'`);
        return [];
      }
      return [...new Set(entries.map((k) => k.slice(dir.length).split("/")[0]!))];
    },
    existsSync: (path: string) => {
      if (store[path] !== undefined) return true;
      // Directory exists if it has any child entries in the store
      const dir = path.endsWith("/") ? path : path + "/";
      return Object.keys(store).some((k) => k.startsWith(dir));
    },
    rmdirSync: (path: string) => {
      const dir = path.endsWith("/") ? path : path + "/";
      for (const k of Object.keys(store)) {
        if (k === path || k.startsWith(dir)) {
          delete store[k];
        }
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

const TEST_ENV = {
  HOME: "/home/user",
  OPENCODE_CONFIG_DIR: "/home/user/.config/opencode",
};

// ---------------------------------------------------------------------------
// Tests — runUpdate purges all caches and spawns force-install unconditionally
// ---------------------------------------------------------------------------

describe("runUpdate", () => {
  test("purges all resolved cache paths even when version is current", async () => {
    const fs = createMemFs();
    // Set up cache directories in memfs (files under the cache dir paths)
    fs.store["/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json"] =
      '{"name":"opencode-agent-skills-md","version":"1.0.0"}';
    fs.store["/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest/package.json"] =
      '{"name":"opencode-agent-skills-md","version":"1.0.0"}';

    const { spawnFn } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    const logs: string[] = [];
    const logFn = (s: string) => logs.push(s);

    const result = await runUpdate(
      fs,
      TEST_ENV,
      logFn,
      () => {},
      { spawn: spawnFn, latestVersion: "1.0.0" },
    );

    // Cache dirs must be removed
    expect(
      fs.store["/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json"],
    ).toBeUndefined();
    expect(
      fs.store["/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest/package.json"],
    ).toBeUndefined();
    // Status must be "stale" (always triggers reinstall)
    expect(result.status).toBe("stale");
  });

  test("purges all resolved cache paths even when version is missing", async () => {
    const fs = createMemFs();
    // No cache directories exist — purge is a no-op, but spawn still runs
    const { spawnFn } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    const logs: string[] = [];
    const logFn = (s: string) => logs.push(s);

    const result = await runUpdate(
      fs,
      TEST_ENV,
      logFn,
      () => {},
      { spawn: spawnFn, latestVersion: "1.0.0" },
    );

    // No caches to purge (didn't exist), but result is stale (spawn happened)
    expect(result.status).toBe("stale");
  });

  test("purges cache even when deletion fails (best-effort)", async () => {
    const { spawnFn } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    const logs: string[] = [];
    const logFn = (s: string) => logs.push(s);

    // Use a memfs where rmdirSync throws
    const fs = createMemFs();
    fs.store["/home/user/.cache/opencode/packages/opencode-agent-skills-md/file.txt"] = "content";
    // Override rmdirSync to throw — purge fails but update still proceeds
    fs.rmdirSync = (_path: string) => {
      throw new Error("EBUSY: directory not empty");
    };

    // Must not throw — purge is best-effort
    const result = await runUpdate(
      fs,
      TEST_ENV,
      logFn,
      () => {},
      { spawn: spawnFn, latestVersion: "2.0.0" },
    );

    // Update still proceeds despite purge failure
    expect(result.status).toBe("stale");
  });

  test("spawns opencode plugin --global --force after purge regardless of version state", async () => {
    const fs = createMemFs();
    const { spawnFn, calls } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    const logs: string[] = [];
    const logFn = (s: string) => logs.push(s);

    await runUpdate(
      fs,
      TEST_ENV,
      logFn,
      () => {},
      { spawn: spawnFn, latestVersion: "1.0.0" },
    );

    // Must have called spawn with correct args
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("opencode");
    expect(calls[0]!.args).toEqual([
      "plugin",
      "opencode-agent-skills-md",
      "--global",
      "--force",
    ]);
  });

  test("throws when spawn returns non-zero exit code", async () => {
    const fs = createMemFs();
    const { spawnFn } = createFakeSpawn([{ status: 1, stdout: "", stderr: "plugin not found" }]);
    const logs: string[] = [];
    const logFn = (s: string) => logs.push(s);

    expect(
      runUpdate(fs, TEST_ENV, logFn, () => {}, { spawn: spawnFn, latestVersion: "1.0.0" }),
    ).rejects.toThrow();
  });

  test("returns cachePaths covering both bare and @version variants", async () => {
    const fs = createMemFs();
    const { spawnFn } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    const logs: string[] = [];
    const logFn = (s: string) => logs.push(s);

    const result = await runUpdate(
      fs,
      TEST_ENV,
      logFn,
      () => {},
      { spawn: spawnFn, latestVersion: "1.0.0" },
    );

    // Both cache path variants should be tracked
    expect(result.cachePaths).toContain(
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md",
    );
    expect(result.cachePaths).toContain(
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest",
    );
  });
});
