import { describe, expect, test } from "bun:test";
import { getCachedPluginVersion } from "./registry";
import type { CliFs } from "./config";

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
      const entries = new Set<string>();
      for (const k of Object.keys(store)) {
        if (!k.startsWith(dir) || k === dir) continue;
        const rest = k.slice(dir.length);
        const first = rest.split("/")[0];
        if (first) entries.add(first);
      }
      return Array.from(entries);
    },
    existsSync: (path: string) => {
      if (store[path] !== undefined) return true;
      const dir = path.endsWith("/") ? path : path + "/";
      for (const k of Object.keys(store)) {
        if (k.startsWith(dir)) return true;
      }
      return false;
    },
    rmdirSync: () => {
      // no-op for this test
    },
  };
};

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

const TEST_ENV = {
  HOME: "/home/user",
};

// ---------------------------------------------------------------------------
// getCachedPluginVersion tests
// ---------------------------------------------------------------------------

describe("getCachedPluginVersion", () => {
  test("returns version from cached package.json when cache exists", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md","version":"2.0.0"}',
    });
    const result = getCachedPluginVersion(fs, TEST_ENV);
    expect(result).toBe("2.0.0");
  });

  test("returns version from @latest cached package.json when bare cache absent", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest/package.json":
        '{"name":"opencode-agent-skills-md","version":"3.0.0"}',
    });
    const result = getCachedPluginVersion(fs, TEST_ENV);
    expect(result).toBe("3.0.0");
  });

  test("returns null when no cache directories exist", () => {
    const fs = createMemFs({});
    const result = getCachedPluginVersion(fs, TEST_ENV);
    expect(result).toBeNull();
  });

  test("returns null when cache dir exists but package.json is missing", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/README.md":
        "readme",
    });
    const result = getCachedPluginVersion(fs, TEST_ENV);
    expect(result).toBeNull();
  });

  test("returns null when package.json is malformed JSON", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        "{ invalid json",
    });
    const result = getCachedPluginVersion(fs, TEST_ENV);
    expect(result).toBeNull();
  });

  test("returns null when package.json has no version field", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md"}',
    });
    const result = getCachedPluginVersion(fs, TEST_ENV);
    expect(result).toBeNull();
  });

  test("returns null when version field is not a string", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md","version":42}',
    });
    const result = getCachedPluginVersion(fs, TEST_ENV);
    expect(result).toBeNull();
  });

  test("prefers bare cache dir over @latest when both exist", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md","version":"1.0.0"}',
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest/package.json":
        '{"name":"opencode-agent-skills-md","version":"2.0.0"}',
    });
    const result = getCachedPluginVersion(fs, TEST_ENV);
    // Bare cache takes precedence
    expect(result).toBe("1.0.0");
  });
});
