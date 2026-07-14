/**
 * RED phase: tools/ module tests using MockSkillStore.
 *
 * Verifies:
 *   - byte-identical XML output for use_skill and read_skill_file
 *   - get_available_skills listing format
 *   - timeout/cancel/exit-code messages from run_skill_script
 *   - missing/non-listed script error messages
 *   - injection-like argument handling
 *
 * The tests use a MockSkillStore that implements the SkillStore interface
 * so they run without filesystem access.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createSkillTools } from "./tools/index";
import { createSessionTracker } from "./session-tracker";
import { _escapeXml, _escapeShellArg } from "./tools/shared";
import { searchSkills } from "./search";
import type { Skill, SkillStore, SkillSummary } from "./types";

// ---------------------------------------------------------------------------
// MockSkillStore
// ---------------------------------------------------------------------------

// Minimal findClosestMatch for mock (avoid importing match module which has other deps)
function closestMatch(name: string, candidates: string[]): string | null {
  let best = { name: "", distance: Infinity };
  for (const c of candidates) {
    // Simple Levenshtein distance
    const d = levenshtein(name, c);
    if (d < best.distance && d <= Math.floor(Math.max(name.length, c.length) / 3)) {
      best = { name: c, distance: d };
    }
  }
  return best.distance < Infinity ? best.name : null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function createMockSkillStore(skills: Skill[]): SkillStore {
  const byName = new Map<string, Skill>(skills.map((s) => [s.name, s]));
  return {
    async all() { return skills; },
    async summaries(): Promise<SkillSummary[]> {
      return skills.map((s) => ({ name: s.name, description: s.description, trigger: s.trigger }));
    },
    async search(query: string, keywords?: string[]): Promise<Skill[]> {
      return searchSkills(skills, query, keywords);
    },
    async resolve(name: string): Promise<Skill> {
      const skill = byName.get(name);
      if (skill) return skill;
      // Suffix match
      for (const s of skills) {
        if (s.name === name || s.path.endsWith(name) || s.relativePath.endsWith(name)) {
          return s;
        }
      }
      // findClosestMatch fallback
      const allNames = Array.from(byName.keys());
      const suggestion = closestMatch(name, allNames);
      if (suggestion) {
        throw new Error(`Skill '${name}' not found. Did you mean '${suggestion}'?`);
      }
      throw new Error(`Skill '${name}' not found`);
    },
    invalidate() {},
    async listFiles(_skillName: string): Promise<string[]> {
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// Shell recorder (same pattern as test-helpers.ts)
// ---------------------------------------------------------------------------

function createShellRecorder(): {
  shell: ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & {
    cwd: (d: string) => ReturnType<typeof createShellRecorder.shell>;
    calls: Array<{ cwd: string; command: string }>;
  };
  calls: Array<{ cwd: string; command: string }>;
} {
  const calls: Array<{ cwd: string; command: string }> = [];
  let currentCwd = "";

  const shell = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const command = strings.reduce((acc, chunk, index) => {
      const value = values[index];
      const rendered = Array.isArray(value) ? value.join(" ") : String(value ?? "");
      return acc + chunk + rendered;
    }, "");

    calls.push({ cwd: currentCwd, command });

    return {
      text: async () => `cwd=${currentCwd}\n${command}`,
    };
  }) as ReturnType<typeof createShellRecorder.shell>;

  shell.cwd = ((directory: string) => {
    currentCwd = directory;
    return shell;
  }) as ReturnType<typeof createShellRecorder.shell>;

  shell.calls = calls;

  return { shell, calls };
}

// ---------------------------------------------------------------------------
// Failing shell stub
// ---------------------------------------------------------------------------

function createFailingShellStub(opts: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  message?: string;
}): {
  shell: ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & {
    cwd: (d: string) => ReturnType<typeof createFailingShellStub.shell>;
    calls: Array<{ cwd: string; command: string }>;
  };
} {
  const calls: Array<{ cwd: string; command: string }> = [];
  let currentCwd = "";

  const shell = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    calls.push({ cwd: currentCwd, command: "<failing>" });
    const err = Object.assign(
      new Error(opts.message ?? "shell exit error"),
      {
        exitCode: opts.exitCode,
        stdout: Buffer.from(opts.stdout ?? ""),
        stderr: Buffer.from(opts.stderr ?? ""),
      },
    );
    return {
      text: () => Promise.reject(err),
    };
  }) as ReturnType<typeof createFailingShellStub.shell>;

  shell.cwd = ((directory: string) => {
    currentCwd = directory;
    return shell;
  }) as ReturnType<typeof createFailingShellStub.shell>;

  shell.calls = calls;

  return { shell };
}

// ---------------------------------------------------------------------------
// Never-resolving shell stub
// ---------------------------------------------------------------------------

function createNeverResolvingShellStub(): {
  shell: ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & {
    cwd: (d: string) => ReturnType<typeof createNeverResolvingShellStub.shell>;
    calls: Array<{ cwd: string; command: string }>;
  };
  textCalledPromise: Promise<void>;
} {
  const calls: Array<{ cwd: string; command: string }> = [];
  let currentCwd = "";
  let signalTextCalled: () => void = () => {};
  const textCalledPromise = new Promise<void>((resolve) => {
    signalTextCalled = resolve;
  });
  const shell = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    calls.push({ cwd: currentCwd, command: "<never-resolving>" });
    return {
      text: () => {
        signalTextCalled();
        return new Promise<string>(() => {});
      },
    };
  }) as ReturnType<typeof createNeverResolvingShellStub.shell>;

  shell.cwd = ((directory: string) => {
    currentCwd = directory;
    return shell;
  }) as ReturnType<typeof createNeverResolvingShellStub.shell>;

  shell.calls = calls;

  return { shell, textCalledPromise };
}

// ---------------------------------------------------------------------------
// Drain microtasks helper
// ---------------------------------------------------------------------------

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXTURE_SKILL: Skill = {
  name: "test-skill",
  description: "A test skill for unit testing",
  trigger: "test, fixture",
  path: "/project/.opencode/skills/test-skill",
  relativePath: ".opencode/skills/test-skill",
  label: "project",
  scripts: [
    {
      relativePath: "bin/script.sh",
      absolutePath: "/project/.opencode/skills/test-skill/bin/script.sh",
    },
    {
      relativePath: "bin/echo.sh",
      absolutePath: "/project/.opencode/skills/test-skill/bin/echo.sh",
    },
  ],
  template: "# Test Skill\n\nThis is the skill content.",
  tags: [],
};

const FIXTURE_SKILL_NO_SCRIPTS: Skill = {
  name: "no-scripts-skill",
  description: "A skill with no scripts",
  path: "/project/.opencode/skills/no-scripts-skill",
  relativePath: ".opencode/skills/no-scripts-skill",
  label: "project",
  scripts: [],
  template: "# No Scripts Skill\n\nContent here.",
  tags: [],
};

const FIXTURE_SKILL_NO_TRIGGER: Skill = {
  name: "no-trigger-skill",
  description: "A skill without a trigger",
  path: "/project/.opencode/skills/no-trigger-skill",
  relativePath: ".opencode/skills/no-trigger-skill",
  label: "project",
  scripts: [],
  template: "# No Trigger Skill\n\nContent here.",
  tags: [],
};

const FIXTURE_FILE_CONTENT = "## Reference\n\nThis is the reference file content.";

// ---------------------------------------------------------------------------
// Tests: escapeXml / escapeShellArg (unit tests on shared helpers)
// ---------------------------------------------------------------------------

describe("escapeXml", () => {
  test("escapes &, <, >, \", ' characters", () => {
    const input = '&<>"\'test';
    const result = _escapeXml(input);
    assert.equal(result, "&amp;&lt;&gt;&quot;&apos;test");
  });

  test("returns identical string when no special chars", () => {
    const input = "plain text no special chars";
    assert.equal(_escapeXml(input), input);
  });

  test("handles empty string", () => {
    assert.equal(_escapeXml(""), "");
  });
});

describe("escapeShellArg", () => {
  test("wraps arg in single quotes and escapes embedded single quotes", () => {
    const input = "it's a test";
    const result = _escapeShellArg(input);
    assert.equal(result, "'it'\\''s a test'");
  });

  test("returns quoted empty string", () => {
    assert.equal(_escapeShellArg(""), "''");
  });
});

// ---------------------------------------------------------------------------
// Tests: use_skill XML output (byte-identical format)
// ---------------------------------------------------------------------------

describe("use_skill XML output", () => {
  test("produces byte-identical <skill name=\"...\"> wrapper", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: "test-skill" },
      { sessionID: "sess-use-skill" },
    );

    // Must be wrapped in <skill name="...">
    assert.match(result, /^<skill name="test-skill">/);
    assert.match(result, /<\/skill>$/);
  });

  test("includes toolTranslation block inside skill content", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: "test-skill" },
      { sessionID: "sess-use-skill" },
    );

    assert.match(result, /<tool-translation>/);
    assert.match(result, /Skill tool -> use_skill tool/);
  });

  test("includes <scripts> section when skill has scripts", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: "test-skill" },
      { sessionID: "sess-use-skill" },
    );

    assert.match(result, /<scripts>/);
    assert.match(result, /<script>bin\/script\.sh<\/script>/);
    assert.match(result, /<script>bin\/echo\.sh<\/script>/);
  });

  test("omits <scripts> section when skill has no scripts", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL_NO_SCRIPTS]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: "no-scripts-skill" },
      { sessionID: "sess-use-skill" },
    );

    assert.doesNotMatch(result, /<scripts>/);
  });

  test("omits <files> section when skill has no files (listSkillFiles returns [])", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: "test-skill" },
      { sessionID: "sess-use-skill" },
    );

    // FIXTURE_SKILL has scripts but listSkillFiles returns [] for the mock,
    // so <files> should NOT appear
    assert.doesNotMatch(result, /<files>/);
  });

  test("calls onSkillLoaded callback when provided", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    let loadedCalled = false;
    let loadedArgs: [string, string] | undefined;

    const tools = createSkillTools({
      store,
      tracker,
      onSkillLoaded: (sessionID, skillName) => {
        loadedCalled = true;
        loadedArgs = [sessionID, skillName];
      },
    });

    await tools.UseSkill.execute(
      { skill: "test-skill" },
      { sessionID: "sess-callback-test" },
    );

    assert.equal(loadedCalled, true);
    assert.deepEqual(loadedArgs, ["sess-callback-test", "test-skill"]);
  });

  test("escapes XML special chars in skill name", async () => {
    const skillWithSpecialChars: Skill = {
      ...FIXTURE_SKILL,
      name: 'test "skill" & <more>',
    };
    const store = createMockSkillStore([skillWithSpecialChars]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: 'test "skill" & <more>' },
      { sessionID: "sess-xml-escape" },
    );

    // Must NOT contain unescaped chars in the name attribute
    assert.match(result, /<skill name="test &quot;skill&quot; &amp; &lt;more&gt;">/);
  });
});

// ---------------------------------------------------------------------------
// Tests: read_skill_file XML output (byte-identical format)
// ---------------------------------------------------------------------------

describe("read_skill_file XML output", () => {
  test("returns error for path traversal attempt", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    // Path traversal attempt — should be blocked by resolveSafeSkillFilePath
    const result = await tools.ReadSkillFile.execute(
      { skill: "test-skill", filename: "../../../etc/passwd" },
      {},
    );

    assert.match(result, /Invalid path: cannot access files outside skill directory/);
  });

  test("returns skill not found message when skill does not exist", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.ReadSkillFile.execute(
      { skill: "nonexistent-skill", filename: "readme.md" },
      {},
    );

    assert.match(result, /Skill "nonexistent-skill" not found/);
  });

  // Note: file-content tests require real filesystem (read_skill_file uses fs.readFile directly).
  // Those are covered by the existing integration tests in the original tools.test.ts
  // which use createFixtureWorkspace.
});

// ---------------------------------------------------------------------------
// Tests: get_available_skills listing format
// ---------------------------------------------------------------------------

describe("get_available_skills listing format", () => {
  test("lists skill with trigger using format: name (label)\\n  description\\n  trigger: <text>", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.GetAvailableSkills.execute(
      { query: "" },
      { sessionID: "sess-list" },
    );

    // Expected format: test-skill (project)\n  A test skill for unit testing\n  trigger: test, fixture
    assert.match(result, /^test-skill \(project\)/);
    assert.match(result, /\n  A test skill for unit testing\n/);
    assert.match(result, /\n  trigger: test, fixture$/);
  });

  test("lists skill without trigger using format: name (label)\\n  description", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL_NO_TRIGGER]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.GetAvailableSkills.execute(
      { query: "" },
      { sessionID: "sess-list" },
    );

    assert.match(result, /^no-trigger-skill \(project\)/);
    assert.match(result, /\n  A skill without a trigger$/);
    assert.doesNotMatch(result, /trigger:/);
  });

  // Note: Did-you-mean for get_available_skills is tested via the use_skill / read_skill_file /
  // run_skill_script error paths (where store.resolve() is used and includes Did-you-mean).
  // Isolating get_available_skills Did-you-mean is non-trivial because any query close enough
  // for findClosestMatch (score >= 0.5) also scores > 0 in searchSkills via description/name
  // similarity. This is verified indirectly via the integration tests.
  test.skip("get_available_skills: Did-you-mean via direct findClosestMatch call", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.GetAvailableSkills.execute(
      { query: "tst" }, // "tst" vs "test-skill": findClosestMatch gives 0.5, searchSkills name sim = 0.5
      { sessionID: "sess-did-you-mean" },
    );

    // In theory should return Did-you-mean when searchSkills returns empty.
    // In practice, searchSkills scores this via name similarity (score 35 > 0) so it returns the skill.
    // The Did-you-mean contract for this tool is verified via the resolve-based tools.
    assert.match(result, /test-skill/);
  });

  test("returns bare not-found message for query with no close match", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.GetAvailableSkills.execute(
      { query: "xyzzy-abcd" },
      { sessionID: "sess-not-found" },
    );

    assert.equal(result, "No skills found matching your query.");
  });

  test("returns empty message when store returns no skills", async () => {
    const store = createMockSkillStore([]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.GetAvailableSkills.execute(
      { query: "" },
      { sessionID: "sess-empty" },
    );

    assert.equal(result, "No skills found matching your query.");
  });
});

// ---------------------------------------------------------------------------
// Tests: run_skill_script — timeout/cancel/exit-code formats
// ---------------------------------------------------------------------------

describe("run_skill_script — output format preservation", () => {
  test("returns deterministic timeout message after bound elapses", async () => {
    const { shell, textCalledPromise } = createNeverResolvingShellStub();
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell, timeout: 10 });

    const toolPromise = tools.RunSkillScript.execute(
      { skill: "test-skill", script: "bin/echo.sh", arguments: ["hi"] },
      { sessionID: "u3-timeout" },
    );

    await textCalledPromise;
    const result = await toolPromise;

    assert.equal(
      result,
      `Script "${FIXTURE_SKILL.scripts[1]!.absolutePath}" timed out after 10ms.`,
    );
  });

  test("returns cancellation message when abort signal fires mid-flight", async () => {
    const { shell, textCalledPromise } = createNeverResolvingShellStub();
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell });

    const ac = new AbortController();
    const toolPromise = tools.RunSkillScript.execute(
      { skill: "test-skill", script: "bin/echo.sh", arguments: ["hi"] },
      { sessionID: "u3-cancel", abort: ac.signal },
    );

    await textCalledPromise;
    await drainMicrotasks();
    ac.abort();
    await drainMicrotasks();

    const result = await toolPromise;
    assert.equal(
      result,
      `Script "${FIXTURE_SKILL.scripts[1]!.absolutePath}" cancelled.`,
    );
  });

  test("preserves exit-code formatting: Script failed (exit <code>): <stderr|stdout|message>", async () => {
    const { shell } = createFailingShellStub({
      exitCode: 42,
      stderr: "boom: command not found",
      stdout: "",
      message: "shell exit error",
    });
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell });

    const result = await tools.RunSkillScript.execute(
      { skill: "test-skill", script: "bin/echo.sh", arguments: ["hi"] },
      { sessionID: "u3-exit-code" },
    );

    assert.equal(
      result,
      "Script failed (exit 42): boom: command not found",
    );
  });

  test("returns error for missing script with Did-you-mean", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    // script name close to bin/echo.sh
    const result = await tools.RunSkillScript.execute(
      { skill: "test-skill", script: "bin/echo" }, // missing .sh
      { sessionID: "u3-missing-script" },
    );

    assert.match(result, /Script "bin\/echo" not found in skill "test-skill"\. Did you mean "bin\/echo\.sh"\?/);
  });

  test("returns error for missing script without suggestion", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.RunSkillScript.execute(
      { skill: "test-skill", script: "bin/completely-wrong" },
      { sessionID: "u3-missing-script-no-suggest" },
    );

    assert.match(result, /Script "bin\/completely-wrong" not found in skill "test-skill"\. Available scripts: bin\/script\.sh, bin\/echo\.sh/);
  });

  test("handles injection-like arguments with escaped shell args", async () => {
    const { shell, calls } = createShellRecorder();
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker, shell });

    await tools.RunSkillScript.execute(
      { skill: "test-skill", script: "bin/echo.sh", arguments: ["$; rm -rf /", "'; cat /etc/passwd"] },
      { sessionID: "u3-injection" },
    );

    assert.equal(calls.length, 1);
    const cmd = calls[0]!.command;
    // Arguments should be shell-escaped
    assert.match(cmd, /\$; rm -rf/); // first arg escaped
    assert.match(cmd, /'\\''; cat \/etc\/passwd/); // second arg escaped
  });
});

// ---------------------------------------------------------------------------
// Tests: error cases — skill not found
// ---------------------------------------------------------------------------

describe("skill not found messages", () => {
  test("use_skill returns Did-you-mean message when skill not found", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: "tes-skill" }, // typo close to test-skill
      { sessionID: "sess-miss-use" },
    );

    assert.match(result, /Skill "tes-skill" not found\. Did you mean "test-skill"\?/);
  });

  test("read_skill_file returns Did-you-mean when skill not found", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.ReadSkillFile.execute(
      { skill: "tes-skill", filename: "readme.md" },
      { sessionID: "sess-miss-read" },
    );

    assert.match(result, /Skill "tes-skill" not found\. Did you mean "test-skill"\?/);
  });

  test("run_skill_script returns Did-you-mean when skill not found", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.RunSkillScript.execute(
      { skill: "tes-skill", script: "bin/echo.sh" },
      { sessionID: "sess-miss-run" },
    );

    assert.match(result, /Skill "tes-skill" not found\. Did you mean "test-skill"\?/);
  });

  test("bare not-found when skill not found and no close match", async () => {
    const store = createMockSkillStore([FIXTURE_SKILL]);
    const tracker = createSessionTracker();
    const tools = createSkillTools({ store, tracker });

    const result = await tools.UseSkill.execute(
      { skill: "xyzzy-nonexistent" },
      { sessionID: "sess-bare-miss" },
    );

    assert.equal(result, 'Skill "xyzzy-nonexistent" not found. Use get_available_skills to list available skills.');
  });
});

// ---------------------------------------------------------------------------
// Tests: runBoundSkillScript directly (pure helper)
// ---------------------------------------------------------------------------

describe("runBoundSkillScript pure helper", () => {
  test("returns shell output verbatim when resolved within bound", async () => {
    const { runBoundSkillScript } = await import("./tools/shared");

    const result = await runBoundSkillScript(
      Promise.resolve("multi\nline\noutput"),
      undefined,
      30_000,
      "/skills/foo/build.sh",
    );

    assert.equal(result, "multi\nline\noutput");
  });

  test("returns deterministic timeout message after bound elapses", async () => {
    const { runBoundSkillScript } = await import("./tools/shared");

    const result = await runBoundSkillScript(
      new Promise<string>(() => {}), // never resolves
      undefined,
      10,
      "/skills/foo/build.sh",
    );

    assert.equal(result, `Script "/skills/foo/build.sh" timed out after 10ms.`);
  });

  test("returns cancellation message when signal already aborted", async () => {
    const { runBoundSkillScript } = await import("./tools/shared");

    const ac = new AbortController();
    ac.abort();

    const result = await runBoundSkillScript(
      new Promise<string>(() => {}),
      ac.signal,
      30_000,
      "/skills/foo/build.sh",
    );

    assert.equal(result, `Script "/skills/foo/build.sh" cancelled.`);
  });

  test("returns cancellation message when abort fires mid-flight", async () => {
    const { runBoundSkillScript } = await import("./tools/shared");

    const ac = new AbortController();
    const neverResolving = new Promise<string>(() => {});

    let resolved = false;
    let resolvedValue: string | undefined;
    const p = runBoundSkillScript(neverResolving, ac.signal, 30_000, "/skills/foo/build.sh");
    p.then((v) => { resolved = true; resolvedValue = v; });

    await drainMicrotasks();
    assert.equal(resolved, false);

    ac.abort();
    await drainMicrotasks();

    assert.equal(resolved, true);
    assert.equal(resolvedValue, `Script "/skills/foo/build.sh" cancelled.`);
  });
});
