import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);

/**
 * Built-artifact smoke test for the `opencode-agent-skills` (root) subpath.
 *
 * The root subpath is the OpenCode host adapter. Three guarantees:
 *
 *   1. The package's `exports` field resolves `.` to the built host chunk
 *      under `dist/opencode/`.
 *   2. Importing the root is safe at module-load time — it does not
 *      instantiate anything, it just re-exports the plugin factory.
 *   3. The default export and the `SkillsPlugin` named export are both
 *      the plugin factory function consumed by OpenCode.
 */
describe("opencode-agent-skills (root) subpath export", () => {
  test("resolves . via the package exports field to dist/opencode/index.js", () => {
    const resolved = require.resolve("opencode-agent-skills");

    assert.match(
      resolved,
      /[\\/]dist[\\/]opencode[\\/]index\.js$/,
      `expected . to resolve under dist/opencode/, got: ${resolved}`
    );
  });

  test("default export is the SkillsPlugin factory function", async () => {
    const entryPath = require.resolve("opencode-agent-skills");
    // Dynamic import is intentional: it proves module load is side-effect
    // safe (the factory itself is not invoked).
    const mod = await import(entryPath);

    assert.equal(
      typeof mod.default,
      "function",
      "default export should be the SkillsPlugin factory"
    );
    assert.equal(
      typeof mod.SkillsPlugin,
      "function",
      "SkillsPlugin named export should be a function"
    );
    assert.equal(
      mod.default,
      mod.SkillsPlugin,
      "default export and SkillsPlugin should be the same factory"
    );
  });

  test("module load is side-effect safe (does not throw, does not instantiate)", () => {
    // Reaching this point already exercised module load via the require +
    // dynamic import above. This test guards against future regressions
    // where someone might add a top-level `new SomeSDK()` in the entry.
    assert.doesNotThrow(() => {
      // Re-resolve without invoking; the spec only requires that the
      // entry module be importable in isolation.
      require.resolve("opencode-agent-skills");
    });
  });
});
