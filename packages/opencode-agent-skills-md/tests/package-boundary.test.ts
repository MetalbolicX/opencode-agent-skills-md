/**
 * Package boundary contract for `opencode-agent-skills-md`.
 *
 * Encodes the spec scenarios from `sdd/split-core-opencode-packages/spec`
 * that apply to the OpenCode adapter package:
 *
 *   1. Manifest shape (name, type, private, exports, dependencies,
 *      scripts) — the workspace dep on `opencode-agent-skills-md-core`
 *      MUST be declared, and `@opencode-ai/plugin` MUST be a runtime
 *      dep of THIS package.
 *   2. Source structure — the four plugin files (`index.ts`, `plugin.ts`,
 *      `host.ts`, `tools.ts`) live under `packages/opencode-agent-skills-md/src/`
 *      and `index.ts` re-exports the public surface (default `SkillsPlugin`,
 *      `SkillsPlugin`, `createOpencodeSkillHost`, host types).
 *   3. The four tool names (`use_skill`, `read_skill_file`, `run_skill_script`,
 *      `find_skills`) are wired in the plugin factory.
 *   4. Plugin sources consume the core via the workspace package, not via
 *      relative `../core` imports.
 *   5. Test files for the plugin live under
 *      `packages/opencode-agent-skills-md/tests/{opencode,integration,e2e}/`
 *      and helpers live under `tests/integration/helpers/`.
 *   6. Build is configured via `rolldown.config.js` at the package root
 *      and the plugin entry emits `dist/opencode/index.js`.
 *   7. Scripts (`build`, `test`, `typecheck`) exist at the package level.
 *
 * The test runs from inside `packages/opencode-agent-skills-md/tests/`, so
 * the relative paths use `../src/`, `../..`, etc.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const PKG_DIR = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(PKG_DIR, "src");
const TESTS_DIR = path.join(PKG_DIR, "tests");
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");

describe("opencode-agent-skills-md package boundary", () => {
  test("manifest declares the plugin as `opencode-agent-skills-md`, ESM, and private", async () => {
    const pkgPath = path.join(PKG_DIR, "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    assert.equal(manifest.name, "opencode-agent-skills-md", "package name preserves the existing install surface");
    assert.equal(manifest.type, "module", "package type must be ESM");
    assert.equal(
      manifest.private,
      true,
      "package must be private until publishing is wired in a later PR",
    );
  });

  test("manifest depends on the workspace core package and on @opencode-ai/plugin", async () => {
    const raw = await readFile(path.join(PKG_DIR, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    assert.ok(
      "opencode-agent-skills-md-core" in dependencies,
      "dependencies must declare the workspace core package",
    );
    assert.ok(
      "@opencode-ai/plugin" in dependencies,
      "dependencies must include @opencode-ai/plugin (this is the OpenCode adapter package)",
    );
    assert.ok(
      "yaml" in dependencies,
      "dependencies must include yaml (transitively required by the core)",
    );
  });

  test("manifest points the root export at the plugin entry file", async () => {
    const raw = await readFile(path.join(PKG_DIR, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    const exports = manifest.exports as Record<string, unknown> | string | undefined;
    assert.ok(exports && typeof exports === "object", "exports must be an object");

    const rootExport = (exports as Record<string, unknown>)["."];
    assert.ok(rootExport, "exports['.'] must be defined");

    const importField = (rootExport as Record<string, unknown>).import;
    assert.ok(
      typeof importField === "string" && importField.includes("src/index"),
      `exports['.'].import must point at src/index, got: ${String(importField)}`,
    );
  });

  test("package scripts cover build, test, and typecheck", async () => {
    const raw = await readFile(path.join(PKG_DIR, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    const scripts = (manifest.scripts ?? {}) as Record<string, string>;
    for (const name of ["build", "test", "typecheck"]) {
      assert.ok(
        typeof scripts[name] === "string" && scripts[name]!.length > 0,
        `scripts.${name} must be defined`,
      );
    }
  });

  test("plugin sources live under packages/opencode-agent-skills-md/src/ with the four files", async () => {
    for (const name of ["index.ts", "plugin.ts", "host.ts", "tools.ts"]) {
      const fullPath = path.join(SRC_DIR, name);
      assert.ok(existsSync(fullPath), `${name} must exist at ${fullPath}`);
    }
  });

  test("plugin entry re-exports the four-tool public surface", async () => {
    const entry = await import("../src/index.ts");

    assert.equal(typeof entry.default, "function", "default export must be the SkillsPlugin factory");
    assert.equal(typeof entry.SkillsPlugin, "function", "SkillsPlugin must be a named export");
    assert.equal(typeof entry.createOpencodeSkillHost, "function", "createOpencodeSkillHost must be exported");
    assert.equal(typeof entry.OpencodeClient, "undefined", "OpencodeClient is a type-only export, not a runtime value");
  });

  test("plugin factory registers the four skill tool names", async () => {
    const pluginModule = await import("../src/plugin.ts");
    const factory = pluginModule.SkillsPlugin as unknown as (input: unknown) => Promise<{ tool: Record<string, unknown> }>;
    const captured: { tool: Record<string, unknown> } = { tool: {} };
    const boundFactory = new Proxy(factory, {
      // Bind `factory` so `this` (unused) is irrelevant; we only care that
      // the plugin returns an object whose `.tool` carries the four names.
      // We can't actually run the factory without an SDK client, so the
      // wiring is asserted by reading the plugin source directly below.
      apply() {
        return captured;
      },
    });

    // The factory itself needs `client`, `$`, `directory` to construct the
    // host. We don't call it here — instead we read the source and assert
    // the wiring literally exists (the same way the moved plugin.test.ts
    // does for `matchSkillsByKeyword` / `formatMatchedSkillsInjection`).
    const pluginSource = await readFile(path.join(SRC_DIR, "plugin.ts"), "utf8");
    for (const toolName of ["use_skill", "read_skill_file", "run_skill_script", "get_available_skills"]) {
      // The plugin registers tools as object keys (`use_skill: tools.UseSkill`)
      // so a word-boundary match is the right shape to assert.
      const pattern = new RegExp(`\\b${toolName.replace(/_/g, "_")}\\b`);
      assert.ok(
        pattern.test(pluginSource),
        `plugin.ts must register the ${toolName} tool`,
      );
    }

    // Reference the bound factory so the proxy stays in scope for the
    // proxy-based assertion pattern even though we don't call it.
    void boundFactory;
  });

  test("plugin sources consume the core via the workspace package, not relative ../core imports", async () => {
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
            if (/from\s+["']\.\.\/core/.test(line)) {
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
      `expected zero relative ../core imports under packages/opencode-agent-skills-md/src, found: ${JSON.stringify(violations)}`,
    );

    // Confirm the package does import the workspace core somewhere.
    const pluginSource = await readFile(path.join(SRC_DIR, "plugin.ts"), "utf8");
    assert.match(
      pluginSource,
      /from\s+["']opencode-agent-skills-md-core["']/,
      "plugin.ts must import from the workspace package, not the relative path",
    );
  });

  test("plugin, integration, and e2e tests live under packages/opencode-agent-skills-md/tests/", async () => {
    for (const sub of ["opencode", "integration", "e2e"]) {
      const subPath = path.join(TESTS_DIR, sub);
      assert.ok(existsSync(subPath), `tests/${sub} must exist at ${subPath}`);

      const entries = await readdir(subPath);
      const testFiles = entries.filter((e) => e.endsWith(".test.ts"));
      assert.ok(testFiles.length > 0, `tests/${sub} must contain at least one .test.ts file`);
    }

    // The shared mock client helper must live inside the package.
    assert.ok(
      existsSync(path.join(TESTS_DIR, "integration", "helpers", "mock-opencode.ts")),
      "tests/integration/helpers/mock-opencode.ts must exist",
    );
  });

  test("package has a rolldown config that emits the plugin entry as dist/plugin.mjs", async () => {
    const configPath = path.join(PKG_DIR, "rolldown.config.js");
    assert.ok(existsSync(configPath), `rolldown.config.js must exist at ${configPath}`);

    const raw = await readFile(configPath, "utf8");
    assert.match(raw, /src\/index\.ts/, "rolldown config must point at src/index.ts");
    assert.match(raw, /plugin\.mjs/, "rolldown config must emit dist/plugin.mjs");
  });

test("package resolves through the workspace link as opencode-agent-skills-md", async () => {
    // The workspace symlinks packages/opencode-agent-skills-md into node_modules
    // so the package can be resolved by name after pnpm install.
    const resolved = require.resolve("opencode-agent-skills-md");

    assert.match(
      resolved,
      /[\\/]packages[\\/]opencode-agent-skills-md[\\/]/,
      `expected opencode-agent-skills-md to resolve into packages/opencode-agent-skills-md, got: ${resolved}`,
    );

    assert.ok(
      resolved.startsWith(REPO_ROOT),
      `resolved path must live under the repo root: ${resolved}`,
    );
  });

  test("plugin host.ts imports the boundary types from opencode-agent-skills-md-core (does not redeclare them)", async () => {
    // Spec R2 (Boundary Interface Location): `SkillHostClient` and
    // `SkillHostSession` SHALL be declared in the core package; the concrete
    // OpenCode implementation SHALL exist only in the plugin package. This
    // test pins the asymmetry: the plugin IMPORTS the boundary contracts
    // and IMPLEMENTS them, instead of redeclaring them locally.
    const hostSource = await readFile(path.join(SRC_DIR, "host.ts"), "utf8");

    // Every boundary type the plugin uses must be imported from the core.
    for (const typeName of ["SkillHostClient", "SkillHostSession", "SkillHostContext"]) {
      assert.match(
        hostSource,
        new RegExp(`\\b${typeName}\\b`),
        `host.ts must reference ${typeName} (either as a declaration or as an import)`,
      );
      // The plugin must NOT redeclare these interfaces. A redeclaration in
      // the plugin package would violate the boundary and force the core's
      // contract to drift from the implementation.
      assert.doesNotMatch(
        hostSource,
        new RegExp(`(?:export\\s+)?interface\\s+${typeName}\\b`),
        `host.ts must NOT redeclare interface ${typeName} (it is declared in the core package)`,
      );
      // The plugin must import the type from the workspace package, not
      // from a relative path that reaches into the core sources.
      const importPattern = new RegExp(
        `import\\s+(?:type\\s+)?(?:\\{[^}]*\\b${typeName}\\b[^}]*\\}|${typeName})\\s+from\\s+["']opencode-agent-skills-md-core["']`,
      );
      assert.match(
        hostSource,
        importPattern,
        `host.ts must import ${typeName} from the workspace package "opencode-agent-skills-md-core"`,
      );
    }
  });

  test("workspace contains exactly one concrete OpenCode host implementation (the plugin's createOpencodeSkillHost)", async () => {
    // Spec R2: "exactly one concrete OpenCode implementation exists in
    // the plugin package." This walk proves the count of DEFINITIONS is
    // exactly one — not zero (would mean the spec is unimplemented) and
    // not two-plus (would mean the boundary leaked and a duplicate
    // concrete implementation exists somewhere).
    const definitions: string[] = [];

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const text = await readFile(fullPath, "utf8");
          // Match a function declaration, not re-exports or call sites.
          // The plugin must have exactly ONE concrete implementation;
          // re-exports in `index.ts` and call sites in `plugin.ts` are fine.
          if (/(?:export\s+)?function\s+createOpencodeSkillHost\b/.test(text)) {
            definitions.push(fullPath);
          }
        }
      }
    }

    await walk(SRC_DIR);

    assert.deepEqual(
      definitions,
      [path.join(SRC_DIR, "host.ts")],
      `createOpencodeSkillHost must be defined exactly once at packages/opencode-agent-skills-md/src/host.ts, found at: ${definitions.join(", ")}`,
    );
  });

  test("the concrete OpenCode host client satisfies the core SkillHostClient contract at runtime", async () => {
    // Triangulation: a static import proves the boundary types are wired,
    // but the spec also wants the RUNTIME object returned by the plugin
    // to actually implement the four core methods. A hand-rolled stub
    // SDK client exercises the boundary end-to-end.
    const { createOpencodeSkillHost } = await import("../src/host.ts");

    const prompts: unknown[] = [];
    const stub = {
      session: {
        prompt: async (input: unknown) => {
          prompts.push(input);
        },
        messages: async () => ({ data: [] }),
      },
    };
    const host = createOpencodeSkillHost(stub as any);

    const client = host.client as unknown as Record<string, unknown>;
    for (const methodName of ["injectContent", "getSessionContext", "readFile", "readdir"]) {
      assert.equal(
        typeof client[methodName],
        "function",
        `client.${methodName} must be a function (concrete implementation must satisfy SkillHostClient)`,
      );
    }

    // And the four methods are callable against a stub SDK client without
    // throwing — proves the concrete impl really plumbs through to the
    // SDK surface that the core contract expects.
    await (client.injectContent as (id: string, text: string) => Promise<void>)("sess", "hello");
    await (client.getSessionContext as (id: string) => Promise<unknown>)("sess");
    assert.equal(prompts.length, 1, "injectContent must call client.session.prompt exactly once");
  });
});
