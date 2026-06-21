/**
 * Workspace boundary contract for the `opencode-agent-skills` repo root.
 *
 * PR 3 of `split-core-opencode-packages` turns the repo root into a pure
 * pnpm workspace manifest: no source, no fixtures, no root-level build
 * config. The two real packages live under `packages/core/` and
 * `packages/opencode-agent-skills/`. This test pins the contracts that
 * prove the consolidation actually happened:
 *
 *   1. Root manifest is a workspace manifest (private, no exports of its own,
 *      scripts delegate to packages via `pnpm -r`).
 *   2. Legacy root sources (`src/`, root `tests/fixtures/`, root
 *      `rolldown.config.js`, root `tsconfig.build.json`) are gone — they
 *      are now owned by the per-package directories.
 *   3. Docs (README, CHANGELOG, Justfile, AGENTS.md) route users to the
 *      correct package for each harness and reflect the workspace
 *      structure.
 *   4. Both packages resolve from the repo root through the pnpm
 *      workspace link (the symlink pnpm install wires into
 *      `node_modules/`).
 *
 * The test runs from the repo root's `tests/` directory, so the relative
 * paths use `..` to resolve against the repo itself.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("opencode-agent-skills workspace root", () => {
  test("root package.json is a private workspace manifest with no exports of its own", async () => {
    const pkgPath = path.join(REPO_ROOT, "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    // Workspace roots must be private — pnpm treats them as metadata
    // containers, not packages to publish. The plugin package
    // (`opencode-agent-skills`) remains the installable artifact.
    assert.equal(
      manifest.private,
      true,
      "root package.json must be private (it is a workspace manifest, not a publishable package)",
    );

    // The root manifest must not pretend to expose an entrypoint — the
    // packages under `packages/*` own those exports. Carrying a stale
    // `main`/`exports` would invite consumers to import the workspace
    // by mistake.
    assert.equal(
      manifest.main,
      undefined,
      "root package.json must not declare a `main` (the packages own their own entrypoints)",
    );
    assert.equal(
      manifest.exports,
      undefined,
      "root package.json must not declare `exports` (the packages own their own entrypoints)",
    );

    // Version + author metadata is fine to keep at the root.
    assert.equal(typeof manifest.version, "string", "root package.json must carry a version string");
  });

  test("root scripts delegate to packages via `pnpm -r` so a single command covers both packages", async () => {
    const raw = await readFile(path.join(REPO_ROOT, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const scripts = (manifest.scripts ?? {}) as Record<string, string>;

    for (const name of ["build", "test", "typecheck"]) {
      const script = scripts[name];
      assert.ok(
        typeof script === "string" && script.length > 0,
        `root scripts.${name} must be defined`,
      );
      assert.match(
        script,
        /pnpm\s+-r\b/,
        `root scripts.${name} must delegate to packages via \`pnpm -r\`, got: ${script}`,
      );
    }
  });

  test("root package.json declares a workspace itself via pnpm-workspace.yaml", async () => {
    // Sanity check: the pnpm workspace declaration exists and lists the
    // two expected package globs. pnpm-workspace.yaml is the source of
    // truth for "this is a workspace".
    const raw = await readFile(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
    assert.match(
      raw,
      /packages:\s*\n\s*-\s+["']packages\/\*["']/,
      "pnpm-workspace.yaml must declare the `packages/*` glob so pnpm wires the two packages into the workspace",
    );
  });

  test("legacy root sources and build config are removed (packages now own them)", async () => {
    // These were the legacy "root owns the build" surfaces from the
    // pre-split layout. After PR 3 each one has a per-package home:
    //   - src/core/index.ts            -> packages/core/src/index.ts
    //   - src/opencode/{4 files}       -> packages/opencode-agent-skills/src/{4 files}
    //   - rolldown.config.js           -> packages/opencode-agent-skills/rolldown.config.js
    //   - tsconfig.build.json          -> packages/opencode-agent-skills/tsconfig.build.json
    //   - tests/fixtures/skills/**     -> packages/opencode-agent-skills/tests/fixtures/skills/**
    // The root sources/test config that remain (workspace manifest,
    // AGENTS.md, README, etc.) are non-source artifacts.
    for (const legacyPath of [
      "src",
      "rolldown.config.js",
      "tsconfig.build.json",
      "tests/fixtures",
    ]) {
      const fullPath = path.join(REPO_ROOT, legacyPath);
      assert.ok(
        !existsSync(fullPath),
        `legacy root path must be removed by PR 3, but still exists at ${fullPath}`,
      );
    }

    // The root `tsconfig.json` survives (it is used as a base for the
    // per-package tsconfigs) — confirm it still exists and points at
    // something reasonable.
    const rootTsconfig = path.join(REPO_ROOT, "tsconfig.json");
    assert.ok(existsSync(rootTsconfig), "root tsconfig.json must survive as the base for per-package tsconfigs");
    const rootTsconfigRaw = await readFile(rootTsconfig, "utf8");
    assert.match(
      rootTsconfigRaw,
      /"strict"\s*:\s*true/,
      "root tsconfig.json must keep the strict-mode compiler options",
    );
  });

  test("root src/core/index.ts compatibility shim has been removed (all callers use the workspace import now)", async () => {
    // The shim only existed to keep legacy relative imports resolvable
    // during PR 1+2; PR 3 deletes it because there are no more legacy
    // callers (every consumer resolves `opencode-agent-skills-core`
    // through the workspace link).
    const shimPath = path.join(REPO_ROOT, "src", "core", "index.ts");
    assert.ok(
      !existsSync(shimPath),
      `legacy compatibility shim must be removed by PR 3, but still exists at ${shimPath}`,
    );
  });

  test("README routes users to the correct package for each harness type", async () => {
    const readme = await readFile(path.join(REPO_ROOT, "README.md"), "utf8");

    // Both package names must appear so consumers can find each one.
    assert.match(
      readme,
      /opencode-agent-skills-core/,
      "README must mention the standalone core package",
    );
    assert.match(
      readme,
      /\bopencode-agent-skills\b/,
      "README must mention the OpenCode plugin package",
    );

    // The README must explicitly tell consumers which package to install
    // for an OpenCode harness vs a custom/non-OpenCode harness. This is
    // the R-3 routing scenario from the spec.
    assert.match(
      readme,
      /OpenCode/i,
      "README must still describe the OpenCode plugin install path",
    );
    assert.match(
      readme,
      /(custom harness|portable engine|standalone|non-OpenCode|without pulling the OpenCode SDK)/i,
      "README must explain how to consume the standalone core package for custom harnesses",
    );

    // The legacy "Programmatic subpath exports" section that pointed
    // users at `opencode-agent-skills/core` must be gone — the spec
    // (R4 REMOVED) explicitly retired that import path in favor of
    // the standalone `opencode-agent-skills-core` package.
    assert.doesNotMatch(
      readme,
      /opencode-agent-skills\/core/,
      "README must not document the removed `opencode-agent-skills/core` subpath (spec R4 REMOVED)",
    );
  });

  test("CHANGELOG records the workspace split under [Unreleased]", async () => {
    const changelog = await readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");

    // The [Unreleased] section must mention the package split so anyone
    // tracking the project knows the install surface changed.
    const unreleasedMatch = changelog.match(/##\s*\[Unreleased\]([\s\S]*?)(?=\n##\s|\n$)/);
    assert.ok(unreleasedMatch, "CHANGELOG.md must contain a populated [Unreleased] section");

    const unreleased = unreleasedMatch![1]!;
    assert.match(
      unreleased,
      /opencode-agent-skills-core/,
      "CHANGELOG [Unreleased] must mention the new core package",
    );
    assert.match(
      unreleased,
      /(workspace|split|extract)/i,
      "CHANGELOG [Unreleased] must describe the workspace split as a Changed/Added entry",
    );
  });

  test("Justfile recipes align with the two-package workspace layout", async () => {
    const justfile = await readFile(path.join(REPO_ROOT, "Justfile"), "utf8");

    // `test` and `build` recipes must delegate to pnpm so both packages
    // are covered; hard-coded `npm test` from a single package would
    // silently skip the other. The exact pnpm flag shape varies (e.g.
    // `pnpm -r run build`, `pnpm -r --workspace-concurrency=1 run build`,
    // `pnpm test`) so we accept any `pnpm` invocation that ends in the
    // right subcommand.
    const testRecipe = justfile.match(/^test:\s*\n([\s\S]*?)(?=\n\n|\n[a-z]+\s*:|\n#|$)/m);
    assert.ok(testRecipe, "Justfile must define a `test` recipe");
    assert.match(
      testRecipe![1]!,
      /pnpm\b[\s\S]*\btest\b/,
      `Justfile \`test\` recipe must delegate via pnpm so both packages run, got:\n${testRecipe![1]!}`,
    );

    const buildRecipe = justfile.match(/^build:\s*\n([\s\S]*?)(?=\n\n|\n[a-z]+\s*:|\n#|$)/m);
    assert.ok(buildRecipe, "Justfile must define a `build` recipe");
    assert.match(
      buildRecipe![1]!,
      /pnpm\b[\s\S]*\bbuild\b/,
      `Justfile \`build\` recipe must delegate via pnpm so both packages build, got:\n${buildRecipe![1]!}`,
    );
  });

  test("AGENTS.md repo structure section reflects the two-package layout", async () => {
    const agents = await readFile(path.join(REPO_ROOT, "AGENTS.md"), "utf8");

    // The repo-structure section must point at the package directories,
    // not the old `src/opencode/...` paths.
    assert.match(
      agents,
      /packages\/core\/src/,
      "AGENTS.md must reference packages/core/src in its repo structure section",
    );
    assert.match(
      agents,
      /packages\/opencode-agent-skills\/src/,
      "AGENTS.md must reference packages/opencode-agent-skills/src in its repo structure section",
    );
    assert.doesNotMatch(
      agents,
      /^src\/opencode\//m,
      "AGENTS.md must not describe legacy src/opencode/ paths (those moved into the plugin package)",
    );

    // The commands section must use `pnpm -r` for the umbrella commands
    // so a single command covers both packages.
    assert.match(
      agents,
      /pnpm\s+-r/,
      "AGENTS.md must reference `pnpm -r` so the umbrella commands cover both packages",
    );
  });

  test("both packages resolve from the repo root through the pnpm workspace link", async () => {
    // pnpm install wires the two packages into `node_modules/` as
    // symlinks so they resolve by name from the repo root. This is the
    // end-to-end "the workspace link is alive" check — a stale lockfile
    // or a typo in `pnpm-workspace.yaml` would surface here.
    const coreResolved = require.resolve("opencode-agent-skills-core");
    assert.match(
      coreResolved,
      /[\\/]packages[\\/]core[\\/]src[\\/]index\.ts$/,
      `expected opencode-agent-skills-core to resolve to packages/core/src/index.ts, got: ${coreResolved}`,
    );

    const pluginResolved = require.resolve("opencode-agent-skills");
    assert.match(
      pluginResolved,
      /[\\/]packages[\\/]opencode-agent-skills[\\/]src[\\/]index\.ts$/,
      `expected opencode-agent-skills to resolve to packages/opencode-agent-skills/src/index.ts, got: ${pluginResolved}`,
    );

    assert.ok(coreResolved.startsWith(REPO_ROOT), `core resolution must live under the repo root: ${coreResolved}`);
    assert.ok(
      pluginResolved.startsWith(REPO_ROOT),
      `plugin resolution must live under the repo root: ${pluginResolved}`,
    );
  });

  test("both packages' source trees exist at the documented paths", async () => {
    // Cross-check that the per-package sources are in place — without
    // these the workspace link above would resolve to nothing.
    const coreSrc = path.join(REPO_ROOT, "packages", "core", "src");
    const pluginSrc = path.join(REPO_ROOT, "packages", "opencode-agent-skills", "src");
    assert.ok(existsSync(coreSrc), `${coreSrc} must exist`);
    assert.ok(existsSync(pluginSrc), `${pluginSrc} must exist`);

    const coreSrcStat = await stat(coreSrc);
    const pluginSrcStat = await stat(pluginSrc);
    assert.ok(coreSrcStat.isDirectory(), `${coreSrc} must be a directory`);
    assert.ok(pluginSrcStat.isDirectory(), `${pluginSrc} must be a directory`);
  });

  test("`pnpm run typecheck` from the repo root exits 0 (both packages typecheck clean)", () => {
    // Triangulation: beyond the static `pnpm -r` script check above, the
    // strongest behavior contract is that the documented root command
    // actually works. A regression in the delegation (e.g. a typo, or a
    // package silently missing a `typecheck` script) would surface here.
    const result = spawnSync("pnpm", ["run", "typecheck"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 180_000,
    });

    assert.equal(
      result.status,
      0,
      `pnpm run typecheck from the repo root must exit 0. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  });

  test("`pnpm test` from the repo root executes both packages' test suites end-to-end", () => {
    // Triangulation: the umbrella `pnpm test` command must actually visit
    // both workspace packages — a typo in the delegation script or a
    // missing per-package `test` script would leave one suite silent.
    //
    // We deliberately do NOT assert exit code 0 here. The plugin package
    // carries two pre-existing env-dependent test failures (21-vs-26
    // user skills and `ast-grep` not installed; documented in the PR 2b
    // apply progress). Those existed before PR 3 and are not part of
    // this work — gating the root test on them would convert a known
    // local-only issue into a workspace-level red. We assert the
    // delegation reaches both packages; the per-package suites own the
    // exit-code contract.
    //
    // `--no-bail` lets pnpm continue past the first failing package so
    // the workspace contract test (this file) still runs even when the
    // plugin's pre-existing failures fire. The overall `pnpm test` exit
    // code is the conjunction of per-package results and the workspace
    // test result, which is the correct gate.
    const result = spawnSync("pnpm", ["-r", "--no-bail", "test"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 240_000,
    });

    const combined = `${result.stdout}\n${result.stderr}`;

    // pnpm prefixes each package's output with its directory path
    // (`packages/core test$ ...`, `packages/opencode-agent-skills test$ ...`).
    // Both prefixes appearing in the output is the strongest signal that
    // the delegation reached both packages.
    assert.match(
      combined,
      /packages\/core\b/,
      `pnpm test must execute the core package's test suite. output:\n${combined}`,
    );
    assert.match(
      combined,
      /packages\/opencode-agent-skills\b/,
      `pnpm test must execute the plugin package's test suite. output:\n${combined}`,
    );
  });
});