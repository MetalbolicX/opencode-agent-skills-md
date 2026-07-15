import { describe, expect, test } from "bun:test";
import { runUninstall, type UninstallOptions, type UninstallResult } from "./cli/uninstall";
import type { CliFs } from "./cli/config";

// ---------------------------------------------------------------------------
// In-memory CliFs factory (same pattern)
// ---------------------------------------------------------------------------

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
      // no-op for in-memory fs
    },
    readdirSync: (path: string) => {
      const dir = path.endsWith("/") ? path : path + "/";
      return Object.keys(store)
        .filter((k) => k.startsWith(dir) && k !== dir)
        .map((k) => k.slice(dir.length).split("/")[0]!);
    },
    existsSync: (path: string) => store[path] !== undefined,
  };
};

// ---------------------------------------------------------------------------
// Test environment — set OPENCODE_CONFIG_DIR so config path resolves
// within the memfs rather than falling back to the real home directory.
// ---------------------------------------------------------------------------

const TEST_ENV = {
  HOME: "/home/user",
  OPENCODE_CONFIG_DIR: "/home/user/.config/opencode",
};

const CONFIG_DIR = "/home/user/.config/opencode";
const CONFIG_PATH = `${CONFIG_DIR}/opencode.json`;

const configFile = (store: MemStore, content: object) => {
  store[CONFIG_PATH] = JSON.stringify(content);
};

const runUninstallSync = (
  opts: UninstallOptions,
  fs: CliFs & { store: MemStore },
): UninstallResult => {
  return runUninstall(opts, fs, TEST_ENV);
};

// ---------------------------------------------------------------------------
// Basic removal
// ---------------------------------------------------------------------------

describe("removal", () => {
  test("removes plugin entry from config", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@latest"] });

    const result = runUninstallSync({}, fs);

    expect(result.status).toBe("wrote");
    expect(result.removed).toEqual(["opencode-agent-skills-md@latest"]);
    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    expect(parsed.plugin).toBeUndefined();
  });

  test("removes plugin entry and preserves other plugins", () => {
    const fs = createMemFs();
    configFile(fs.store, {
      plugin: ["opencode-agent-skills-md@1.0.0", "some-other-plugin"],
    });

    const result = runUninstallSync({}, fs);

    expect(result.status).toBe("wrote");
    expect(result.removed).toEqual(["opencode-agent-skills-md@1.0.0"]);
    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    expect(parsed.plugin).toEqual(["some-other-plugin"]);
  });

  test("removes only plugin entries, leaves other config fields", () => {
    const fs = createMemFs();
    configFile(fs.store, {
      someField: "preserved",
      plugin: ["opencode-agent-skills-md@latest"],
    });

    const result = runUninstallSync({}, fs);

    expect(result.status).toBe("wrote");
    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    expect(parsed.someField).toBe("preserved");
    expect(parsed.plugin).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// --purge (cache only — no plugin config dir for this plugin)
// ---------------------------------------------------------------------------

describe("purge", () => {
  test("purge flag is accepted but does not fail when cache dir is absent", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@latest"] });

    const result = runUninstallSync({ purge: true }, fs);

    expect(result.status).toBe("wrote");
    // cache dir was not in memfs so purge is a no-op for memfs
    expect(result.removed).toEqual(["opencode-agent-skills-md@latest"]);
  });

  test("purge dry-run shows planned purge targets", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@latest"] });

    const result = runUninstallSync({ purge: true, dryRun: true }, fs);

    expect(result.status).toBe("planned");
    expect(result.purged).toContain(`/home/user/.cache/opencode/node_modules/opencode-agent-skills-md`);
    expect(result.removed).toEqual(["opencode-agent-skills-md@latest"]);
    // Config not actually written
    expect(JSON.parse(fs.store[CONFIG_PATH]).plugin).toEqual(["opencode-agent-skills-md@latest"]);
  });
});

// ---------------------------------------------------------------------------
// No-op uninstall
// ---------------------------------------------------------------------------

describe("no-op uninstall", () => {
  test("returns noop when plugin not in config", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["some-other-plugin"] });

    const result = runUninstallSync({}, fs);

    expect(result.status).toBe("noop");
    expect(result.removed).toEqual([]);
    expect(result.purged).toEqual([]);
  });

  test("returns noop when config has no plugin field at all", () => {
    const fs = createMemFs();
    configFile(fs.store, {});

    const result = runUninstallSync({}, fs);

    expect(result.status).toBe("noop");
    expect(result.removed).toEqual([]);
  });

  test("returns noop when config file does not exist", () => {
    const fs = createMemFs();

    const result = runUninstallSync({}, fs);

    expect(result.status).toBe("noop");
    expect(result.removed).toEqual([]);
    expect(result.purged).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Malformed-config safety
// ---------------------------------------------------------------------------

describe("malformed config safety", () => {
  test("throws on malformed JSON (not valid JSON at all)", () => {
    const fs = createMemFs();
    fs.store[CONFIG_PATH] = "{ this is not json }";

    expect(() => runUninstallSync({}, fs)).toThrow("malformed JSON");
  });

  test("throws on malformed JSON (root is array)", () => {
    const fs = createMemFs();
    fs.store[CONFIG_PATH] = '["not an object"]';

    expect(() => runUninstallSync({}, fs)).toThrow("malformed JSON");
  });

  test("throws with config path in error message", () => {
    const fs = createMemFs();
    fs.store[CONFIG_PATH] = "{ broken";

    try {
      runUninstallSync({}, fs);
      expect.unreachable();
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).toContain(CONFIG_PATH);
    }
  });
});

// ---------------------------------------------------------------------------
// Dry-run behavior
// ---------------------------------------------------------------------------

describe("dry-run uninstall", () => {
  test("dry-run does not write config", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@latest"] });

    const result = runUninstallSync({ dryRun: true }, fs);

    expect(result.status).toBe("planned");
    // Config unchanged
    expect(JSON.parse(fs.store[CONFIG_PATH]).plugin).toEqual(["opencode-agent-skills-md@latest"]);
  });

  test("dry-run reports removed entries without actually removing", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@1.0.0", "other-plugin"] });

    const result = runUninstallSync({ dryRun: true }, fs);

    expect(result.status).toBe("planned");
    expect(result.removed).toEqual(["opencode-agent-skills-md@1.0.0"]);
    // Still present
    expect(JSON.parse(fs.store[CONFIG_PATH]).plugin).toContain("opencode-agent-skills-md@1.0.0");
  });
});
