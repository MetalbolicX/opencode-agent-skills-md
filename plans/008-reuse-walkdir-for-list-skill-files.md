# Plan 008: Reuse the shared walker in `listSkillFiles`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop
> and report instead of improvising. When done, update the status row for
> this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9c57cb0..HEAD -- packages/core/src/discovery.ts packages/core/src/walk.ts packages/core/tests/discovery.test.ts`
> If any in-scope file changed since this plan was written, compare the
> Current state excerpts below against live code first. Any mismatch is a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `9c57cb0`, 2026-07-03

## Why this matters

`listSkillFiles()` reimplements recursive traversal instead of using the shared
`walkDir()` utility that already defines the repo's skip rules and
error-isolation behavior. That duplication means `listSkillFiles()` can descend
into hidden directories, `.git`, and `node_modules`, and it pays an extra
`stat()` per entry. The fix is a small consolidation onto the existing
abstraction.

## Current state

- `packages/core/src/discovery.ts` — skill discovery helpers, including `listSkillFiles()`
- `packages/core/src/walk.ts` — shared recursive walker already used by `findSkillsRecursive()` and `findScripts()`
- `packages/core/tests/discovery.test.ts` — existing walker/discovery tests; no direct `listSkillFiles()` coverage

Relevant excerpts:

- `packages/core/src/discovery.ts:202-233`
  - `listSkillFiles()` uses a private `recurse()` function
  - calls `fs.readdir(..., { withFileTypes: true })`
  - then immediately calls `fs.stat(fullPath)` for every entry
  - does not apply `walkDir()` skip rules
- `packages/core/src/walk.ts:4-16`
  - `walkDir()` owns shared traversal rules: hidden dirs, `node_modules`, `.git` are skipped
  - per-entry failures are isolated
- `packages/core/tests/discovery.test.ts:82-161`
  - direct tests already pin `walkDir()` skip behavior
- `packages/core/tests/discovery.test.ts:163-252`
  - `findSkillsRecursive()` already proves the walker-based pattern

Conventions to match:

- Keep the core package host-agnostic and dependency-free
- Prefer the smallest correct refactor
- Preserve sorted output and graceful handling of missing directories

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Targeted tests | `pnpm -F opencode-agent-skills-md-core exec node --import tsx --test tests/discovery.test.ts` | all pass |
| Full tests | `pnpm test` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/core/src/discovery.ts`
- `packages/core/tests/discovery.test.ts`

**Out of scope**:
- `packages/core/src/walk.ts` behavior changes
- `findScripts()` performance cleanup
- Plugin package source changes

## Git workflow

- Branch: `advisor/008-reuse-walkdir-for-list-skill-files`
- Commit style: conventional commits, for example `refactor(core): reuse walkDir in listSkillFiles`
- Do NOT push or open a PR unless instructed

## Steps

### Step 1: Add direct characterization tests for `listSkillFiles()`

Extend `packages/core/tests/discovery.test.ts` with a dedicated `describe("listSkillFiles", ...)`.

Build a temp skill tree that includes:
- `SKILL.md`
- visible nested files that should be returned
- `.hidden/`
- `node_modules/`
- `.git/`
- a nested depth boundary case

Assert:
- `SKILL.md` is excluded
- visible files are returned as sorted relative paths
- hidden, `.git`, and `node_modules` contents are not returned
- missing base directory returns `[]`

Model setup style after the existing `walkDir` and `findSkillsRecursive` tests.

**Verify**: `pnpm -F opencode-agent-skills-md-core exec node --import tsx --test tests/discovery.test.ts` → the new tests fail before the refactor

### Step 2: Rewrite `listSkillFiles()` onto `walkDir()`

Modify `packages/core/src/discovery.ts`.

Target shape:

- import and reuse `walkDir()` instead of the bespoke `recurse()` implementation
- in the visitor:
  - ignore directories
  - ignore `SKILL.md`
  - compute relative paths from `skillPath`
  - push file paths only for visible files the walker surfaces
- keep sorted return order
- preserve graceful behavior when `skillPath` does not exist

Do not change other discovery helpers in this plan.

**Verify**: `pnpm -F opencode-agent-skills-md-core exec node --import tsx --test tests/discovery.test.ts` → all tests pass

### Step 3: Run repo verification

**Verify**:
- `pnpm run typecheck` → exit 0
- `pnpm test` → exit 0
- `git status --short` → only the two in-scope files plus `plans/README.md`

## Test plan

Extend `packages/core/tests/discovery.test.ts`. Reuse the same temp-directory style already used by `walkDir` / `findSkillsRecursive`. Cover:
- sorted visible file listing
- exclusion of `SKILL.md`
- exclusion of hidden, `.git`, and `node_modules`
- missing directory returns `[]`
- maxDepth still limits traversal

## Done criteria

- [ ] `listSkillFiles()` reuses `walkDir()`
- [ ] `listSkillFiles()` no longer has custom recursive traversal
- [ ] Direct tests cover skip rules and `SKILL.md` exclusion
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- `listSkillFiles()` has already been moved out of `discovery.ts`
- Reusing `walkDir()` would require changing `walkDir()` semantics
- The characterization tests cannot be made to fail before the refactor
- Verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If `findScripts()` later gets the same consolidation or perf cleanup, do that as a separate plan.
- Keep `walkDir()` as the single source of truth for shared traversal rules; avoid reintroducing bespoke recursion.
