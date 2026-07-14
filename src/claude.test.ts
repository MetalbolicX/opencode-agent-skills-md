/**
 * Tests for claude.ts — 6-root discovery + manifest validation.
 *
 * Tests discoverPluginCacheSkills(), discoverMarketplaceSkills(), and validateInstalledPlugins():
 * - Graceful empty return when directories don't exist
 * - Functions export correctly and return LabeledDiscoveryResult[]
 * - Correct label assignment
 * - validateInstalledPlugins: skips malformed entries, returns null on invalid root
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("discoverPluginCacheSkills", () => {
  test("function is exported and callable", async () => {
    const { discoverPluginCacheSkills } = await import("./claude");
    assert.equal(typeof discoverPluginCacheSkills, "function");
  });

  test("returns array of LabeledDiscoveryResult", async () => {
    const { discoverPluginCacheSkills } = await import("./claude");
    const result = await discoverPluginCacheSkills();
    assert.ok(Array.isArray(result), "must return an array");
  });

  test("returns empty array when cache directory does not exist", async () => {
    const { discoverPluginCacheSkills } = await import("./claude");
    // Use a guaranteed-nonexistent path
    const result = await discoverPluginCacheSkills();
    assert.ok(Array.isArray(result));
  });

  test("each result has correct label 'claude-plugin-cache'", async () => {
    const { discoverPluginCacheSkills } = await import("./claude");
    const result = await discoverPluginCacheSkills();
    for (const item of result) {
      assert.equal(item.label, "claude-plugin-cache");
    }
  });

  test("each result has filePath and relativePath fields", async () => {
    const { discoverPluginCacheSkills } = await import("./claude");
    const result = await discoverPluginCacheSkills();
    for (const item of result) {
      assert.ok("filePath" in item);
      assert.ok("relativePath" in item);
    }
  });
});

describe("discoverMarketplaceSkills", () => {
  test("function is exported and callable", async () => {
    const { discoverMarketplaceSkills } = await import("./claude");
    assert.equal(typeof discoverMarketplaceSkills, "function");
  });

  test("returns array of LabeledDiscoveryResult", async () => {
    const { discoverMarketplaceSkills } = await import("./claude");
    const result = await discoverMarketplaceSkills();
    assert.ok(Array.isArray(result), "must return an array");
  });

  test("returns empty array when marketplace directory does not exist", async () => {
    const { discoverMarketplaceSkills } = await import("./claude");
    const result = await discoverMarketplaceSkills();
    assert.ok(Array.isArray(result));
  });

  test("each result has correct label 'claude-marketplace'", async () => {
    const { discoverMarketplaceSkills } = await import("./claude");
    const result = await discoverMarketplaceSkills();
    for (const item of result) {
      assert.equal(item.label, "claude-marketplace");
    }
  });

  test("each result has filePath and relativePath fields", async () => {
    const { discoverMarketplaceSkills } = await import("./claude");
    const result = await discoverMarketplaceSkills();
    for (const item of result) {
      assert.ok("filePath" in item);
      assert.ok("relativePath" in item);
    }
  });
});

describe("validateInstalledPlugins — B1 runtime type guard", () => {
  test("validateInstalledPlugins is exported from claude.ts", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    assert.equal(typeof validateInstalledPlugins, "function");
  });

  test("returns null for non-object root (string)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins("not an object");
    assert.equal(result, null);
  });

  test("returns null for non-object root (array)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins(["array", "not", "object"]);
    assert.equal(result, null);
  });

  test("returns null for non-object root (null)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins(null);
    assert.equal(result, null);
  });

  test("returns null for non-object root (number)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins(42);
    assert.equal(result, null);
  });

  test("returns empty arrays for valid empty root", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({});
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("returns empty object for null fields (both null)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: null, installed: null });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("returns empty object when plugins is not an array", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: "not an array", installed: [] });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("returns empty object when installed is not an array", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: [], installed: "not an array" });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("skips v1 plugins missing name (null)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: [{ name: null, version: "1.0.0" }] });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("skips v1 plugins missing name (empty string)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: [{ name: "", version: "1.0.0" }] });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("skips v1 plugins with non-string name", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: [{ name: 123, version: "1.0.0" }] });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("keeps valid v1 plugins with name and optional version", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: [{ name: "valid-plugin", version: "1.2.3" }] });
    assert.deepEqual(result, { plugins: [{ name: "valid-plugin", version: "1.2.3" }], installed: [] });
  });

  test("keeps valid v1 plugins without version", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ plugins: [{ name: "valid-plugin" }] });
    assert.deepEqual(result, { plugins: [{ name: "valid-plugin", version: undefined }], installed: [] });
  });

  test("skips v2 entries missing plugin_id (null)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ installed: [{ plugin_id: null, version: "1.0.0" }] });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("skips v2 entries missing plugin_id (empty string)", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ installed: [{ plugin_id: "", version: "1.0.0" }] });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("skips v2 entries with non-string plugin_id", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ installed: [{ plugin_id: 999, version: "1.0.0" }] });
    assert.deepEqual(result, { plugins: [], installed: [] });
  });

  test("keeps valid v2 entries with plugin_id and optional fields", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({
      installed: [{ plugin_id: "org/plugin", installed_path: "/path/to", version: "2.0.0" }],
    });
    assert.deepEqual(result, {
      installed: [{ plugin_id: "org/plugin", installed_path: "/path/to", version: "2.0.0" }],
      plugins: [],
    });
  });

  test("keeps valid v2 entries without optional installed_path", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({ installed: [{ plugin_id: "org/plugin" }] });
    assert.deepEqual(result, {
      installed: [{ plugin_id: "org/plugin", installed_path: undefined, version: undefined }],
      plugins: [],
    });
  });

  test("handles mixed valid v1 and v2 entries", async () => {
    const { validateInstalledPlugins } = await import("./claude");
    const result = validateInstalledPlugins({
      plugins: [
        { name: "v1-valid", version: "1.0.0" },
        { name: "", version: "1.0.0" }, // invalid — skipped
        { name: "v1-valid-2" },
      ],
      installed: [
        { plugin_id: "org/plugin1", version: "2.0.0" },
        { plugin_id: "", version: "2.0.0" }, // invalid — skipped
        { plugin_id: "org/plugin2" },
      ],
    });
    assert.deepEqual(result, {
      plugins: [
        { name: "v1-valid", version: "1.0.0" },
        { name: "v1-valid-2", version: undefined },
      ],
      installed: [
        { plugin_id: "org/plugin1", version: "2.0.0", installed_path: undefined },
        { plugin_id: "org/plugin2", version: undefined, installed_path: undefined },
      ],
    });
  });
});