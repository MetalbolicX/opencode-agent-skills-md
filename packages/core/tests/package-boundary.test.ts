/**
 * Package boundary contract for `opencode-agent-skills-core`.
 *
 * This is the new home for the agnostic core engine. It encodes the spec
 * scenarios from `sdd/split-core-opencode-packages/spec`:
 *
 *   1. The core package exposes the public API listed in design.md
 *      (`discoverAllSkills`, `parseSkillFile`, `resolveSkill`, plus the
 *      helpers used by the plugin).
 *   2. Zero files under `packages/core/src/` reference the OpenCode host
 *      SDK (`@opencode-ai/plugin`) anywhere in source text.
 *   3. The package manifest declares the runtime entry as a standalone ESM
 *      module so other harnesses can depend on it without pulling the
 *      OpenCode SDK.
 *
 * The test runs from inside `packages/core/tests/`, so the relative paths
 * use `../src/` to resolve against the package's own sources.
 */

import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const SRC_DIR = path.resolve(import.meta.dirname, "..", "src");
const PKG_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");

describe("opencode-agent-skills-core package boundary", () => {
  test("manifest declares an ESM package whose runtime excludes @opencode-ai/plugin", async () => {
    const pkgPath = path.join(PKG_DIR, "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    assert.equal(manifest.name, "opencode-agent-skills-core", "package name");
    assert.equal(manifest.type, "module", "package type must be ESM");
    assert.equal(
      manifest.private,
      true,
      "package must be private until publishing is wired in a later PR"
    );

    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    assert.equal(
      dependencies["@opencode-ai/plugin"],
      undefined,
      "runtime dependencies must not include @opencode-ai/plugin"
    );
  });

  test("manifest points its root export at the package's own entry file", async () => {
    const pkgPath = path.join(PKG_DIR, "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const exports = manifest.exports as Record<string, unknown> | string | undefined;

    assert.ok(exports && typeof exports === "object", "exports must be an object");

    const rootExport = (exports as Record<string, unknown>)["."];
    assert.ok(rootExport, "exports['.'] must be defined");

    const importField = (rootExport as Record<string, unknown>).import;
    assert.ok(
      typeof importField === "string" && importField.includes("src/index"),
      `exports['.'].import must point at src/index, got: ${String(importField)}`
    );
  });

  test("public API surface matches the design contract", async () => {
    const core = await import("../src/index.ts");

    const expectedFunctions = [
      "discoverAllSkills",
      "parseSkillFile",
      "resolveSkill",
      "listSkillFiles",
      "findScripts",
      "isPathSafe",
      "findClosestMatch",
      "levenshtein",
      "renderAvailableSkillsBlock",
      "formatSkillListing",
      "parseYamlFrontmatter",
      "escapeRegex",
      "keywordMatch",
      "scoreSkill",
      "searchSkills",
      "tokenize",
      "getSkillSummaries",
      "getDefaultOpencodeRoots",
      "defaultOnDuplicate",
      "findSkillsRecursive",
      "findFile",
    ] as const;

    for (const name of expectedFunctions) {
      assert.equal(
        typeof (core as Record<string, unknown>)[name],
        "function",
        `${name} must be exported as a function from the package entrypoint`
      );
    }
  });

  test("zero references to @opencode-ai/plugin in packages/core/src/**", async () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.name.endsWith(".ts")) {
          const text = await readFile(fullPath, "utf8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            if (line.includes("@opencode-ai/plugin")) {
              violations.push({ file: fullPath, line: i + 1, text: line.trim() });
            }
          }
        }
      }
    }

    await walk(SRC_DIR);

    assert.deepEqual(
      violations,
      [],
      `expected zero references to the host SDK under packages/core/src, found: ${JSON.stringify(violations)}`
    );
  });

  test("core sources are isolated from the OpenCode adapter (no imports across the boundary)", async () => {
    const entries = await readdir(SRC_DIR, { withFileTypes: true });
    const tsFiles = entries.filter(
      (e) => e.isFile() && e.name.endsWith(".ts")
    );

    for (const entry of tsFiles) {
      const text = await readFile(path.join(SRC_DIR, entry.name), "utf8");
      assert.doesNotMatch(
        text,
        /from\s+["']\.\.\/opencode/,
        `${entry.name} must not import from the OpenCode adapter`
      );
    }
  });

  test("SkillHostClient is declared in packages/core/src/types.ts and re-exported from the package entrypoint", async () => {
    // Spec R2 (Boundary Interface Location): `SkillHostClient` SHALL be
    // declared in the core package. The concrete OpenCode implementation
    // lives in the plugin package only.
    const typesSource = await readFile(path.join(SRC_DIR, "types.ts"), "utf8");

    assert.match(
      typesSource,
      /export\s+interface\s+SkillHostClient\b/,
      "SkillHostClient interface must be declared in packages/core/src/types.ts",
    );

    // The interface must NOT be redeclared elsewhere under packages/core/src/
    // (a single declaration site is the boundary contract).
    const redeclarationSites: string[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.name.endsWith(".ts")) {
          const text = await readFile(fullPath, "utf8");
          if (new RegExp(`(?:export\\s+)?interface\\s+SkillHostClient\\b`).test(text) && fullPath !== path.join(SRC_DIR, "types.ts")) {
            redeclarationSites.push(fullPath);
          }
        }
      }
    }
    await walk(SRC_DIR);
    assert.deepEqual(
      redeclarationSites,
      [],
      `SkillHostClient must be declared only in types.ts, also found at: ${redeclarationSites.join(", ")}`,
    );

    // The interface must be reachable as a TypeScript type from the core
    // entrypoint (this is what the plugin package's host.ts will import).
    // `export type` is erased at runtime, so we verify by reading the
    // entrypoint's source text — and by dynamically importing it (a
    // broken index.ts would throw, so this still catches the failure
    // mode where the re-export line is malformed).
    const indexSource = await readFile(path.join(SRC_DIR, "index.ts"), "utf8");
    assert.match(
      indexSource,
      /\bSkillHostClient\b/,
      "SkillHostClient must be re-exported from packages/core/src/index.ts",
    );
    const core = (await import("../src/index.ts")) as unknown as Record<string, unknown>;
    // Type-only export: not a runtime value, but the import must not throw.
    assert.equal(core.SkillHostClient, undefined, "SkillHostClient is a TypeScript type, not a runtime value");
  });

  test("SkillHostSession is declared in packages/core/src/types.ts and re-exported from the package entrypoint", async () => {
    // Spec R2 (Boundary Interface Location): `SkillHostSession` SHALL be
    // declared in the core package. The plugin package implements the
    // session factory but does NOT redeclare the interface.
    const typesSource = await readFile(path.join(SRC_DIR, "types.ts"), "utf8");

    assert.match(
      typesSource,
      /export\s+interface\s+SkillHostSession\b/,
      "SkillHostSession interface must be declared in packages/core/src/types.ts",
    );

    // And reachable as a TypeScript type from the core entrypoint.
    const indexSource = await readFile(path.join(SRC_DIR, "index.ts"), "utf8");
    assert.match(
      indexSource,
      /\bSkillHostSession\b/,
      "SkillHostSession must be re-exported from packages/core/src/index.ts",
    );
    const core = (await import("../src/index.ts")) as unknown as Record<string, unknown>;
    assert.equal(core.SkillHostSession, undefined, "SkillHostSession is a TypeScript type, not a runtime value");
  });

  test("SkillHostContext is declared in packages/core/src/types.ts and re-exported from the package entrypoint", async () => {
    // The minimum shared context type needed to express `SkillHostClient`
    // cleanly in core. Without it, the boundary interface would have to
    // reach into the plugin package for its parameter type, defeating
    // the boundary. The spec calls this out implicitly via R2.
    const typesSource = await readFile(path.join(SRC_DIR, "types.ts"), "utf8");

    assert.match(
      typesSource,
      /export\s+interface\s+SkillHostContext\b/,
      "SkillHostContext interface must be declared in packages/core/src/types.ts",
    );

    const indexSource = await readFile(path.join(SRC_DIR, "index.ts"), "utf8");
    assert.match(
      indexSource,
      /\bSkillHostContext\b/,
      "SkillHostContext must be re-exported from packages/core/src/index.ts",
    );
    const core = (await import("../src/index.ts")) as unknown as Record<string, unknown>;
    assert.equal(core.SkillHostContext, undefined, "SkillHostContext is a TypeScript type, not a runtime value");
  });

  test("SkillHostClient declares the four boundary methods the core expects from any host", async () => {
    // Triangulation: beyond proving the NAME exists, the structural shape
    // of the boundary contract matters — the plugin's `createOpencodeSkillHost`
    // returns an object that must be assignable to this interface. A name
    // check alone would let an empty interface slip through.
    const typesSource = await readFile(path.join(SRC_DIR, "types.ts"), "utf8");

    // Slice the `SkillHostClient` interface body so the method-name checks
    // stay scoped to the interface (avoids false positives from comments or
    // other interfaces that happen to mention these names).
    const interfaceBody = typesSource.match(
      /export\s+interface\s+SkillHostClient\s*\{([\s\S]*?)\n\}/,
    );
    assert.ok(
      interfaceBody,
      "SkillHostClient must be an `export interface` block in packages/core/src/types.ts",
    );

    const body = interfaceBody![1]!;
    for (const methodName of ["injectContent", "getSessionContext", "readFile", "readdir"]) {
      assert.match(
        body,
        new RegExp(`\\b${methodName}\\s*\\(`),
        `SkillHostClient must declare method ${methodName} (the core relies on it)`,
      );
    }

    // The interface must NOT be a type alias (`type X = ...`). Spec R2
    // calls these "interfaces" and the plugin-side adapter may extend them
    // structurally; a type alias would still satisfy the name check but
    // break the design intent.
    assert.doesNotMatch(
      typesSource,
      /export\s+type\s+SkillHostClient\b/,
      "SkillHostClient must be declared as `interface`, not `type`",
    );
  });

  test("package resolves through the workspace link as opencode-agent-skills-core", async () => {
    // The root workspace symlinks packages/core into node_modules so the
    // package can be resolved by name from the repo root after pnpm install.
    const resolved = require.resolve("opencode-agent-skills-core");

    assert.match(
      resolved,
      /[\\/]packages[\\/]core[\\/]src[\\/]index\.ts$/,
      `expected opencode-agent-skills-core to resolve to packages/core/src/index.ts, got: ${resolved}`
    );

    // Sanity check: the resolved file lives inside the repo (no stale cache).
    assert.ok(
      resolved.startsWith(REPO_ROOT),
      `resolved path must live under the repo root: ${resolved}`
    );
  });
});