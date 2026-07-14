/**
 * Tests for log module.
 *
 * Tests:
 *   - debugLog: no-throw invocation with various argument types
 *
 * Note: debugLog is a debug-gated console.error wrapper. The core behavior
 * (printing when env var is set) is exercised via integration tests.
 * These unit tests verify the function is callable and handles edge cases.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { debugLog } from "./log";

describe("debugLog", () => {
  test("does not throw when called with no arguments", () => {
    assert.doesNotThrow(() => debugLog());
  });

  test("does not throw when called with various argument types", () => {
    assert.doesNotThrow(() => debugLog("string"));
    assert.doesNotThrow(() => debugLog(123));
    assert.doesNotThrow(() => debugLog(null));
    assert.doesNotThrow(() => debugLog(undefined));
    assert.doesNotThrow(() => debugLog({ key: "value" }));
    assert.doesNotThrow(() => debugLog([1, 2, 3]));
    assert.doesNotThrow(() => debugLog("prefix", { obj: true }, 42, "suffix"));
  });

  test("returns undefined (void function)", () => {
    const result = debugLog("test message");
    assert.equal(result, undefined);
  });

  test("handles nested objects without throwing", () => {
    const nested = { level1: { level2: { level3: "deep" } }, arr: [1, 2, { nested: true }] };
    assert.doesNotThrow(() => debugLog(nested));
  });

  test("handles circular references without throwing", () => {
    // Circular reference
    const circular: Record<string, unknown> = { name: "circular" };
    circular.self = circular;
    assert.doesNotThrow(() => debugLog(circular));
  });
});
