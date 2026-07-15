import { describe, expect, test } from "bun:test";
import {
  BACKUP_LIMIT,
  CONFIG_FILE_BASENAME,
  PLUGIN_NAME,
  backupIfWritable,
  buildSpecifier,
  dedupePlugins,
  loadGlobalConfig,
  matchesPlugin,
  normalizePlugin,
  parseJsonc,
  resolveConfigDir,
  resolveGlobalConfigPath,
  rotateBackups,
  writeAtomically,
} from "./cli/config";
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
// Constants
// ---------------------------------------------------------------------------

test("PLUGIN_NAME is correct", () => {
  expect(PLUGIN_NAME).toBe("opencode-agent-skills-md");
});

test("CONFIG_FILE_BASENAME is 'opencode'", () => {
  expect(CONFIG_FILE_BASENAME).toBe("opencode");
});

test("BACKUP_LIMIT is 3", () => {
  expect(BACKUP_LIMIT).toBe(3);
});

// ---------------------------------------------------------------------------
// resolveConfigDir
// ---------------------------------------------------------------------------

test("resolveConfigDir uses OPENCODE_CONFIG_DIR when set", () => {
  const result = resolveConfigDir({ OPENCODE_CONFIG_DIR: "/custom/path" });
  expect(result).toBe("/custom/path");
});

test("resolveConfigDir falls back to HOME/.config/opencode", () => {
  const result = resolveConfigDir({ HOME: "/home/user" });
  expect(result).toBe("/home/user/.config/opencode");
});

test("resolveConfigDir falls back to homedir when no HOME", () => {
  const result = resolveConfigDir({});
  expect(result).toMatch(/\.config\/opencode$/);
});

// ---------------------------------------------------------------------------
// resolveGlobalConfigPath
// ---------------------------------------------------------------------------

test("resolves existing .json in primary dir", () => {
  const fs = createMemFs({ "/cfg/opencode.json": "{}" });
  const result = resolveGlobalConfigPath(fs, { OPENCODE_CONFIG_DIR: "/cfg" });
  expect(result.path).toBe("/cfg/opencode.json");
  expect(result.format).toBe("json");
  expect(result.existed).toBe(true);
});

test("resolves existing .jsonc when .json absent", () => {
  const fs = createMemFs({ "/cfg/opencode.jsonc": "{}" });
  const result = resolveGlobalConfigPath(fs, { OPENCODE_CONFIG_DIR: "/cfg" });
  expect(result.path).toBe("/cfg/opencode.jsonc");
  expect(result.format).toBe("jsonc");
  expect(result.existed).toBe(true);
});

test(".json wins over .jsonc when both exist", () => {
  const fs = createMemFs({ "/cfg/opencode.json": "{}", "/cfg/opencode.jsonc": "{}" });
  const result = resolveGlobalConfigPath(fs, { OPENCODE_CONFIG_DIR: "/cfg" });
  expect(result.path).toBe("/cfg/opencode.json");
  expect(result.format).toBe("json");
});

test("returns preferred .json target when nothing exists", () => {
  const fs = createMemFs({});
  const result = resolveGlobalConfigPath(fs, { OPENCODE_CONFIG_DIR: "/new/cfg" });
  expect(result.path).toBe("/new/cfg/opencode.json");
  expect(result.format).toBe("json");
  expect(result.existed).toBe(false);
});

// ---------------------------------------------------------------------------
// JSONC stripping — parseJsonc
// ---------------------------------------------------------------------------

test("parseJsonc parses clean JSON", () => {
  const result = parseJsonc('{"a":1}');
  expect(result).toEqual({ a: 1 });
});

test("parseJsonc strips // line comments", () => {
  const result = parseJsonc('// comment\n{"a":1}');
  expect(result).toEqual({ a: 1 });
});

test("parseJsonc strips /* block */ comments", () => {
  const result = parseJsonc('/* comment */{"a":1}');
  expect(result).toEqual({ a: 1 });
});

test("parseJsonc preserves // inside strings", () => {
  const result = parseJsonc('{"url":"https://example.com/path"}');
  expect(result).toEqual({ url: "https://example.com/path" });
});

test("parseJsonc removes trailing commas", () => {
  const result = parseJsonc('{"a":1,"b":2,}');
  expect(result).toEqual({ a: 1, b: 2 });
});

test("parseJsonc returns {} for empty input", () => {
  expect(parseJsonc("")).toEqual({});
  const ws = "   \n  ";
  expect(parseJsonc(ws)).toEqual({});
});

test("parseJsonc throws on malformed JSON", () => {
  expect(() => parseJsonc("{invalid}")).toThrow();
});

test("parseJsonc throws when root is not an object", () => {
  expect(() => parseJsonc('"string"')).toThrow("config root must be a JSON object");
  expect(() => parseJsonc("[1,2,3]")).toThrow("config root must be a JSON object");
});

// ---------------------------------------------------------------------------
// Plugin helpers
// ---------------------------------------------------------------------------

test("matchesPlugin returns true for canonical plugin name", () => {
  expect(matchesPlugin("opencode-agent-skills-md")).toBe(true);
});

test("matchesPlugin returns true for versioned spec", () => {
  expect(matchesPlugin("opencode-agent-skills-md@1.0.0")).toBe(true);
  expect(matchesPlugin("opencode-agent-skills-md@latest")).toBe(true);
});

test("matchesPlugin returns false for other plugins", () => {
  expect(matchesPlugin("some-other-plugin")).toBe(false);
});

test("matchesPlugin returns false for non-string entries", () => {
  expect(matchesPlugin(null)).toBe(false);
  expect(matchesPlugin(undefined)).toBe(false);
  expect(matchesPlugin(123)).toBe(false);
  expect(matchesPlugin({})).toBe(false);
});

test("normalizePlugin handles undefined/null", () => {
  expect(normalizePlugin(undefined)).toEqual([]);
  expect(normalizePlugin(null)).toEqual([]);
});

test("normalizePlugin extracts string entries from array", () => {
  expect(normalizePlugin(["a", "b", 123, null])).toEqual(["a", "b"]);
});

test("normalizePlugin converts object form to keys", () => {
  expect(normalizePlugin({ "opencode-agent-skills-md": true, other: 1 })).toEqual([
    "opencode-agent-skills-md",
    "other",
  ]);
});

test("normalizePlugin returns [] for non-object/non-array", () => {
  expect(normalizePlugin("string")).toEqual([]);
  expect(normalizePlugin(42)).toEqual([]);
});

test("dedupePlugins removes all plugin entries", () => {
  const input = [
    "opencode-agent-skills-md@1.0.0",
    "other-plugin",
    "opencode-agent-skills-md@2.0.0",
  ];
  expect(dedupePlugins(input)).toEqual(["other-plugin"]);
});

test("dedupePlugins keeps last occurrence of each non-plugin base", () => {
  const input = [
    "other-plugin@1.0.0",
    "other-plugin@2.0.0",
    "another-plugin",
  ];
  expect(dedupePlugins(input)).toEqual(["other-plugin@2.0.0", "another-plugin"]);
});

test("dedupePlugins preserves order of surviving entries", () => {
  const input = ["a@1", "opencode-agent-skills-md@1", "b@1"];
  expect(dedupePlugins(input)).toEqual(["a@1", "b@1"]);
});

test("buildSpecifier defaults to @latest", () => {
  expect(buildSpecifier(undefined)).toBe("opencode-agent-skills-md@latest");
  expect(buildSpecifier("")).toBe("opencode-agent-skills-md@latest");
  expect(buildSpecifier("   ")).toBe("opencode-agent-skills-md@latest");
});

test("buildSpecifier uses provided version", () => {
  expect(buildSpecifier("1.0.0")).toBe("opencode-agent-skills-md@1.0.0");
});

// ---------------------------------------------------------------------------
// Backup rotation
// ---------------------------------------------------------------------------

test("backupIfWritable returns null when file does not exist", () => {
  const fs = createMemFs({});
  const result = backupIfWritable("/cfg/opencode.json", fs);
  expect(result).toBeNull();
});

test("backupIfWritable creates a timestamped backup", () => {
  const fs = createMemFs({ "/cfg/opencode.json": '{"plugins":[]}' });
  const result = backupIfWritable("/cfg/opencode.json", fs);
  expect(result).toMatch(/^\/cfg\/opencode\.json\.bak\.\d{8}T\d{9}Z$/);
  expect(fs.existsSync(result!)).toBe(true);
});

test("backupIfWritable includes original content in backup", () => {
  const fs = createMemFs({ "/cfg/opencode.json": '{"plugins":[]}' });
  const result = backupIfWritable("/cfg/opencode.json", fs);
  expect(fs.store[result!]).toBe('{"plugins":[]}');
});

test("rotateBackups keeps only newest BACKUP_LIMIT backups", () => {
  const store: MemStore = {
    "/cfg/opencode.json": "{}",
    "/cfg/opencode.json.bak.20200101T000000000Z": "old",
    "/cfg/opencode.json.bak.20200102T000000000Z": "middle",
    "/cfg/opencode.json.bak.20200103T000000000Z": "newest",
    "/cfg/opencode.json.bak.20200104T000000000Z": "to-remove",
  };
  const fs = createMemFs(store);
  rotateBackups("/cfg/opencode.json", BACKUP_LIMIT, fs);
  const remaining = Object.keys(fs.store).filter((k) => k.includes(".bak."));
  expect(remaining).toHaveLength(BACKUP_LIMIT);
  expect(remaining).toContain("/cfg/opencode.json.bak.20200102T000000000Z");
  expect(remaining).toContain("/cfg/opencode.json.bak.20200103T000000000Z");
  expect(remaining).toContain("/cfg/opencode.json.bak.20200104T000000000Z");
  expect(fs.store["/cfg/opencode.json.bak.20200101T000000000Z"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

test("writeAtomically creates parent dirs recursively", () => {
  const fs = createMemFs({});
  writeAtomically("/new/dir/opencode.json", '{"a":1}', fs);
  expect(fs.existsSync("/new/dir/opencode.json")).toBe(true);
  expect(fs.store["/new/dir/opencode.json"]).toBe('{"a":1}');
});

test("writeAtomically uses temp file then rename", () => {
  const fs = createMemFs({});
  writeAtomically("/cfg/opencode.json", '{"a":1}', fs);
  expect(fs.existsSync("/cfg/opencode.json")).toBe(true);
  // No orphaned temp files
  const tmpFiles = Object.keys(fs.store).filter((k) => k.includes(".tmp-"));
  expect(tmpFiles).toHaveLength(0);
});

test("writeAtomically cleans up temp file on failure", () => {
  let shouldThrow = true;
  const fs = createMemFs({});
  const brokenFs: CliFs = {
    ...fs,
    writeFileSync: () => {
      if (shouldThrow) throw new Error("disk full");
    },
  };
  expect(() => writeAtomically("/cfg/opencode.json", "{}", brokenFs)).toThrow("disk full");
  const tmpFiles = Object.keys(fs.store).filter((k) => k.includes(".tmp-"));
  expect(tmpFiles).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// loadGlobalConfig
// ---------------------------------------------------------------------------

test("loadGlobalConfig returns empty config for missing file", () => {
  const fs = createMemFs({});
  const result = loadGlobalConfig(fs, { OPENCODE_CONFIG_DIR: "/cfg" });
  expect(result.config).toEqual({});
  expect(result.existed).toBe(false);
  expect(result.path).toBe("/cfg/opencode.json");
  expect(result.parseError).toBeUndefined();
});

test("loadGlobalConfig parses existing file", () => {
  const fs = createMemFs({ "/cfg/opencode.json": '{"plugins":[]}' });
  const result = loadGlobalConfig(fs, { OPENCODE_CONFIG_DIR: "/cfg" });
  expect(result.config).toEqual({ plugins: [] });
  expect(result.existed).toBe(true);
  expect(result.parseError).toBeUndefined();
});

test("loadGlobalConfig returns parseError for malformed JSON", () => {
  const fs = createMemFs({ "/cfg/opencode.json": "not json" });
  const result = loadGlobalConfig(fs, { OPENCODE_CONFIG_DIR: "/cfg" });
  expect(result.config).toEqual({});
  expect(result.existed).toBe(true);
  expect(result.parseError).toBeDefined();
});
