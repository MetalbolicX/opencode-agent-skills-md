import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const PKG_ENTRY = path.resolve(import.meta.dirname, "..", "src", "index.ts");
const SRC_DIR = path.resolve(import.meta.dirname, "..", "src");

/**
 * Runtime entry resolution test for the `opencode-agent-skills-md-core` package.
 *
 * This is the migrated form of the `opencode-agent-skills/core` subpath test
 * (see spec scenario "plugin-only dependency is blocked from core" in
 * `sdd/split-core-opencode-packages/spec`). The reusable engine is now
 * published under its own package name, so the assertions are renamed:
 *
 *   1. `require.resolve("opencode-agent-skills-md-core")` lands on the
 *      package's runtime entry (`packages/core/src/index.ts`).
 *   2. Importing the entry exposes the public API listed in
 *      `packages/core/src/index.ts`.
 *   3. The entry sources (and anything they pull in) contain no references
 *      to `@opencode-ai/plugin` — proven by walking the package's `src/`
 *      directory the same way the agnostic test does.
 */
describe("opencode-agent-skills-md-core runtime entry", () => {
  test("resolves opencode-agent-skills-md-core to packages/core/src/index.ts", () => {
    const resolved = require.resolve("opencode-agent-skills-md-core");

    assert.match(
      resolved,
      /[\\/]packages[\\/]core[\\/]src[\\/]index\.ts$/,
      `expected opencode-agent-skills-md-core to resolve to packages/core/src/index.ts, got: ${resolved}`
    );

    // Sanity: the entry file exists on disk and matches the resolved path.
    assert.equal(resolved, PKG_ENTRY);
  });

  test("exposes the portable core API as runtime exports", async () => {
    const core = await import("opencode-agent-skills-md-core");

    assert.equal(typeof core.discoverAllSkills, "function");
    assert.equal(typeof core.parseSkillFile, "function");
    assert.equal(typeof core.resolveSkill, "function");
    assert.equal(typeof core.listSkillFiles, "function");
    assert.equal(typeof core.findScripts, "function");
    assert.equal(typeof core.findClosestMatch, "function");
    assert.equal(typeof core.renderAvailableSkillsBlock, "function");
    assert.equal(typeof core.parseYamlFrontmatter, "function");
  });

  test("runtime entry sources contain no @opencode-ai/plugin references", async () => {
    // Walk the package's src/ directory the same way the agnostic test does.
    const { readdir, stat } = await import("node:fs/promises");
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
});