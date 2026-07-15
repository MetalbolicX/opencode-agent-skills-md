import { describe, expect, test } from "bun:test";
import { resolveCachePaths, purgeDirectory } from "./cache";
import type { CliFs } from "./config";

// ---------------------------------------------------------------------------
// In-memory CliFs factory for cache path tests
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
      // Check if any entry is under this directory path
      const dir = path.endsWith("/") ? path : path + "/";
      for (const k of Object.keys(store)) {
        if (k.startsWith(dir)) return true;
      }
      return false;
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
// resolveCachePaths tests
// ---------------------------------------------------------------------------

describe("resolveCachePaths", () => {
  test("returns fallback paths when packages dir does not exist (fs provided)", () => {
    const fs = createMemFs({});
    const result = resolveCachePaths(TEST_ENV, fs);
    // When fs is provided but packagesDir doesn't exist (existsSync returns false),
    // the if block is skipped and we fall through to return conventional candidates.
    expect(result).toEqual([
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md",
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest",
    ]);
  });

  test("returns empty array when packages dir has no matching entries", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/some-other-plugin/README.md": "readme",
    });
    const result = resolveCachePaths(TEST_ENV, fs);
    // packagesDir exists (has files under it) but none match opencode-agent-skills-md*
    expect(result).toEqual([]);
  });

  test("returns exact match when opencode-agent-skills-md directory exists", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md"}',
    });
    const result = resolveCachePaths(TEST_ENV, fs);
    expect(result).toEqual(["/home/user/.cache/opencode/packages/opencode-agent-skills-md"]);
  });

  test("returns versioned entries when they exist alongside exact match", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md"}',
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest/package.json":
        '{"name":"opencode-agent-skills-md"}',
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@1.0.0/package.json":
        '{"name":"opencode-agent-skills-md"}',
      "/home/user/.cache/opencode/packages/other-plugin/package.json":
        '{"name":"other-plugin"}',
    });
    const result = resolveCachePaths(TEST_ENV, fs);
    expect(result).toContain(
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md"
    );
    expect(result).toContain(
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest"
    );
    expect(result).toContain(
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@1.0.0"
    );
    expect(result).toHaveLength(3);
  });

  test("returns only opencode-agent-skills-md entries, excluding other plugins", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md"}',
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@2.0.0/package.json":
        '{"name":"opencode-agent-skills-md"}',
      "/home/user/.cache/opencode/packages/opencode-rules-md/package.json":
        '{"name":"opencode-rules-md"}',
      "/home/user/.cache/opencode/packages/some-plugin/package.json":
        '{"name":"some-plugin"}',
    });
    const result = resolveCachePaths(TEST_ENV, fs);
    expect(result).toHaveLength(2);
    expect(result).not.toContain(
      "/home/user/.cache/opencode/packages/opencode-rules-md"
    );
    expect(result).not.toContain(
      "/home/user/.cache/opencode/packages/some-plugin"
    );
  });

  test("handles packages dir with mixed content gracefully", () => {
    const fs = createMemFs({
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest/package.json":
        '{"name":"opencode-agent-skills-md"}',
      "/home/user/.cache/opencode/packages/.hidden-dir/file.txt": "hidden",
      "/home/user/.cache/opencode/packages/regular-file.txt": "file",
    });
    const result = resolveCachePaths(TEST_ENV, fs);
    expect(result).toEqual([
      "/home/user/.cache/opencode/packages/opencode-agent-skills-md@latest",
    ]);
  });
});

// ---------------------------------------------------------------------------
// purgeDirectory tests
// ---------------------------------------------------------------------------

describe("purgeDirectory", () => {
  test("does not throw when directory does not exist", () => {
    const fs = createMemFs({});
    expect(() => purgeDirectory(fs, "/nonexistent")).not.toThrow();
  });

  test("removes empty directory", () => {
    const fs = createMemFs({
      "/cache/packages/opencode-agent-skills-md/README.md": "readme",
    });
    purgeDirectory(fs, "/cache/packages/opencode-agent-skills-md");
    expect(fs.existsSync("/cache/packages/opencode-agent-skills-md")).toBe(false);
  });

  test("removes directory with nested contents recursively", () => {
    const fs = createMemFs({
      "/cache/packages/opencode-agent-skills-md/package.json":
        '{"name":"opencode-agent-skills-md"}',
      "/cache/packages/opencode-agent-skills-md/README.md": "readme",
    });
    purgeDirectory(fs, "/cache/packages/opencode-agent-skills-md");
    expect(fs.existsSync("/cache/packages/opencode-agent-skills-md")).toBe(false);
    expect(fs.existsSync("/cache/packages/opencode-agent-skills-md/package.json")).toBe(false);
    expect(fs.existsSync("/cache/packages/opencode-agent-skills-md/README.md")).toBe(false);
  });

  test("best-effort: continues after individual entry deletion failure", () => {
    const fs = createMemFs({
      "/cache/packages/opencode-agent-skills-md/file1.txt": "content",
    });
    // Should not throw even if some operations fail
    expect(() => purgeDirectory(fs, "/cache/packages/opencode-agent-skills-md")).not.toThrow();
  });
});
