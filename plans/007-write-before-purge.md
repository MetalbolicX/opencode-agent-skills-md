# Plan 007: Write config before purging plugin-owned directories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop
> and report instead of improvising. When done, update the status row for
> this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9c57cb0..HEAD -- packages/opencode-agent-skills-md/src/cli/uninstall.ts packages/opencode-agent-skills-md/tests/cli-commands.test.ts`
> If any in-scope file changed since this plan was written, compare the
> Current state excerpts below against live code first. Any mismatch is a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9c57cb0`, 2026-07-03

## Why this matters

`runUninstall({ purge: true })` currently deletes the plugin cache/config
directories before it attempts the config write. If the later write fails, the
global OpenCode config can still claim the plugin is installed while the
plugin-owned directories are already gone. The bug is about operation ordering.

## Current state

- `packages/opencode-agent-skills-md/src/cli/uninstall.ts` — uninstall command implementation
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts` — existing uninstall coverage with in-memory `CliFs`

Relevant excerpts:

- `packages/opencode-agent-skills-md/src/cli/uninstall.ts:98-110`
  - purge candidates are computed and, for real `--purge`, deleted before the no-op/write path
- `packages/opencode-agent-skills-md/src/cli/uninstall.ts:145-149`
  - config backup and `writeAtomically()` happen later
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts:1048-1065`
  - existing `--purge (real)` test only asserts the command returns `wrote`; there is no regression test for a config-write failure after purge begins
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts:70-156`
  - `createMemoryFs()` supports failure injection for `write` and `rename`

Conventions to match:

- Keep `purgeDir()` best-effort
- Preserve `--dry-run` output and current return shapes
- Reorder operations instead of adding rollback machinery

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Targeted tests | `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` | all pass |
| Full tests | `pnpm test` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/opencode-agent-skills-md/src/cli/uninstall.ts`
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts`

**Out of scope**:
- Install command behavior
- Purge path redesign or rollback framework
- Any changes to `CliFs` shape

## Git workflow

- Branch: `advisor/007-write-before-purge`
- Commit style: conventional commits, for example `fix(cli): write uninstall config before purge`
- Do NOT push or open a PR unless instructed

## Steps

### Step 1: Add a regression test for write-failure ordering

Extend `describe("runUninstall", ...)` in `packages/opencode-agent-skills-md/tests/cli-commands.test.ts`.

Add a test that:

- starts with a config containing the plugin entry
- injects a write or rename failure via `setFailNext()`
- calls `runUninstall({ purge: true }, ...)`
- asserts the thrown error propagates
- asserts the original config file content is unchanged

Because the purge path uses `node:fs.rmSync` directly, do not assert real directory deletion in the in-memory FS. The point is to pin that the config write must be attempted before purge side effects happen.

**Verify**: `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` → the new test fails before the reorder

### Step 2: Reorder `runUninstall()` side effects

Modify `packages/opencode-agent-skills-md/src/cli/uninstall.ts`.

Target shape:

- Keep dry-run planning unchanged
- Keep no-op handling unchanged
- Build the post-uninstall config object as today
- If config removal is needed, do backup + atomic write first
- Only after a successful write, perform best-effort purge of plugin-owned dirs

Do not add fallback writes, retries, or rollback code.

**Verify**: `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` → all tests pass

### Step 3: Run repo verification

**Verify**:
- `pnpm run typecheck` → exit 0
- `pnpm test` → exit 0
- `git status --short` → only the two in-scope files plus `plans/README.md`

## Test plan

Extend `packages/opencode-agent-skills-md/tests/cli-commands.test.ts`. Model after existing uninstall tests and the existing write-failure helpers. Cover:
- regression: `purge: true` plus write failure leaves config unchanged
- existing `--dry-run` and success paths remain green

## Done criteria

- [ ] `runUninstall()` writes config before purging
- [ ] Write failure leaves the config intact
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- `runUninstall()` no longer has a distinct write phase and purge phase.
- The regression requires changing `CliFs` or adding a purge abstraction.
- The fix appears to require changing public return types or console output format.
- Verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Purge remains best-effort by design; the important invariant is that config state is committed first.
- If uninstall ever gains transactional semantics later, revisit install/uninstall symmetry together rather than expanding this fix.
