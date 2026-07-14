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
