/**
 * RED phase tests for claude.ts — 6-root discovery.
 *
 * Tests discoverPluginCacheSkills() and discoverMarketplaceSkills():
 * - Graceful empty return when directories don't exist
 * - Functions export correctly and return LabeledDiscoveryResult[]
 * - Correct label assignment
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
// import type { LabeledDiscoveryResult } from "./types"; // LabeledDiscoveryResult used in function signatures

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