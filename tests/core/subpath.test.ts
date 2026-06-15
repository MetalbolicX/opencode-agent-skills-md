import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);

/**
 * Built-artifact smoke test for the `opencode-agent-skills/core` subpath.
 *
 * The core subpath exists for harness authors who want to reuse the
 * portable engine (skill discovery, parsing, resolution, scripts) without
 * pulling the OpenCode SDK. Three guarantees under test:
 *
 *   1. The package's `exports` field resolves `./core` to the built core
 *      chunk under `dist/core/`.
 *   2. The runtime entry exposes the public surface listed in
 *      `src/core/index.ts` (functions and types).
 *   3. Loading the core chunk does not transitively load
 *      `@opencode-ai/plugin` — proven by a static text walk over the
 *      emitted file (the same shape of check the agnostic test applies
 *      to the source under `src/core`).
 */
describe("opencode-agent-skills/core subpath export", () => {
  test("resolves ./core via the package exports field to dist/core/index.js", () => {
    const resolved = require.resolve("opencode-agent-skills/core");

    assert.match(
      resolved,
      /[\\/]dist[\\/]core[\\/]index\.js$/,
      `expected ./core to resolve under dist/core/, got: ${resolved}`
    );
  });

  test("exposes the portable core API as runtime exports", async () => {
    const core = await import("opencode-agent-skills/core");

    // Function exports from `src/core/index.ts`.
    assert.equal(typeof core.discoverAllSkills, "function");
    assert.equal(typeof core.parseSkillFile, "function");
    assert.equal(typeof core.resolveSkill, "function");
    assert.equal(typeof core.listSkillFiles, "function");
    assert.equal(typeof core.findScripts, "function");
    assert.equal(typeof core.findClosestMatch, "function");
    assert.equal(typeof core.renderAvailableSkillsBlock, "function");
    assert.equal(typeof core.parseYamlFrontmatter, "function");
  });

  test("does not transitively load @opencode-ai/plugin (static walk over dist)", async () => {
    const corePath = require.resolve("opencode-agent-skills/core");
    const source = await readFile(corePath, "utf8");

    // Strip block and line comments before scanning so a JSDoc reference
    // to the host SDK name doesn't trip the check.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    assert.equal(
      stripped.includes("@opencode-ai/plugin"),
      false,
      `dist/core/index.js must not reference the host SDK; offending source:\n${source}`
    );
  });
});
