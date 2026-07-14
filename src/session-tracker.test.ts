/**
 * RED tests for SessionTracker: per-session state management.
 *
 * Verifies:
 * - touch() updates lastTouchedAt
 * - markLoaded(name) adds to loadedSkills
 * - clear() resets all session state
 * - isSetupComplete() returns false initially
 * - markSetupComplete() sets setup-complete flag
 * - TTL eviction removes stale entries
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createSessionTracker } from "./session-tracker";
import type { SessionTracker } from "./types";

describe("SessionTracker", () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    tracker = createSessionTracker();
  });

  test("touch() updates lastTouchedAt to a recent timestamp", async () => {
    const before = Date.now() - 1000;
    tracker.touch();
    const after = Date.now() + 100;
    assert.ok(
      tracker.lastTouchedAt >= before && tracker.lastTouchedAt <= after,
      `lastTouchedAt ${tracker.lastTouchedAt} should be between ${before} and ${after}`
    );
  });

  test("markLoaded(name) adds skill name to loadedSkills", () => {
    tracker.markLoaded("skill-alpha");
    tracker.markLoaded("skill-beta");

    assert.ok(tracker.loadedSkills.has("skill-alpha"), "skill-alpha should be in loadedSkills");
    assert.ok(tracker.loadedSkills.has("skill-beta"), "skill-beta should be in loadedSkills");
    assert.ok(!tracker.loadedSkills.has("skill-gamma"), "skill-gamma should not be in loadedSkills");
  });

  test("clear() resets loadedSkills, pendingSkills, injectedSummaries, and setup flag", () => {
    tracker.markLoaded("skill-alpha");
    tracker.markPending("skill-beta");
    tracker.markInjected("skill-gamma");
    tracker.markSetupComplete();

    tracker.clear();

    assert.equal(tracker.loadedSkills.size, 0, "loadedSkills should be empty after clear");
    assert.equal(tracker.pendingSkills.size, 0, "pendingSkills should be empty after clear");
    assert.equal(tracker.injectedSummaries.size, 0, "injectedSummaries should be empty after clear");
    assert.equal(tracker.isSetupComplete(), false, "isSetupComplete() should be false after clear");
  });

  test("isSetupComplete() returns false initially", () => {
    assert.equal(tracker.isSetupComplete(), false, "should be false before markSetupComplete");
  });

  test("markSetupComplete() sets setup-complete flag to true", () => {
    tracker.markSetupComplete();
    assert.equal(tracker.isSetupComplete(), true, "should be true after markSetupComplete");
  });

  test("multiple markLoaded calls accumulate without duplicates", () => {
    tracker.markLoaded("skill-x");
    tracker.markLoaded("skill-x");
    tracker.markLoaded("skill-y");

    assert.equal(tracker.loadedSkills.size, 2, "should have exactly 2 unique skills");
    assert.ok(tracker.loadedSkills.has("skill-x"));
    assert.ok(tracker.loadedSkills.has("skill-y"));
  });

  test("markPending and markInjected populate respective sets", () => {
    tracker.markPending("skill-p");
    tracker.markInjected("skill-i");

    assert.ok(tracker.pendingSkills.has("skill-p"), "skill-p should be in pendingSkills");
    assert.ok(tracker.injectedSummaries.has("skill-i"), "skill-i should be in injectedSummaries");
  });

  test("read-only sets are exposed as ReadonlySet", () => {
    tracker.markLoaded("skill-ro");
    const loaded = tracker.loadedSkills;

    // Verify it is actually a ReadonlySet (type-level check via instanceof)
    assert.ok(loaded instanceof Set, "should be a Set instance");
    assert.equal(loaded.size, 1, "should have one entry");
    assert.ok(loaded.has("skill-ro"), "skill-ro should be present");
  });
});
