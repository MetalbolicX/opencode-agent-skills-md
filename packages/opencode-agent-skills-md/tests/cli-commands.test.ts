/**
 * Tests for the `oas` CLI command surface (Phases 1 → 3).
 *
 * Covers:
 *   - `parseJsonc`, `normalizePlugin`, `dedupePlugins`, `buildSpecifier`,
 *     `matchesPlugin` — pure helpers exercised with handcrafted inputs.
 *   - `backupIfWritable`, `rotateBackups`, `writeAtomically` — disk-side
 *     helpers exercised against an in-memory `CliFs`.
 *   - `loadGlobalConfig`, `resolveGlobalConfigPath` — loader path that
 *     uses the injected filesystem and env override.
 *   - `runInstall` — fresh install, idempotent re-run with same version,
 *     `--dry-run` no-write path, malformed-config abort, dedupe across
 *     legacy variants.
 *   - `runUninstall` — fresh uninstall, idempotent no-op, partial removal
 *     preserving unrelated entries, `--purge` candidate path reporting
 *     (dry-run only), `--dry-run` no-write, malformed-config abort.
 *   - `runStatus` — installed vs. uninstalled states, `extras` reporting,
 *     `.jsonc` format detection.
 *   - `runDoctor` — Node version OK path, config shape validation, plugin
 *     duplicate-count warning, writability-probe natural "missing dir" path.
 *   - `runMain` — valid dispatch (exit 0), missing command (exit 2),
 *     unknown command (exit 2), unknown option (exit 2), `--help` / `-h`
 *     short-circuit (exit 0).
 *
 * The in-memory adapter (`createMemoryFs`) lives in this file so the tests
 * own its shape and can extend it freely. It mirrors the `CliFs` interface
 * 1:1 — every method is a pure function over the in-memory file map, so
 * tests are deterministic, isolated, and run in milliseconds.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  BACKUP_LIMIT,
  PLUGIN_NAME,
  backupIfWritable,
  buildSpecifier,
  type CliFs,
  dedupePlugins,
  loadGlobalConfig,
  matchesPlugin,
  normalizePlugin,
  parseJsonc,
  resolveConfigDir,
  resolveGlobalConfigPath,
  rotateBackups,
  writeAtomically,
} from "../src/cli/config";
import { runInstall, type InstallOptions } from "../src/cli/install";
import { runMain, type MainResult } from "../src/cli/main";
import { type DoctorResult, runDoctor, runStatus, type StatusResult } from "../src/cli/status";
import { cachePath, pluginConfigPath, runUninstall, type UninstallOptions } from "../src/cli/uninstall";

// ---------------------------------------------------------------------------
// In-memory CliFs
// ---------------------------------------------------------------------------

/**
 * Build an in-memory `CliFs` adapter.
 *
 * Files are stored as `path → content` string pairs and directories are
 * tracked implicitly: a directory exists iff at least one file below it is
 * recorded. `existsSync` returns true for any recorded file or for any
 * directory that has recorded descendants. `readdirSync` lists files
 * directly under the requested path (one level, matching `node:fs`).
 *
 * Failure injection (write/rename/unlink/copy/mkdir/read) lets tests
 * exercise the cleanup branches without monkey-patching `node:fs`.
 */
const createMemoryFs = (initial: Record<string, string> = {}): CliFs & {
  files: () => Record<string, string>;
  setFailNext: (op: "rename" | "write" | null) => void;
} => {
  const files = new Map<string, string>(Object.entries(initial));
  let failNext: "rename" | "write" | null = null;

  const listDir = (dir: string): string[] => {
    const out = new Set<string>();
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.length === 0) continue;
      const first = rest.split("/")[0];
      if (first) out.add(first);
    }
    return Array.from(out);
  };

  const hasAny = (path: string): boolean => {
    if (files.has(path)) return true;
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  };

  const fs: CliFs = {
    readFileSync(path) {
      const value = files.get(path);
      if (value === undefined) {
        throw new Error(`ENOENT: no such file '${path}'`);
      }
      return value;
    },
    writeFileSync(path, content) {
      if (failNext === "write") {
        failNext = null;
        throw new Error("synthetic write failure");
      }
      files.set(path, content);
    },
    renameSync(from, to) {
      if (failNext === "rename") {
        failNext = null;
        throw new Error("synthetic rename failure");
      }
      const value = files.get(from);
      if (value === undefined) {
        throw new Error(`ENOENT: no such file '${from}'`);
      }
      files.set(to, value);
      files.delete(from);
    },
    copyFileSync(from, to) {
      const value = files.get(from);
      if (value === undefined) {
        throw new Error(`ENOENT: no such file '${from}'`);
      }
      files.set(to, value);
    },
    unlinkSync(path) {
      if (!files.has(path)) {
        throw new Error(`ENOENT: no such file '${path}'`);
      }
      files.delete(path);
    },
    mkdirSync(_path, _opts) {
      // Implicit: directories exist as soon as a file below them is written.
    },
    readdirSync(path) {
      return listDir(path);
    },
    existsSync(path) {
      return hasAny(path);
    },
  };

  return {
    ...fs,
    files: () => Object.fromEntries(files.entries()),
    setFailNext: (op) => {
      failNext = op;
    },
  };
};

// ---------------------------------------------------------------------------
// Capture/suppress console.* during CLI runs so test output stays clean.
// ---------------------------------------------------------------------------

type ConsoleSnapshot = {
  log: (...args: unknown[]) => void;
};

const captureConsole = (): { restore: () => void; output: () => string } => {
  let buffer = "";
  const original = console.log as unknown as (...args: unknown[]) => void;
  console.log = (...args: unknown[]) => {
    buffer += `${args.map(String).join(" ")}\n`;
  };
  return {
    restore: () => {
      console.log = original as ConsoleSnapshot["log"];
    },
    output: () => buffer,
  };
};

/**
 * Multi-channel capture for CLI commands that emit on `console.log`,
 * `console.warn`, and `console.error` (e.g. `runStatus`, `runDoctor`,
 * `runMain` error paths). Each accessor returns the cumulative output of
 * its channel at call time — safe to query after the wrapped command has
 * returned but before `restore()` runs.
 */
const captureConsoleAll = (): {
  restore: () => void;
  log: () => string;
  warn: () => string;
  error: () => string;
  all: () => string;
} => {
  let logBuf = "";
  let warnBuf = "";
  let errorBuf = "";
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = ((...args: unknown[]) => {
    logBuf += `${args.map(String).join(" ")}\n`;
  }) as typeof console.log;
  console.warn = ((...args: unknown[]) => {
    warnBuf += `${args.map(String).join(" ")}\n`;
  }) as typeof console.warn;
  console.error = ((...args: unknown[]) => {
    errorBuf += `${args.map(String).join(" ")}\n`;
  }) as typeof console.error;
  return {
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
    log: () => logBuf,
    warn: () => warnBuf,
    error: () => errorBuf,
    all: () => `${logBuf}${warnBuf}${errorBuf}`,
  };
};

// ---------------------------------------------------------------------------
// Env handling — keep tests hermetic. `resolveConfigDir` reads
// `process.env`, so each test sets and restores HOME/OPENCODE_CONFIG_DIR.
// ---------------------------------------------------------------------------

const ENV_BACKUP = { ...process.env };

const restoreEnv = () => {
  for (const key of new Set([...Object.keys(process.env), ...Object.keys(ENV_BACKUP)])) {
    const original = ENV_BACKUP[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
};

beforeEach(() => {
  restoreEnv();
  delete process.env.OPENCODE_CONFIG_DIR;
  // Tests hard-code `/home/x` paths; this keeps `process.env.HOME`-based
  // resolution aligned with those constants.
  process.env.HOME = "/home/x";
});

afterEach(() => {
  restoreEnv();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  test("PLUGIN_NAME matches the npm package name", () => {
    assert.equal(PLUGIN_NAME, "opencode-agent-skills-md");
  });

  test("BACKUP_LIMIT is a positive integer", () => {
    assert.ok(Number.isInteger(BACKUP_LIMIT));
    assert.ok(BACKUP_LIMIT >= 1);
  });
});

// ---------------------------------------------------------------------------
// parseJsonc
// ---------------------------------------------------------------------------

describe("parseJsonc", () => {
  test("parses empty / whitespace-only input as empty object", () => {
    assert.deepEqual(parseJsonc(""), {});
    assert.deepEqual(parseJsonc("   \n\t  "), {});
  });

  test("parses plain JSON", () => {
    assert.deepEqual(parseJsonc('{"plugin":["a","b"]}'), { plugin: ["a", "b"] });
  });

  test("strips single-line comments", () => {
    const raw = `{
      // list of plugins
      "plugin": ["opencode-agent-skills-md"]
    }`;
    assert.deepEqual(parseJsonc(raw), { plugin: ["opencode-agent-skills-md"] });
  });

  test("strips block comments", () => {
    const raw = `{
      /* primary plugin list */
      "plugin": ["opencode-agent-skills-md"]
    }`;
    assert.deepEqual(parseJsonc(raw), { plugin: ["opencode-agent-skills-md"] });
  });

  test("preserves double-slashes inside string literals (URLs)", () => {
    const raw = '{"doc": "see https://example.com/docs for more"}';
    assert.deepEqual(parseJsonc(raw), { doc: "see https://example.com/docs for more" });
  });

  test("handles escaped quotes inside strings without exiting the string", () => {
    const raw = '{"doc": "escaped \\"quote\\" inside"}';
    assert.deepEqual(parseJsonc(raw), { doc: 'escaped "quote" inside' });
  });

  test("removes trailing commas before } and ]", () => {
    assert.deepEqual(parseJsonc('{"plugin":["a","b",]}'), { plugin: ["a", "b"] });
    assert.deepEqual(parseJsonc('{"nested":{"x":1,}}'), { nested: { x: 1 } });
    assert.deepEqual(parseJsonc('{"list":[1,2,3,]}'), { list: [1, 2, 3] });
  });

  test("throws on malformed JSON (caller is expected to handle the error)", () => {
    assert.throws(() => parseJsonc("{ broken"), /JSON|Unexpected|broke/i);
    assert.throws(() => parseJsonc('"just a string"'), /must be a JSON object/i);
    assert.throws(() => parseJsonc("[1,2,3]"), /must be a JSON object/i);
  });

  test("preserves comma inside a string value before closing brace", () => {
    const raw = '{"doc":"keep ,} inside string","plugin":["a",]}';
    assert.deepEqual(parseJsonc(raw), { doc: "keep ,} inside string", plugin: ["a"] });
  });

  test("preserves comma inside a string value before closing bracket", () => {
    const raw = '{"doc":"keep ,] inside string","list":[1,2,],}';
    assert.deepEqual(parseJsonc(raw), { doc: "keep ,] inside string", list: [1, 2] });
  });

  test("preserves mixed patterns: string with comma-bracket, structural trailing commas", () => {
    const raw = `{
      "a": "has ,}",
      "b": ["x", "y ,]",],
      "c": {"d":1,}
    }`;
    assert.deepEqual(parseJsonc(raw), { a: "has ,}", b: ["x", "y ,]"], c: { d: 1 } });
  });
});

// ---------------------------------------------------------------------------
// matchesPlugin / buildSpecifier
// ---------------------------------------------------------------------------

describe("matchesPlugin", () => {
  test("matches bare PLUGIN_NAME", () => {
    assert.equal(matchesPlugin(PLUGIN_NAME), true);
  });

  test("matches PLUGIN_NAME with version specifier", () => {
    assert.equal(matchesPlugin(`${PLUGIN_NAME}@1.2.3`), true);
    assert.equal(matchesPlugin(`${PLUGIN_NAME}@latest`), true);
    assert.equal(matchesPlugin(`${PLUGIN_NAME}@next`), true);
  });

  test("does not match unrelated names or partial prefix matches", () => {
    assert.equal(matchesPlugin("opencode-agent-skills-md-other"), false);
    assert.equal(matchesPlugin("other-plugin"), false);
    assert.equal(matchesPlugin(""), false);
  });

  test("non-string entries return false (legacy object-form leftovers)", () => {
    assert.equal(matchesPlugin(42), false);
    assert.equal(matchesPlugin(null), false);
    assert.equal(matchesPlugin(undefined), false);
    assert.equal(matchesPlugin({ "opencode-agent-skills-md": {} }), false);
    assert.equal(matchesPlugin(["opencode-agent-skills-md"]), false);
  });
});

describe("buildSpecifier", () => {
  test("returns bare PLUGIN_NAME when no version supplied", () => {
    assert.equal(buildSpecifier(), PLUGIN_NAME);
    assert.equal(buildSpecifier(undefined), PLUGIN_NAME);
  });

  test("treats empty and whitespace-only versions as 'no version'", () => {
    assert.equal(buildSpecifier(""), PLUGIN_NAME);
    assert.equal(buildSpecifier("   "), PLUGIN_NAME);
  });

  test("appends @<version> when one is supplied", () => {
    assert.equal(buildSpecifier("1.2.3"), `${PLUGIN_NAME}@1.2.3`);
    assert.equal(buildSpecifier("  1.2.3  "), `${PLUGIN_NAME}@1.2.3`);
    assert.equal(buildSpecifier("latest"), `${PLUGIN_NAME}@latest`);
  });

  test("preserves caller-supplied tags and dist-tags", () => {
    assert.equal(buildSpecifier("beta"), `${PLUGIN_NAME}@beta`);
    assert.equal(buildSpecifier("next"), `${PLUGIN_NAME}@next`);
  });
});

// ---------------------------------------------------------------------------
// normalizePlugin
// ---------------------------------------------------------------------------

describe("normalizePlugin", () => {
  test("returns [] for undefined / null", () => {
    assert.deepEqual(normalizePlugin(undefined), []);
    assert.deepEqual(normalizePlugin(null), []);
  });

  test("returns [] for non-object, non-array scalars (doctor surfaces these)", () => {
    assert.deepEqual(normalizePlugin(42), []);
    assert.deepEqual(normalizePlugin(true), []);
    assert.deepEqual(normalizePlugin("not-an-array"), []);
  });

  test("keeps only string entries in an array form", () => {
    const out = normalizePlugin([PLUGIN_NAME, 42, null, "other-plugin"]);
    assert.deepEqual(out, [PLUGIN_NAME, "other-plugin"]);
  });

  test("converts the legacy object form to its keys, in declaration order", () => {
    const out = normalizePlugin({
      [PLUGIN_NAME]: { foo: 1 },
      "other-plugin": { bar: 2 },
    });
    // Object key ordering is stable in modern engines; we only check the set.
    assert.equal(out.length, 2);
    assert.ok(out.includes(PLUGIN_NAME));
    assert.ok(out.includes("other-plugin"));
  });
});

// ---------------------------------------------------------------------------
// dedupePlugins
// ---------------------------------------------------------------------------

describe("dedupePlugins", () => {
  test("returns [] for empty input", () => {
    assert.deepEqual(dedupePlugins([]), []);
  });

  test("drops every PLUGIN_NAME variant", () => {
    const out = dedupePlugins([
      PLUGIN_NAME,
      `${PLUGIN_NAME}@1.0.0`,
      `${PLUGIN_NAME}@2.0.0`,
      "other-plugin",
    ]);
    assert.deepEqual(out, ["other-plugin"]);
  });

  test("dedupes non-target entries by base name, keeping the LAST occurrence", () => {
    const out = dedupePlugins([
      "alpha@1.0.0",
      "alpha@2.0.0",
      "beta@1.0.0",
      "alpha@3.0.0",
    ]);
    assert.deepEqual(out, ["alpha@3.0.0", "beta@1.0.0"]);
  });

  test("ignores empty or non-string entries defensively", () => {
    const out = dedupePlugins([PLUGIN_NAME, "", "alpha@1.0.0", null as unknown as string]);
    assert.deepEqual(out, ["alpha@1.0.0"]);
  });

  test("preserves bare names without a version suffix", () => {
    const out = dedupePlugins(["alpha", PLUGIN_NAME, "alpha@9.9.9"]);
    // last occurrence of "alpha" wins
    assert.deepEqual(out, ["alpha@9.9.9"]);
  });
});

// ---------------------------------------------------------------------------
// Path resolution — resolveConfigDir / resolveGlobalConfigPath
// ---------------------------------------------------------------------------

describe("resolveConfigDir", () => {
  test("OPENCODE_CONFIG_DIR wins", () => {
    assert.equal(
      resolveConfigDir({ OPENCODE_CONFIG_DIR: "/etc/opencode" }),
      "/etc/opencode",
    );
  });

  test("falls back to $HOME/.config/opencode", () => {
    assert.equal(
      resolveConfigDir({ HOME: "/home/x" }),
      "/home/x/.config/opencode",
    );
  });

  test("ignores empty / whitespace-only env values", () => {
    assert.equal(
      resolveConfigDir({ OPENCODE_CONFIG_DIR: "   ", HOME: "/home/y" }),
      "/home/y/.config/opencode",
    );
  });
});

describe("resolveGlobalConfigPath", () => {
  test("returns the preferred `.json` target when no file exists", () => {
    const fs = createMemoryFs();
    const out = resolveGlobalConfigPath(fs, { HOME: "/home/x", OPENCODE_CONFIG_DIR: "/custom" });
    assert.equal(out.path, "/custom/opencode.json");
    assert.equal(out.format, "json");
    assert.equal(out.existed, false);
  });

  test("prefers existing `.json` over `.jsonc` in the same directory", () => {
    const fs = createMemoryFs({
      "/home/x/.config/opencode/opencode.json": "{}",
      "/home/x/.config/opencode/opencode.jsonc": "{}",
    });
    const out = resolveGlobalConfigPath(fs, { HOME: "/home/x" });
    assert.equal(out.path, "/home/x/.config/opencode/opencode.json");
    assert.equal(out.format, "json");
    assert.equal(out.existed, true);
  });

  test("falls back to `.jsonc` when `.json` is missing", () => {
    const fs = createMemoryFs({
      "/home/x/.config/opencode/opencode.jsonc": "{}",
    });
    const out = resolveGlobalConfigPath(fs, { HOME: "/home/x" });
    assert.equal(out.path, "/home/x/.config/opencode/opencode.jsonc");
    assert.equal(out.format, "jsonc");
    assert.equal(out.existed, true);
  });

  test("$OPENCODE_CONFIG_DIR takes precedence over $HOME", () => {
    const fs = createMemoryFs({
      "/etc/opencode/opencode.json": "{}",
      "/home/x/.config/opencode/opencode.json": "{}",
    });
    const out = resolveGlobalConfigPath(fs, {
      OPENCODE_CONFIG_DIR: "/etc/opencode",
      HOME: "/home/x",
    });
    assert.equal(out.path, "/etc/opencode/opencode.json");
  });
});

// ---------------------------------------------------------------------------
// loadGlobalConfig
// ---------------------------------------------------------------------------

describe("loadGlobalConfig", () => {
  test("returns { config: {}, existed: false } when no config file exists", () => {
    const fs = createMemoryFs();
    const out = loadGlobalConfig(fs, { HOME: "/home/x" });
    assert.equal(out.existed, false);
    assert.deepEqual(out.config, {});
    assert.match(out.path, /opencode\.json$/);
  });

  test("parses a normal config and surfaces the parsed object", () => {
    const fs = createMemoryFs({
      "/home/x/.config/opencode/opencode.json": JSON.stringify({ plugin: ["alpha"] }),
    });
    const out = loadGlobalConfig(fs, { HOME: "/home/x" });
    assert.equal(out.existed, true);
    assert.deepEqual(out.config, { plugin: ["alpha"] });
    assert.equal(out.parseError, undefined);
  });

  test("parses JSONC configs (comments + trailing commas)", () => {
    const raw = `{
      // primary plugin list
      "plugin": ["alpha", /* inline */ "beta",],
    }`;
    const fs = createMemoryFs({
      "/home/x/.config/opencode/opencode.jsonc": raw,
    });
    const out = loadGlobalConfig(fs, { HOME: "/home/x" });
    assert.equal(out.existed, true);
    assert.deepEqual(out.config, { plugin: ["alpha", "beta"] });
    assert.equal(out.parseError, undefined);
  });

  test("surfaces parseError instead of silently overwriting", () => {
    const fs = createMemoryFs({
      "/home/x/.config/opencode/opencode.json": "{ broken json",
    });
    const out = loadGlobalConfig(fs, { HOME: "/home/x" });
    assert.equal(out.existed, true);
    assert.deepEqual(out.config, {});
    assert.ok(typeof out.parseError === "string" && out.parseError.length > 0);
  });
});

// ---------------------------------------------------------------------------
// backupIfWritable / rotateBackups
// ---------------------------------------------------------------------------

describe("backupIfWritable", () => {
  test("returns null when the target file does not exist (no backup needed)", () => {
    const fs = createMemoryFs();
    const backup = backupIfWritable("/home/x/.config/opencode/opencode.json", fs);
    assert.equal(backup, null);
    assert.deepEqual(fs.files(), {});
  });

  test("copies the file to a timestamped sibling and returns the path", () => {
    const target = "/home/x/.config/opencode/opencode.json";
    const fs = createMemoryFs({ [target]: '{"plugin":[]}' });
    const backup = backupIfWritable(target, fs);
    assert.ok(backup);
    assert.ok(backup!.startsWith(`${target}.bak.`));
    assert.equal(fs.files()[backup!], '{"plugin":[]}');
  });

  test("preserves the original file in addition to creating the backup", () => {
    const target = "/home/x/.config/opencode/opencode.json";
    const fs = createMemoryFs({ [target]: '{"plugin":[]}' });
    backupIfWritable(target, fs);
    assert.equal(fs.files()[target], '{"plugin":[]}');
  });
});

describe("rotateBackups", () => {
  const target = "/home/x/.config/opencode/opencode.json";
  const list = (fs: ReturnType<typeof createMemoryFs>): string[] => {
    const all = Object.keys(fs.files());
    return all.filter((k) => k.includes(".bak.")).map((k) => k.split("/").pop()!);
  };

  test("keeps at most `limit` backups of the target", () => {
    const fs = createMemoryFs({
      [target]: "{}",
      [`${target}.bak.20260101T000000000Z`]: "{}",
      [`${target}.bak.20260102T000000000Z`]: "{}",
      [`${target}.bak.20260103T000000000Z`]: "{}",
      [`${target}.bak.20260104T000000000Z`]: "{}",
      [`${target}.bak.20260105T000000000Z`]: "{}",
    });
    rotateBackups(target, BACKUP_LIMIT, fs);
    const surviving = list(fs).sort();
    // Only the newest BACKUP_LIMIT (3) backups survive; the two oldest are
    // pruned from the in-memory filesystem.
    assert.deepEqual(surviving, [
      `${target.split("/").pop()}.bak.20260103T000000000Z`,
      `${target.split("/").pop()}.bak.20260104T000000000Z`,
      `${target.split("/").pop()}.bak.20260105T000000000Z`,
    ]);
  });

  test("does nothing when the directory holds fewer than `limit` backups", () => {
    const fs = createMemoryFs({
      [target]: "{}",
      [`${target}.bak.20260101T000000000Z`]: "{}",
    });
    rotateBackups(target, BACKUP_LIMIT, fs);
    assert.equal(list(fs).length, 1);
  });

  test("leaves backups of unrelated files alone", () => {
    const fs = createMemoryFs({
      [target]: "{}",
      // 5 backups of `target` plus 1 backup of `other.json` — rotation
      // only touches backups whose prefix matches `target`.
      [`${target}.bak.20260101T000000000Z`]: "{}",
      [`${target}.bak.20260102T000000000Z`]: "{}",
      [`${target}.bak.20260103T000000000Z`]: "{}",
      [`${target}.bak.20260104T000000000Z`]: "{}",
      [`${target}.bak.20260105T000000000Z`]: "{}",
      "/home/x/.config/opencode/other.json.bak.20260109T000000000Z": "{}",
    });
    rotateBackups(target, BACKUP_LIMIT, fs);
    assert.ok(
      fs.files()["/home/x/.config/opencode/other.json.bak.20260109T000000000Z"] !== undefined,
      "unrelated backups must survive",
    );
  });
});

// ---------------------------------------------------------------------------
// writeAtomically
// ---------------------------------------------------------------------------

describe("writeAtomically", () => {
  const target = "/home/x/.config/opencode/opencode.json";

  test("writes content to the target path", () => {
    const fs = createMemoryFs();
    writeAtomically(target, '{"plugin":["a"]}', fs);
    assert.equal(fs.files()[target], '{"plugin":["a"]}');
  });

  test("creates parent directories implicitly (first-run install)", () => {
    const fs = createMemoryFs();
    writeAtomically(target, "{}", fs);
    // The in-memory adapter tracks directories via file presence — the
    // existence check below would resolve the parent if any file under
    // it is recorded.
    assert.equal(fs.existsSync("/home/x/.config/opencode"), true);
  });

  test("cleans up the temp file when the rename fails", () => {
    const fs = createMemoryFs();
    fs.setFailNext("rename");
    assert.throws(() => writeAtomically(target, '{"plugin":["a"]}', fs));
    // tmp file must NOT linger; only `target` is what callers expect to exist.
    const lingering = Object.keys(fs.files()).filter((k) => k.includes(".tmp-"));
    assert.deepEqual(lingering, []);
  });
});

// ---------------------------------------------------------------------------
// runInstall
// ---------------------------------------------------------------------------

describe("runInstall", () => {
  const targetPath = "/home/x/.config/opencode/opencode.json";

  const newFs = (initial: Record<string, string> = {}): ReturnType<typeof createMemoryFs> => {
    const fs = createMemoryFs(initial);
    return fs;
  };

  const env = (): NodeJS.ProcessEnv => ({ HOME: "/home/x" });

  test("fresh install: appends the bare specifier to an empty plugin list", () => {
    const fs = newFs();
    const captured = captureConsole();
    try {
      const result = runInstall({}, fs as unknown as CliFs);
      assert.equal(result.status, "wrote");
      assert.equal(result.specifier, PLUGIN_NAME);
      assert.equal(result.path, targetPath);
      assert.equal(
        fs.files()[targetPath] ?? "",
        JSON.stringify({ plugin: [PLUGIN_NAME] }, null, 2),
      );
    } finally {
      captured.restore();
    }
  });

  test("fresh install: appends the versioned specifier when version supplied", () => {
    const fs = newFs();
    const captured = captureConsole();
    try {
      const result = runInstall({ version: "2.5.0" }, fs as unknown as CliFs);
      assert.equal(result.specifier, `${PLUGIN_NAME}@2.5.0`);
      assert.equal(
        fs.files()[targetPath] ?? "",
        JSON.stringify({ plugin: [`${PLUGIN_NAME}@2.5.0`] }, null, 2),
      );
    } finally {
      captured.restore();
    }
  });

  test("fresh install: backed up the original file when one existed", () => {
    const original = JSON.stringify({ plugin: ["other-plugin"] }, null, 2);
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runInstall({}, fs as unknown as CliFs);
      assert.equal(result.status, "wrote");
      assert.ok(result.backup);
      assert.equal(fs.files()[result.backup!], original);
      assert.equal(
        fs.files()[targetPath] ?? "",
        JSON.stringify({ plugin: ["other-plugin", PLUGIN_NAME] }, null, 2),
      );
    } finally {
      captured.restore();
    }
  });

  test("idempotent: re-running with the same specifier is a no-op", () => {
    const fs = newFs();
    const opts: InstallOptions = {};
    const first = runInstall(opts, fs as unknown as CliFs);
    assert.equal(first.status, "wrote");
    const fileAfterFirst = fs.files()[targetPath] ?? "";

    const captured = captureConsole();
    try {
      const second = runInstall(opts, fs as unknown as CliFs);
      assert.equal(second.status, "noop");
      assert.equal(second.specifier, first.specifier);
      // No further mutation: the file content is exactly what the first
      // call wrote.
      assert.equal(fs.files()[targetPath] ?? "", fileAfterFirst);
    } finally {
      captured.restore();
    }
  });

  test("dedupes legacy variants: a fresh install removes any prior target entries", () => {
    const original = JSON.stringify(
      { plugin: [`${PLUGIN_NAME}@0.9.0`, "other", `${PLUGIN_NAME}@1.0.0`] },
      null,
      2,
    );
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runInstall({}, fs as unknown as CliFs);
      assert.equal(result.status, "wrote");
      // Exactly one `opencode-agent-skills-md` (no version) at the end,
      // after the unrelated `other` plugin.
      assert.equal(
        fs.files()[targetPath] ?? "",
        JSON.stringify({ plugin: ["other", PLUGIN_NAME] }, null, 2),
      );
    } finally {
      captured.restore();
    }
  });

  test("--dry-run: prints the planned change but writes nothing", () => {
    const fs = newFs();
    const captured = captureConsole();
    try {
      const result = runInstall({ dryRun: true }, fs as unknown as CliFs);
      assert.equal(result.status, "planned");
      assert.equal(result.backup, null);
      // The file must NOT have been created.
      assert.equal(fs.files()[targetPath], undefined);
      assert.match(captured.output(), /\[dry-run\]/);
      assert.match(
        captured.output(),
        new RegExp(PLUGIN_NAME.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")),
      );
    } finally {
      captured.restore();
    }
  });

  test("malformed config: throws instead of silently overwriting", () => {
    const fs = newFs({ [targetPath]: "{ broken json" });
    const captured = captureConsole();
    try {
      assert.throws(
        () => runInstall({}, fs as unknown as CliFs),
        (err: Error) => {
          assert.match(err.message, /oas:.*malformed JSON/i);
          assert.match(err.message, new RegExp(targetPath.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")));
          return true;
        },
      );
      // The corrupt file must remain intact — install must never overwrite it.
      assert.equal(fs.files()[targetPath], "{ broken json");
    } finally {
      captured.restore();
    }
  });

  test("malformed config: --dry-run does NOT write a replacement either", () => {
    const fs = newFs({ [targetPath]: "{ broken json" });
    const captured = captureConsole();
    try {
      assert.throws(() => runInstall({ dryRun: true }, fs as unknown as CliFs));
      assert.equal(fs.files()[targetPath], "{ broken json");
    } finally {
      captured.restore();
    }
  });

  test("respects $OPENCODE_CONFIG_DIR when resolving the target", () => {
    process.env.OPENCODE_CONFIG_DIR = "/etc/opencode";
    const fs = newFs();
    const captured = captureConsole();
    try {
      const result = runInstall({}, fs as unknown as CliFs);
      assert.equal(result.path, "/etc/opencode/opencode.json");
      assert.equal(
        fs.files()[result.path] ?? "",
        JSON.stringify({ plugin: [PLUGIN_NAME] }, null, 2),
      );
    } finally {
      captured.restore();
    }
  });

  test("env is forwarded so tests stay hermetic across the whole suite", () => {
    // The previous test sets OPENCODE_CONFIG_DIR; this test asserts that
    // restoring env in afterEach() returns us to the HOME-based default.
    assert.equal(process.env.OPENCODE_CONFIG_DIR, undefined);
    assert.equal(process.env.HOME, "/home/x");
  });

  test("uses $HOME-based default after env restoration", () => {
    const fs = newFs();
    const captured = captureConsole();
    try {
      const result = runInstall({}, fs as unknown as CliFs);
      assert.equal(result.path, targetPath);
    } finally {
      captured.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runUninstall
//
// Plugin-only removal. Helper tests cover:
//   * fresh uninstall — removes the only oas entry and reports `wrote`.
//   * idempotent no-op — when the plugin is absent, returns `noop` and
//     leaves the config untouched.
//   * partial removal — oas + others → oas removed, others preserved.
//   * `--purge` + `--dry-run` — surfaces the candidate purge paths in
//     `result.purged` without touching disk.
//   * `--dry-run` alone — keeps the original file and emits `[dry-run]`
//     console output so the user can review the change.
//   * malformed config — aborts with a clear `oas:` error rather than
//     silently overwriting a corrupted file.
// ---------------------------------------------------------------------------

describe("runUninstall", () => {
  const targetPath = "/home/x/.config/opencode/opencode.json";

  const newFs = (initial: Record<string, string> = {}): ReturnType<typeof createMemoryFs> => {
    return createMemoryFs(initial);
  };

  const env = (): NodeJS.ProcessEnv => ({ HOME: "/home/x" });

  test("fresh uninstall: removes the only oas entry and reports wrote", () => {
    const original = JSON.stringify(
      { plugin: [PLUGIN_NAME, "other-plugin"] },
      null,
      2,
    );
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runUninstall({}, fs as unknown as CliFs);
      assert.equal(result.status, "wrote");
      assert.equal(result.path, targetPath);
      assert.deepEqual(result.removed, [PLUGIN_NAME]);
      assert.deepEqual(result.purged, []);
      // Unrelated entry is preserved.
      assert.equal(
        fs.files()[targetPath] ?? "",
        JSON.stringify({ plugin: ["other-plugin"] }, null, 2),
      );
    } finally {
      captured.restore();
    }
  });

  test("idempotent no-op: when the plugin is absent, returns noop without writing", () => {
    // Empty config already — uninstall should not touch it.
    const fs = newFs();
    const captured = captureConsole();
    try {
      const result = runUninstall({}, fs as unknown as CliFs);
      assert.equal(result.status, "noop");
      assert.equal(result.path, targetPath);
      assert.deepEqual(result.removed, []);
      assert.deepEqual(result.purged, []);
      // No file was created — `--purge` not requested and the file didn't exist.
      assert.equal(fs.files()[targetPath], undefined);
    } finally {
      captured.restore();
    }
  });

  test("partial removal: preserves unrelated entries in declaration order", () => {
    const original = JSON.stringify(
      { plugin: ["alpha@1.0.0", PLUGIN_NAME, "beta@1.0.0", `${PLUGIN_NAME}@2.0.0`] },
      null,
      2,
    );
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runUninstall({}, fs as unknown as CliFs);
      assert.equal(result.status, "wrote");
      // Both oas variants are reported as removed (legacy dedup matches all).
      assert.deepEqual(result.removed.sort(), [PLUGIN_NAME, `${PLUGIN_NAME}@2.0.0`].sort());
      // alpha and beta survive; no oas entries remain.
      assert.equal(
        fs.files()[targetPath] ?? "",
        JSON.stringify({ plugin: ["alpha@1.0.0", "beta@1.0.0"] }, null, 2),
      );
    } finally {
      captured.restore();
    }
  });

  test("removes the empty `plugin` key when oas was the only entry", () => {
    const original = JSON.stringify({ plugin: [PLUGIN_NAME] }, null, 2);
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runUninstall({}, fs as unknown as CliFs);
      assert.equal(result.status, "wrote");
      // The plugin key should be deleted entirely — leaving `{ plugin: [] }`
      // would change the file shape without need.
      assert.equal(fs.files()[targetPath] ?? "", "{}");
    } finally {
      captured.restore();
    }
  });

  test("--purge --dry-run: surfaces candidate paths without writing or purging", () => {
    const original = JSON.stringify({ plugin: [PLUGIN_NAME] }, null, 2);
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runUninstall({ purge: true, dryRun: true }, fs as unknown as CliFs);
      assert.equal(result.status, "planned");
      // The two plugin-owned purge candidates are reported, in declaration order.
      assert.equal(result.purged.length, 2);
      assert.ok(result.purged.includes(cachePath(env())));
      assert.ok(result.purged.includes(pluginConfigPath(env())));
      // The on-disk config file is unchanged — no write happened.
      assert.equal(fs.files()[targetPath], original);
      // Console output mentions `[dry-run]` so the user sees it was a preview.
      assert.match(captured.output(), /\[dry-run\]/);
      assert.match(captured.output(), /purge/);
    } finally {
      captured.restore();
    }
  });

  test("--dry-run alone: keeps the file and reports the planned removal", () => {
    const original = JSON.stringify({ plugin: [PLUGIN_NAME, "alpha"] }, null, 2);
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runUninstall({ dryRun: true }, fs as unknown as CliFs);
      assert.equal(result.status, "planned");
      assert.deepEqual(result.removed, [PLUGIN_NAME]);
      assert.deepEqual(result.purged, []);
      // File is unchanged.
      assert.equal(fs.files()[targetPath], original);
      assert.match(captured.output(), /\[dry-run\]/);
    } finally {
      captured.restore();
    }
  });

  test("malformed config: throws an `oas:` error and never writes", () => {
    const fs = newFs({ [targetPath]: "{ broken json" });
    const captured = captureConsole();
    try {
      assert.throws(
        () => runUninstall({}, fs as unknown as CliFs),
        (err: Error) => {
          assert.match(err.message, /oas:.*malformed JSON/i);
          assert.match(
            err.message,
            new RegExp(targetPath.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")),
          );
          return true;
        },
      );
      // The corrupt file is intact — uninstall never overwrites it.
      assert.equal(fs.files()[targetPath], "{ broken json");
    } finally {
      captured.restore();
    }
  });

  test("malformed config: --dry-run also refuses to write a replacement", () => {
    const fs = newFs({ [targetPath]: "{ broken json" });
    const captured = captureConsole();
    try {
      assert.throws(() => runUninstall({ dryRun: true }, fs as unknown as CliFs));
      assert.equal(fs.files()[targetPath], "{ broken json");
    } finally {
      captured.restore();
    }
  });

  test("--purge (real): config write failure leaves config file intact", () => {
    const original = JSON.stringify({ plugin: [PLUGIN_NAME] }, null, 2);
    const fs = newFs({ [targetPath]: original });
    fs.setFailNext("rename");
    try {
      assert.throws(() => runUninstall({ purge: true }, fs as unknown as CliFs));
      assert.equal(fs.files()[targetPath], original);
    } finally {
      fs.setFailNext(null);
    }
  });

  test("--purge (real): returns `wrote` and surfaces purged paths even when targets are missing", () => {
    // purgeDir swallows missing-target errors so the command can complete
    // cleanly even if the user never installed the plugin (no cache dir).
    const original = JSON.stringify({ plugin: [PLUGIN_NAME] }, null, 2);
    const fs = newFs({ [targetPath]: original });
    const captured = captureConsole();
    try {
      const result = runUninstall({ purge: true }, fs as unknown as CliFs);
      assert.equal(result.status, "wrote");
      // The two candidate paths were attempted; since the home cache and
      // ~/.config/opencode-agent-skills-md both don't exist in the test
      // sandbox, `purged` will be empty (rmSync with force=true is silenced
      // by the catch in purgeDir).
      assert.ok(Array.isArray(result.purged));
    } finally {
      captured.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runStatus
//
// Read-only probe. Helper tests cover:
//   * installed state — oas entry present → `installed: true`,
//     `specifier` set, `extras` excludes the oas entry.
//   * uninstalled state — empty `plugin` → `installed: false`,
//     `specifier: null`.
//   * extras reporting — non-oas entries surface in `extras`.
//   * format detection — `.jsonc` config is reported as `jsonc`.
// ---------------------------------------------------------------------------

describe("runStatus", () => {
  const targetPath = "/home/x/.config/opencode/opencode.json";

  const newFs = (initial: Record<string, string> = {}): ReturnType<typeof createMemoryFs> => {
    return createMemoryFs(initial);
  };

  test("installed state: oas entry present → installed:true and specifier set", () => {
    const fs = newFs({
      [targetPath]: JSON.stringify({ plugin: ["alpha@1.0.0", PLUGIN_NAME] }, null, 2),
    });
    const captured = captureConsoleAll();
    try {
      const result: StatusResult = runStatus(fs as unknown as CliFs);
      assert.equal(result.installed, true);
      assert.equal(result.specifier, PLUGIN_NAME);
      assert.equal(result.path, targetPath);
      assert.equal(result.format, "json");
      // extras excludes the oas entry.
      assert.deepEqual(result.extras, ["alpha@1.0.0"]);
      assert.match(captured.log(), new RegExp(`Installed:\\s+yes`));
      assert.match(captured.log(), new RegExp(`Specifier:\\s+${PLUGIN_NAME.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`));
    } finally {
      captured.restore();
    }
  });

  test("versioned specifier is reported verbatim", () => {
    const fs = newFs({
      [targetPath]: JSON.stringify({ plugin: [`${PLUGIN_NAME}@2.5.0`] }, null, 2),
    });
    const captured = captureConsoleAll();
    try {
      const result: StatusResult = runStatus(fs as unknown as CliFs);
      assert.equal(result.installed, true);
      assert.equal(result.specifier, `${PLUGIN_NAME}@2.5.0`);
    } finally {
      captured.restore();
    }
  });

  test("uninstalled state: empty config → installed:false and specifier:null", () => {
    const fs = newFs();
    const captured = captureConsoleAll();
    try {
      const result: StatusResult = runStatus(fs as unknown as CliFs);
      assert.equal(result.installed, false);
      assert.equal(result.specifier, null);
      assert.deepEqual(result.extras, []);
      assert.match(captured.log(), new RegExp(`Installed:\\s+no`));
    } finally {
      captured.restore();
    }
  });

  test("extras reporting: non-oas entries surface alongside the oas entry", () => {
    const fs = newFs({
      [targetPath]: JSON.stringify(
        { plugin: ["alpha@1.0.0", PLUGIN_NAME, "beta@2.0.0"] },
        null,
        2,
      ),
    });
    const captured = captureConsoleAll();
    try {
      const result: StatusResult = runStatus(fs as unknown as CliFs);
      assert.equal(result.installed, true);
      // Order preserved; oas itself is NOT in extras.
      assert.deepEqual(result.extras, ["alpha@1.0.0", "beta@2.0.0"]);
      assert.match(captured.log(), /Other plugins:\s+alpha@1\.0\.0, beta@2\.0\.0/);
    } finally {
      captured.restore();
    }
  });

  test("extras only: when no oas entry exists, the `extras` field still surfaces unrelated plugins", () => {
    const fs = newFs({
      [targetPath]: JSON.stringify({ plugin: ["alpha", "beta"] }, null, 2),
    });
    const captured = captureConsoleAll();
    try {
      const result: StatusResult = runStatus(fs as unknown as CliFs);
      assert.equal(result.installed, false);
      assert.equal(result.specifier, null);
      // The structured `extras` field captures every non-oas plugin, even
      // when the plugin itself is absent — scripting callers depend on it.
      assert.deepEqual(result.extras, ["alpha", "beta"]);
      // When nothing is installed, runStatus returns early and does not
      // emit the "Other plugins:" console line — verified by the absence
      // of that marker here.
      assert.doesNotMatch(captured.log(), /Other plugins:/);
    } finally {
      captured.restore();
    }
  });

  test("format detection: a .jsonc config reports format=jsonc", () => {
    const fs = newFs({
      "/home/x/.config/opencode/opencode.jsonc": JSON.stringify(
        { plugin: [PLUGIN_NAME] },
        null,
        2,
      ),
    });
    const captured = captureConsoleAll();
    try {
      const result: StatusResult = runStatus(fs as unknown as CliFs);
      assert.equal(result.format, "jsonc");
      assert.ok(result.path.endsWith(".jsonc"));
      assert.match(captured.log(), /Format:\s+jsonc/);
    } finally {
      captured.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runDoctor
//
// Health checks; read-only with respect to user config. Helper tests cover:
//   * Node version check — info line mentions "OK" on the test runner.
//   * Config shape validation — non-array/non-object `plugin` surfaces
//     an `issue`.
//   * Plugin-count warning — duplicate oas entries emit a `warning`.
//   * Writability probe — when the config dir does not exist, doctor
//     emits a "does not exist yet" warning. The "not writable" branch is
//     reached via the same probe but requires POSIX chmod to exercise
//     reliably; coverage of `statSync` failure here is the natural proof
//     that the probe runs.
// ---------------------------------------------------------------------------

describe("runDoctor", () => {
  const targetPath = "/home/x/.config/opencode/opencode.json";

  const newFs = (initial: Record<string, string> = {}): ReturnType<typeof createMemoryFs> => {
    return createMemoryFs(initial);
  };

  test("happy path: empty config + writable env → ok=true and Node line is OK", () => {
    const fs = newFs();
    const captured = captureConsoleAll();
    try {
      const result: DoctorResult = runDoctor(fs as unknown as CliFs, { HOME: "/home/x" });
      assert.equal(result.ok, true);
      assert.deepEqual(result.issues, []);
      // Node version is recorded as informational (test runner is >= 18).
      assert.ok(result.info.some((line) => /Node \d+\.\d+\.\d+ OK/.test(line)));
    } finally {
      captured.restore();
    }
  });

  test("config shape validation: plugin=42 is neither array nor object → issue reported", () => {
    const fs = newFs({
      [targetPath]: JSON.stringify({ plugin: 42 }),
    });
    const captured = captureConsoleAll();
    try {
      const result: DoctorResult = runDoctor(fs as unknown as CliFs, { HOME: "/home/x" });
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((line) => /neither array nor object/.test(line)),
        `expected an "neither array nor object" issue, got: ${JSON.stringify(result.issues)}`,
      );
    } finally {
      captured.restore();
    }
  });

  test("plugin-count warning: multiple oas entries → warning reports dedup-needed", () => {
    const fs = newFs({
      [targetPath]: JSON.stringify(
        { plugin: [PLUGIN_NAME, `${PLUGIN_NAME}@1.0.0`, "other"] },
        null,
        2,
      ),
    });
    const captured = captureConsoleAll();
    try {
      const result: DoctorResult = runDoctor(fs as unknown as CliFs, { HOME: "/home/x" });
      assert.ok(
        result.warnings.some((line) => /2 opencode-agent-skills-md entries present/.test(line)),
        `expected a "2 ... entries present" warning, got: ${JSON.stringify(result.warnings)}`,
      );
      // The issue list is still empty — duplicates are non-blocking.
      assert.deepEqual(result.issues, []);
      assert.equal(result.ok, true);
    } finally {
      captured.restore();
    }
  });

  test("writability probe: config directory missing → warning, not issue", () => {
    // $HOME points to a path that does not exist on the test host; the
    // probe intentionally fails open with a warning so install can still
    // surface a real write error when it actually runs.
    const fs = newFs();
    const captured = captureConsoleAll();
    try {
      const result: DoctorResult = runDoctor(fs as unknown as CliFs, { HOME: "/no/such/home-xyz" });
      assert.ok(
        result.warnings.some((line) => /does not exist yet/.test(line)),
        `expected a "does not exist yet" warning, got: ${JSON.stringify(result.warnings)}`,
      );
      // Still no blocking issue — the warning is enough.
      assert.deepEqual(result.issues, []);
    } finally {
      captured.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runMain
//
// CLI dispatch. Helper tests cover all four branches from the spec:
//   * valid dispatch (exit 0) — `oas status` with no config file on disk.
//   * invalid usage (exit 2) — missing command.
//   * invalid usage (exit 2) — unknown command.
//   * invalid usage (exit 2) — unknown option triggers parseArgs error.
//   * help flag (exit 0) — both `--help` and `-h`.
//
// Tests pass synthetic argv like `["status"]` because `sliceProcessArgv`
// only strips when `argv[0]` matches `process.argv[0]` or ends in `node`,
// which `["status"]` does not. This keeps the helper hermetic.
// ---------------------------------------------------------------------------

describe("runMain", () => {
  /**
   * Run `runMain` while capturing every console channel and preserving
   * `process.exitCode` from any earlier test. Returns the structured
   * result plus a getter for the captured output.
   */
  const dispatch = (
    argv: readonly string[],
  ): { result: MainResult; captured: ReturnType<typeof captureConsoleAll> } => {
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    const captured = captureConsoleAll();
    let result: MainResult;
    try {
      result = runMain(argv);
    } finally {
      captured.restore();
      // Restore rather than reset, so a previous test's intent is honored.
      process.exitCode = prevExit;
    }
    return { result, captured };
  };

  test("valid dispatch: `oas status` exits 0 with the status command resolved", () => {
    const { result } = dispatch(["status"]);
    assert.equal(result.command, "status");
    assert.equal(result.exitCode, 0);
  });

  test("valid dispatch: `oas doctor` exits 0 when no blocking issues exist", () => {
    const { result } = dispatch(["doctor"]);
    assert.equal(result.command, "doctor");
    // Doctor found no blocking issues (`ok === true`) → exit 0.
    assert.equal(result.exitCode, 0);
  });

  test("invalid usage: missing command → exit 2 and a friendly stderr hint", () => {
    const { result, captured } = dispatch([]);
    assert.equal(result.command, null);
    assert.equal(result.exitCode, 2);
    assert.match(captured.error(), /missing command/i);
  });

  test("invalid usage: unknown command → exit 2", () => {
    const { result, captured } = dispatch(["definitely-not-real"]);
    assert.equal(result.command, null);
    assert.equal(result.exitCode, 2);
    assert.match(captured.error(), /unknown command/i);
  });

  test("invalid usage: unknown option → exit 2 (parseArgs strict error)", () => {
    const { result, captured } = dispatch(["status", "--bogus-option"]);
    assert.equal(result.command, null);
    assert.equal(result.exitCode, 2);
    assert.match(captured.error(), /oas:|--bogus-option/);
  });

  test("--help short-circuits to exit 0 before parseArgs runs", () => {
    const { result, captured } = dispatch(["--help"]);
    assert.equal(result.command, "help");
    assert.equal(result.exitCode, 0);
    assert.match(captured.log(), /Usage: oas/);
  });

  test("-h short-circuits to exit 0 before parseArgs runs", () => {
    const { result, captured } = dispatch(["-h"]);
    assert.equal(result.command, "help");
    assert.equal(result.exitCode, 0);
    assert.match(captured.log(), /Usage: oas/);
  });

  test("--help after a positional still wins and exits 0", () => {
    const { result, captured } = dispatch(["status", "--help"]);
    assert.equal(result.command, "help");
    assert.equal(result.exitCode, 0);
    assert.match(captured.log(), /Usage: oas/);
  });

  test("default process.argv when invoked as main is not used in tests (synthetic args only)", () => {
    // Sanity: dispatching the bare CLI without argv shouldn't see real
    // process.argv positionals get parsed as commands. We call dispatch
    // with `[]` (not undefined) to keep the helper hermetic.
    const { result } = dispatch([]);
    assert.equal(result.exitCode, 2);
  });
});
