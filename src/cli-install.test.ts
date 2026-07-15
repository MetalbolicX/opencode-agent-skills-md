import { describe, expect, test } from "bun:test";
import { runInstall, type InstallOptions, type InstallResult } from "./cli/install";
import type { CliFs } from "./cli/config";

// ---------------------------------------------------------------------------
// In-memory CliFs factory (same pattern as cli-config.test.ts)
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

const runInstallSync = (
  opts: InstallOptions,
  fs: CliFs & { store: MemStore },
): InstallResult => {
  return runInstall(opts, fs, TEST_ENV);
};

// ---------------------------------------------------------------------------
// Fresh install (no config file exists)
// ---------------------------------------------------------------------------

describe("fresh install", () => {
  test("creates config file with plugin entry when no config exists", () => {
    const fs = createMemFs();
    const result = runInstallSync({}, fs);

    expect(result.status).toBe("wrote");
    expect(result.specifier).toBe("opencode-agent-skills-md@latest");
    expect(result.backup).toBeNull();
    const written = fs.store[CONFIG_PATH];
    expect(written).toBeDefined();
    const parsed = JSON.parse(written);
    expect(parsed.plugin).toEqual(["opencode-agent-skills-md@latest"]);
  });

  test("fresh install with explicit version pin", () => {
    const fs = createMemFs();
    const result = runInstallSync({ version: "1.2.3" }, fs);

    expect(result.status).toBe("wrote");
    expect(result.specifier).toBe("opencode-agent-skills-md@1.2.3");
    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    expect(parsed.plugin).toEqual(["opencode-agent-skills-md@1.2.3"]);
  });

  test("fresh install creates parent directory recursively", () => {
    const fs = createMemFs();
    const result = runInstallSync({}, fs);

    expect(result.status).toBe("wrote");
    expect(fs.store[CONFIG_PATH]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Dedupe / no-op behavior
// ---------------------------------------------------------------------------

describe("dedupe and no-op", () => {
  test("installing same specifier is a no-op (wrote but unchanged)", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@latest"] });

    const result = runInstallSync({}, fs);

    expect(result.status).toBe("noop");
    expect(result.specifier).toBe("opencode-agent-skills-md@latest");
    expect(result.backup).toBeNull();
    // Config file should be unchanged
    expect(JSON.parse(fs.store[CONFIG_PATH]).plugin).toEqual(["opencode-agent-skills-md@latest"]);
  });

  test("installing different version replaces existing entry", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@1.0.0"] });

    const result = runInstallSync({ version: "2.0.0" }, fs);

    expect(result.status).toBe("wrote");
    expect(result.specifier).toBe("opencode-agent-skills-md@2.0.0");
    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    expect(parsed.plugin).toEqual(["opencode-agent-skills-md@2.0.0"]);
  });

  test("install removes other plugin entries then appends specifier", () => {
    const fs = createMemFs();
    configFile(fs.store, {
      plugin: [
        "some-other-plugin",
        "opencode-agent-skills-md@1.0.0",
        "another-plugin",
      ],
    });

    const result = runInstallSync({}, fs);

    expect(result.status).toBe("wrote");
    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    // non-plugin entries preserved, old plugin entry replaced
    expect(parsed.plugin).toContain("some-other-plugin");
    expect(parsed.plugin).toContain("another-plugin");
    expect(parsed.plugin).toContain("opencode-agent-skills-md@latest");
  });

  test("handles legacy object-form plugin entry", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: { "opencode-agent-skills-md": true } });

    const result = runInstallSync({}, fs);

    expect(result.status).toBe("wrote");
    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    expect(parsed.plugin).toEqual(["opencode-agent-skills-md@latest"]);
  });
});

// ---------------------------------------------------------------------------
// --dry-run
// ---------------------------------------------------------------------------

describe("dry-run", () => {
  test("dry-run does not write config file", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: [] });

    const result = runInstallSync({ dryRun: true }, fs);

    expect(result.status).toBe("planned");
    expect(result.backup).toBeNull();
    expect(fs.store[CONFIG_PATH]).toBe(JSON.stringify({ plugin: [] }));
  });

  test("dry-run reports what would be written", () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["some-plugin"] });

    const result = runInstallSync({ dryRun: true }, fs);

    expect(result.status).toBe("planned");
    expect(result.specifier).toBe("opencode-agent-skills-md@latest");
    // Original file unchanged
    expect(JSON.parse(fs.store[CONFIG_PATH]).plugin).toEqual(["some-plugin"]);
  });
});

// ---------------------------------------------------------------------------
// Malformed-config abort
// ---------------------------------------------------------------------------

describe("malformed config", () => {
  test("throws on malformed JSON (not valid JSON at all)", () => {
    const fs = createMemFs();
    fs.store[CONFIG_PATH] = "{ this is not json }";

    expect(() => runInstallSync({}, fs)).toThrow("malformed JSON");
  });

  test("throws on malformed JSON (root is array)", () => {
    const fs = createMemFs();
    fs.store[CONFIG_PATH] = '["not an object"]';

    expect(() => runInstallSync({}, fs)).toThrow("malformed JSON");
  });
});

// ---------------------------------------------------------------------------
// Idempotent mutation rules
// ---------------------------------------------------------------------------

describe("idempotent mutation", () => {
  test("double install produces same result as single install", () => {
    const fs1 = createMemFs();
    runInstallSync({}, fs1);
    const fs2 = createMemFs();
    runInstallSync({}, fs2);

    expect(fs1.store[CONFIG_PATH]).toBe(fs2.store[CONFIG_PATH]);
  });

  test("install preserves other top-level config fields", () => {
    const fs = createMemFs();
    configFile(fs.store, { someField: "preserved", anotherField: 42 });

    runInstallSync({}, fs);

    const parsed = JSON.parse(fs.store[CONFIG_PATH]);
    expect(parsed.someField).toBe("preserved");
    expect(parsed.anotherField).toBe(42);
  });
});
