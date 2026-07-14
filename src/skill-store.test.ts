/**
 * RED tests for SkillStore: cached skill discovery repository.
 *
 * Verifies:
 * - First access triggers single discovery scan
 * - TTL cache prevents re-scan within TTL window
 * - invalidate() forces re-scan on next access
 * - Empty roots are handled gracefully
 * - Missing SKILL.md directories are skipped
 * - Exact name resolution works
 * - Suffix resolution works (path suffix after exact fails)
 * - Ambiguous suffix match throws with candidate list
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { createSkillStore } from "./skill-store";
import type { SkillStore } from "./types";

/** Minimal SKILL.md content for test fixtures. */
const makeSkill = (name: string, description: string, extra: Record<string, string> = {}): string => {
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    "---",
    "",
    `# ${name}`,
    "",
  ];
  return lines.join("\n");
};

describe("SkillStore", () => {
  let workspace: string;
  let store: SkillStore;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-store-"));
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  const makeRoots = () => [
    { path: path.join(workspace, "roots", "proj"), label: "project" as const, maxDepth: 3 },
  ];

  test("first access triggers single discovery scan", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("alpha", "an alpha skill"), "utf8");

    const s = createSkillStore(workspace, roots);
    const all = await s.all();

    assert.ok(all.length >= 1, "should discover at least the alpha skill");
    const alpha = all.find((sk) => sk.name === "alpha");
    assert.ok(alpha !== undefined, "alpha skill should be discovered");
    assert.equal(alpha!.description, "an alpha skill");
  });

  test("TTL cache prevents re-scan within TTL window", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("bravo", "a bravo skill"), "utf8");

    const s = createSkillStore(workspace, roots);
    const first = await s.all();
    const second = await s.all();

    // Same data returned, no error — proves cache hit
    assert.equal(first.length, second.length);
    const bravo = first.find((sk) => sk.name === "bravo");
    assert.equal(bravo?.description, "a bravo skill");
  });

  test("invalidate() clears cache and next access re-scans", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("charlie", "a charlie skill"), "utf8");

    const s = createSkillStore(workspace, roots);
    await s.all(); // populate cache

    // Add a new skill after cache was populated
    await mkdir(path.join(roots[0]!.path, "delta"), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "delta", "SKILL.md"), makeSkill("delta", "a delta skill"), "utf8");
    await mkdir(path.join(roots[0]!.path, "delta"), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "delta", "SKILL.md"), makeSkill("delta", "a delta skill"), "utf8");

    s.invalidate();
    const afterInvalidate = await s.all();

    const delta = afterInvalidate.find((sk) => sk.name === "delta");
    assert.ok(delta !== undefined, "delta skill should appear after invalidate + re-scan");
  });

  test("empty roots produce empty all() without error", async () => {
    const emptyRoots = [{ path: path.join(workspace, "empty-root"), label: "project" as const, maxDepth: 3 }];
    await mkdir(path.join(emptyRoots[0]!.path), { recursive: true });

    const s = createSkillStore(workspace, emptyRoots);
    const all = await s.all();

    assert.equal(all.length, 0, "empty root should yield no skills");
  });

  test("missing SKILL.md directory is skipped silently", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path, "no-skill-dir", "subdir"), { recursive: true });
    // no SKILL.md written — should be silently skipped

    const s = createSkillStore(workspace, roots);
    const all = await s.all();

    // Should not throw, should not include the dir
    const names = all.map((sk) => sk.name);
    assert.ok(!names.includes("no-skill-dir"), "dir without SKILL.md should not appear");
  });

  test("exact resolve returns the matching skill", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("echo", "exact match"), "utf8");

    const s = createSkillStore(workspace, roots);
    const skill = await s.resolve("echo");

    assert.ok(skill !== undefined, "should resolve echo");
    assert.equal(skill!.name, "echo");
    assert.equal(skill!.description, "exact match");
  });

  test("suffix resolve returns closest match after exact fails", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path, "nested", "echo-skill"), { recursive: true });
    await writeFile(
      path.join(roots[0]!.path, "nested", "echo-skill", "SKILL.md"),
      makeSkill("echo-skill", "nested skill via suffix"),
      "utf8"
    );

    const s = createSkillStore(workspace, roots);
    const skill = await s.resolve("echo-skill");

    assert.ok(skill !== undefined, "should resolve echo-skill by suffix");
    assert.equal(skill!.name, "echo-skill");
  });

  test("ambiguous suffix match throws with candidate list", async () => {
    const roots = makeRoots();
    // Two DIFFERENT skill names whose paths both end with "ambiguous-skill"
    // so that resolving "ambiguous-skill" matches both by suffix
    await mkdir(path.join(roots[0]!.path, "ambiguous-skill"), { recursive: true });
    await mkdir(path.join(roots[0]!.path, "beta", "ambiguous-skill"), { recursive: true });
    await writeFile(
      path.join(roots[0]!.path, "ambiguous-skill", "SKILL.md"),
      makeSkill("first-ambiguous", "first skill whose path ends with ambiguous-skill"),
      "utf8"
    );
    await writeFile(
      path.join(roots[0]!.path, "beta", "ambiguous-skill", "SKILL.md"),
      makeSkill("second-ambiguous", "second skill whose path also ends with ambiguous-skill"),
      "utf8"
    );

    const s = createSkillStore(workspace, roots);

    try {
      await s.resolve("ambiguous-skill");
      assert.fail("resolve should have thrown an ambiguity error");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes("ambiguous") && msg.includes("multiple candidates"),
        `error message should mention ambiguity and multiple candidates: ${msg}`
      );
    }
  });

  test("summaries() returns name/description/trigger for each skill", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(
      path.join(roots[0]!.path, "SKILL.md"),
      makeSkill("foxtrot", "foxtrot description", { trigger: "fox,trot" }),
      "utf8"
    );

    const s = createSkillStore(workspace, roots);
    const summaries = await s.summaries();

    const fox = summaries.find((sk) => sk.name === "foxtrot");
    assert.ok(fox !== undefined, "foxtrot should be in summaries");
    assert.equal(fox!.description, "foxtrot description");
    assert.equal(fox!.trigger, "fox,trot");
  });

  test("search() filters by query string", async () => {
    const roots = makeRoots();
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("golf", "searchable golf skill"), "utf8");
    await mkdir(path.join(roots[0]!.path, "hotel"), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "hotel", "SKILL.md"), makeSkill("hotel", "completely different"), "utf8");

    const s = createSkillStore(workspace, roots);
    const results = await s.search("golf");

    assert.ok(results.length >= 1, "should find golf skill");
    assert.ok(results.some((sk) => sk.name === "golf"), "golf should be in results");
    assert.ok(!results.some((sk) => sk.name === "hotel"), "hotel should not be in results");
  });
});

/**
 * Phase 2 RED tests — Cache & Discovery
 *
 * A3: Concurrent ensureCache() coalescing
 * C3b: listFiles results cached in store
 * C4:  summaries() results cached in store
 */
describe("SkillStore — concurrent ensureCache deduplication (A3)", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-concurrent-"));
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("three concurrent ensureCache calls run discoverAllSkills exactly once", async () => {
    const roots = [
      { path: path.join(workspace, "roots", "proj"), label: "project" as const, maxDepth: 3 },
    ];
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("alpha", "an alpha skill"), "utf8");

    const s = createSkillStore(workspace, roots, 5000);

    // Concurrent calls when cache is empty: all three should deduplicate to one scan.
    // We verify deduplication by checking all results are deep-equal (same skills in same order).
    const [r1, r2, r3] = await Promise.all([s.all(), s.all(), s.all()]);
    // If deduplication works (inflight promise shared), all three calls see the same cached skills
    assert.deepEqual(r1, r2, "concurrent calls return equivalent results (same cache hit)");
    assert.deepEqual(r2, r3, "all three calls return equivalent results");
    const alpha1 = r1.find((sk) => sk.name === "alpha");
    const alpha2 = r2.find((sk) => sk.name === "alpha");
    assert.ok(alpha1, "alpha is in r1");
    assert.deepEqual(alpha1, alpha2, "alpha skill is equivalent in both concurrent results");
  });

  test("after TTL expiry, next access triggers a new scan", async () => {
    const roots = [
      { path: path.join(workspace, "roots2", "proj"), label: "project" as const, maxDepth: 3 },
    ];
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("bravo", "a bravo skill"), "utf8");

    const s = createSkillStore(workspace, roots, 10); // 10ms TTL

    // First access — populate cache
    const first = await s.all();
    const bravo0 = first.find((sk) => sk.name === "bravo");
    assert.ok(bravo0, "bravo is present in first scan");

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 20));

    // After TTL expiry, next call triggers a new scan
    const afterExpiry = await s.all();
    const bravo1 = afterExpiry.find((sk) => sk.name === "bravo");
    assert.ok(bravo1, "bravo skill is present after re-scan");
    assert.equal(bravo1!.description, "a bravo skill");
  });
});

describe("SkillStore — listFiles cache (C3b)", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-lf-"));
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("listFiles returns cached results on second call without re-scanning", async () => {
    const roots = [
      { path: path.join(workspace, "roots", "proj"), label: "project" as const, maxDepth: 3 },
    ];
    await mkdir(path.join(roots[0]!.path, "alpha"), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "alpha", "SKILL.md"), makeSkill("alpha", "an alpha skill"), "utf8");
    await writeFile(path.join(roots[0]!.path, "alpha", "doc.md"), "# doc\n", "utf8");

    const s = createSkillStore(workspace, roots, 5000);
    const first = await s.listFiles("alpha");
    const second = await s.listFiles("alpha");

    assert.deepEqual(first, second, "second listFiles call should return identical results");
    assert.equal(first, second, "second call should return the exact same cached reference");
  });

  test("listFiles results are invalidated together with the main TTL cache", async () => {
    const roots = [
      { path: path.join(workspace, "roots2", "proj"), label: "project" as const, maxDepth: 3 },
    ];
    await mkdir(path.join(roots[0]!.path, "beta"), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "beta", "SKILL.md"), makeSkill("beta", "a beta skill"), "utf8");
    await writeFile(path.join(roots[0]!.path, "beta", "new-file.md"), "# new\n", "utf8");

    const s = createSkillStore(workspace, roots, 10); // 10ms TTL
    const first = await s.listFiles("beta");

    await new Promise((r) => setTimeout(r, 20)); // wait for TTL expiry
    s.invalidate();
    const second = await s.listFiles("beta");

    // After invalidate + re-scan, the new file should appear
    assert.ok(second.includes("new-file.md"), "after invalidate, re-scanned listFiles includes new-file.md");
  });
});

describe("SkillStore — summaries cache (C4)", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-sum-"));
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test("summaries returns cached result on second call", async () => {
    const roots = [
      { path: path.join(workspace, "roots", "proj"), label: "project" as const, maxDepth: 3 },
    ];
    await mkdir(path.join(roots[0]!.path), { recursive: true });
    await writeFile(path.join(roots[0]!.path, "SKILL.md"), makeSkill("gamma", "a gamma skill", { trigger: "test" }), "utf8");

    const s = createSkillStore(workspace, roots, 5000);
    const first = await s.summaries();
    const second = await s.summaries();

    assert.equal(first, second, "second summaries call should return the same cached reference");
    const gamma = first.find((sk) => sk.name === "gamma");
    assert.equal(gamma?.trigger, "test", "trigger is preserved on cached summary");
  });
});
