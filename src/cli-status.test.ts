import { describe, expect, test } from "bun:test";
import { runDoctor, runStatus, type DoctorResult, type StatusResult } from "./cli/status";
import type { CliFs } from "./cli/config";

// ---------------------------------------------------------------------------
// In-memory CliFs factory
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
      // no-op
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

// ---------------------------------------------------------------------------
// runStatus — env var reporting
// ---------------------------------------------------------------------------

describe("runStatus", () => {
  test("returns installed:false when no config file", async () => {
    const fs = createMemFs();
    const result = await runStatus(fs, TEST_ENV);
    expect(result.installed).toBe(false);
    expect(result.path).toBe(CONFIG_PATH);
  });

  test("returns installed:true when plugin is in config", async () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: ["opencode-agent-skills-md@1.0.0"] });
    const result = await runStatus(fs, TEST_ENV);
    expect(result.installed).toBe(true);
    expect(result.specifier).toBe("opencode-agent-skills-md@1.0.0");
  });

  test("reports extras (other plugins) correctly", async () => {
    const fs = createMemFs();
    configFile(fs.store, {
      plugin: ["opencode-agent-skills-md@latest", "some-other-plugin"],
    });
    const result = await runStatus(fs, TEST_ENV);
    expect(result.installed).toBe(true);
    expect(result.extras).toEqual(["some-other-plugin"]);
  });

  test("reports format as jsonc when path ends with .jsonc", async () => {
    const fs = createMemFs();
    fs.store[`${CONFIG_DIR}/opencode.jsonc`] = JSON.stringify({});
    // Override env to use jsonc path
    const jsoncEnv = {
      HOME: "/home/user",
      OPENCODE_CONFIG_DIR: CONFIG_DIR,
    };
    const result = await runStatus(fs, jsoncEnv);
    expect(result.format).toBe("jsonc");
  });

  test("reports format as json when path ends with .json", async () => {
    const fs = createMemFs();
    configFile(fs.store, {});
    const result = await runStatus(fs, TEST_ENV);
    expect(result.format).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// runDoctor — blocking / warning / info
// ---------------------------------------------------------------------------

describe("runDoctor", () => {
  test("DoctorResult has all required fields", async () => {
    const fs = createMemFs();
    configFile(fs.store, {});
    const result = await runDoctor(fs, TEST_ENV);
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.info)).toBe(true);
  });

  test("adds issue when plugin field is not array or object", async () => {
    const fs = createMemFs();
    fs.store[CONFIG_PATH] = JSON.stringify({ plugin: "not an array" });
    const result = await runDoctor(fs, TEST_ENV);
    expect(result.issues.some((i: string) => i.includes("neither array nor object"))).toBe(true);
  });

  test("warns when config does not exist yet", async () => {
    const fs = createMemFs();
    const result = await runDoctor(fs, TEST_ENV);
    expect(result.warnings.some((w: string) => w.includes("does not exist yet") || w.includes("will be created"))).toBe(true);
  });

  test("adds info for config path and format", async () => {
    const fs = createMemFs();
    configFile(fs.store, { plugin: [] });
    const result = await runDoctor(fs, TEST_ENV);
    expect(result.info.some((i: string) => i.includes("Config path"))).toBe(true);
  });

  test("warns when multiple plugin entries present (dedupe advisory)", async () => {
    const fs = createMemFs();
    configFile(fs.store, {
      plugin: ["opencode-agent-skills-md@1.0.0", "opencode-agent-skills-md@2.0.0"],
    });
    const result = await runDoctor(fs, TEST_ENV);
    expect(result.warnings.some((w: string) => w.includes("2 opencode-agent-skills-md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Discovery-root warning (zero roots = warning, not blocking)
// ---------------------------------------------------------------------------

describe("discovery roots check", () => {
  test("warns when zero of the four discovery roots exist", async () => {
    const fs = createMemFs();
    configFile(fs.store, {});
    // No discovery root directories exist in the memfs
    const result = await runDoctor(fs, TEST_ENV);
    // The check is a warning (non-blocking), not an issue
    expect(result.warnings.some((w: string) => w.toLowerCase().includes("discovery") || w.includes("skill") || w.includes("root"))).toBe(true);
  });
});
