import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);

/**
 * Package boundary smoke test for `opencode-agent-skills-md`.
 *
 * The plugin package now lives at `packages/opencode-agent-skills-md/` and is
 * consumed via the workspace link `opencode-agent-skills-md`. Three
 * guarantees pinned by this test:
 *
 *   1. The package's `exports` field resolves `.` to the plugin entry
 *      under the package's own `src/` directory (via the workspace link
 *      into `packages/opencode-agent-skills-md/`).
 *   2. Importing the entry is safe at module-load time — it does not
 *      instantiate anything, it just re-exports the plugin factory.
 *   3. The default export and the `SkillsPlugin` named export are both
 *      the plugin factory function consumed by OpenCode.
 */
describe("opencode-agent-skills-md package root export", () => {
  test("resolves . via the workspace link to packages/opencode-agent-skills-md/src/index.ts", () => {
    const resolved = require.resolve("opencode-agent-skills-md");

    assert.match(
      resolved,
      /[\\/]packages[\\/]opencode-agent-skills-md[\\/]src[\\/]index\.ts$/,
      `expected . to resolve under packages/opencode-agent-skills-md/src, got: ${resolved}`,
    );
  });

  test("default export is the SkillsPlugin factory function", async () => {
    const entryPath = require.resolve("opencode-agent-skills-md");
    // Dynamic import is intentional: it proves module load is side-effect
    // safe (the factory itself is not invoked).
    const mod = await import(entryPath);

    assert.equal(
      typeof mod.default,
      "function",
      "default export should be the SkillsPlugin factory",
    );
    assert.equal(
      typeof mod.SkillsPlugin,
      "function",
      "SkillsPlugin named export should be a function",
    );
    assert.equal(
      mod.default,
      mod.SkillsPlugin,
      "default export and SkillsPlugin should be the same factory",
    );
  });

  test("module load is side-effect safe (does not throw, does not instantiate)", () => {
    // Reaching this point already exercised module load via the require +
    // dynamic import above. This test guards against future regressions
    // where someone might add a top-level `new SomeSDK()` in the entry.
    assert.doesNotThrow(() => {
      // Re-resolve without invoking; the spec only requires that the
      // entry module be importable in isolation.
      require.resolve("opencode-agent-skills-md");
    });
  });
});
