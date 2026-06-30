# Plan 002: Harden `isPathSafe` against symlink escapes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fb45791..HEAD -- packages/core/src/scripts.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `fb45791`, 2026-06-29

## Why this matters

`isPathSafe` in `packages/core/src/scripts.ts:64-66` guards the path check for
`read_skill_file` and `run_skill_script` (called at `tools.ts:196`). It uses
`path.resolve` + `startsWith` which does NOT resolve symlinks. A malicious
skill containing a symlink pointing outside its directory (e.g.,
`ln -s /etc/passwd secrets.txt`) would pass the guard. The real path would
escape the skill directory, leaking arbitrary file content to the LLM session.

## Current state

`packages/core/src/scripts.ts:64-66`:
```ts
export function isPathSafe(basePath: string, requestedPath: string): boolean {
  const resolved = path.resolve(basePath, requestedPath);
  return resolved.startsWith(basePath + path.sep) || resolved === basePath;
}
```

This uses `path.resolve` which does NOT canonicalize symlinks. The fix is to
use `fs.realpath` on both paths and compare the resolved real paths.

Testing conventions (see `packages/core/tests/agnostic.test.ts`):
- `import assert from "node:assert/strict"`
- `import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises"`
- Tests create temp workspaces with `mkdtemp` and clean up in `after` blocks
- The shared walker tests are in `packages/core/tests/discovery.test.ts`

The `symlink` function from `node:fs/promises` is available — use it to create
test symlinks. For the realpath call, `fs.realpath` returns the canonical path.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `pnpm run typecheck`               | exit 0, no errors   |
| Core test | `pnpm -F opencode-agent-skills-md-core exec node --import tsx --test tests/scripts.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/core/src/scripts.ts` — add realpath-based safety check
- `packages/core/tests/scripts.test.ts` — create test file (if it doesn't exist) or add to existing test

**Out of scope** (do NOT touch):
- `packages/opencode-agent-skills-md/src/tools.ts` — the call site doesn't change
- Other core source files or test files
- The existing `isPathSafe` export and signature must stay the same

## Git workflow

- Branch: `advisor/002-is-path-safe`
- Commit per logical step; message style: conventional commits
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Harden `isPathSafe` in `scripts.ts`

Modify `packages/core/src/scripts.ts` to import `fs.realpath` and use it
inside `isPathSafe`:

```ts
import * as fs from "node:fs/promises";  // already imported

export async function isPathSafe(basePath: string, requestedPath: string): Promise<boolean> {
  const resolved = path.resolve(basePath, requestedPath);
  try {
    const resolvedReal = await fs.realpath(resolved);
    const baseReal = await fs.realpath(basePath);
    return resolvedReal.startsWith(baseReal + path.sep) || resolvedReal === baseReal;
  } catch {
    return false;  // ENOENT on the requested path means we can't verify safety
  }
}
```

**Key changes**:
1. Add `async` to the function signature — it now returns `Promise<boolean>`.
2. Use `fs.realpath` on both `resolved` and `basePath` to resolve symlinks.
3. Compare the resolved real paths instead of the logical paths.
4. `catch` returns `false` (can't verify safety of a missing/broken path).

**Verify**: `grep 'async function isPathSafe' packages/core/src/scripts.ts` → matches

### Step 2: Update all callers of `isPathSafe`

Find every call to `isPathSafe` in the codebase and add `await` since the
function is now async:

1. `packages/opencode-agent-skills-md/src/tools.ts:196`:
   Change `if (!isPathSafe(skill.path, args.filename))` to
   `if (!(await isPathSafe(skill.path, args.filename)))`

**Verify**: `grep -rn 'isPathSafe' packages/` — all uses should have `await`

### Step 3: Update the `index.ts` re-export if `isPathSafe` is there

Check `packages/core/src/index.ts` — if `isPathSafe` is re-exported, no change
needed (the export is still valid, just the return type changed to
`Promise<boolean>`).

**Verify**: `grep 'isPathSafe' packages/core/src/index.ts` — should still export it

### Step 4: Typecheck

**Verify**: `pnpm run typecheck` → exit 0, no errors

### Step 5: Create/update tests

Create `packages/core/tests/scripts.test.ts` following the existing test
pattern from `packages/core/tests/discovery.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";

describe("isPathSafe", () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "ispathsafe-"));
    await mkdir(path.join(workspace, "skill"), { recursive: true });
    await mkdir(path.join(workspace, "other"), { recursive: true });
    // Create a real file inside the skill directory
    await writeFile(path.join(workspace, "skill", "real-file.txt"), "safe", "utf8");
    // Create a symlink inside skill that points outside
    await symlink(
      path.join(workspace, "other", "outside.txt"),
      path.join(workspace, "skill", "bad-link.txt")
    );
    // Create a file outside that the symlink targets
    await writeFile(path.join(workspace, "other", "outside.txt"), "leaked", "utf8");
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  // Dynamic import to get the async function
  const importModule = async () => import("../src/scripts");

  test("allows files within the skill directory", async () => {
    const { isPathSafe } = await importModule();
    const result = await isPathSafe(path.join(workspace, "skill"), "real-file.txt");
    assert.equal(result, true);
  });

  test("allows the base path itself", async () => {
    const { isPathSafe } = await importModule();
    const result = await isPathSafe(path.join(workspace, "skill"), "");
    assert.equal(result, true);
  });

  test("rejects path traversal with ..", async () => {
    const { isPathSafe } = await importModule();
    const result = await isPathSafe(path.join(workspace, "skill"), "../other/outside.txt");
    assert.equal(result, false);
  });

  test("rejects symlink that points outside the skill directory", async () => {
    const { isPathSafe } = await importModule();
    const result = await isPathSafe(path.join(workspace, "skill"), "bad-link.txt");
    assert.equal(result, false);
  });

  test("rejects non-existent paths", async () => {
    const { isPathSafe } = await importModule();
    const result = await isPathSafe(path.join(workspace, "skill"), "does-not-exist.txt");
    assert.equal(result, false);
  });
});
```

**Verify**: `pnpm -F opencode-agent-skills-md-core exec node --import tsx --test tests/scripts.test.ts` → all 5 tests pass

### Step 6: Run full test suite

**Verify**: `pnpm test` → exit 0, all tests pass

## Test plan

- **New file**: `packages/core/tests/scripts.test.ts` with 5 test cases:
  1. Happy path: file within skill directory is allowed
  2. Edge case: the base path itself is allowed
  3. Regression: `..` traversal is blocked
  4. Security: symlink escape is blocked (the core reason for this plan)
  5. Edge case: non-existent paths return `false`
- Model after `packages/core/tests/discovery.test.ts` for structure

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `isPathSafe` is async and returns `Promise<boolean>`
- [ ] `isPathSafe` uses `fs.realpath` to resolve symlinks before comparing
- [ ] All callers use `await` with `isPathSafe`
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm test` exits 0; new tests for symlink safety exist and pass
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code in `scripts.ts` at the locations above doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- You discover that `fs.realpath` is not available in Node ≥18 (it is available since Node 10).
- `isPathSafe` is exported from `packages/core/src/index.ts` and changing its return type breaks the plugin package's typecheck (it should not, since all callers are in async functions).

## Maintenance notes

- If `isPathSafe` is called from synchronous contexts in the future, the
  caller will need to handle the `Promise<boolean>` return.
- The `fs.realpath` approach handles dangling symlinks correctly (ENOENT → `false`).
- Revisit if Node introduces a `fs.realpathSync` variant with better performance
  for hot paths (currently `isPathSafe` is called on every `read_skill_file` invocation).
