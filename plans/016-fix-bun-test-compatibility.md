# Plan 016: Restore the skipped Bun tests

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report - do not improvise. When done, update the status row for this plan in `plans/README.md`.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: test
- **Planned at**: 2026-07-10

## Why this matters

Twelve tests are skipped because they still depend on `node:test` APIs (`mock.method`, `mock.timers`) that Bun does not implement. The current fixture path in `src/test-helpers.ts` was also stale because the monorepo fixture tree was removed. Together, that meant the repo was shipping with silent coverage loss.

## Current state

- `src/tools.test.ts` - 12 skipped tests across two suites:
  - `single-pass tool discovery` (5 tests, uses `mock.method`)
  - `runBoundSkillScript bounded execution` (7 tests, uses `mock.timers`)
- `src/test-helpers.ts` - fixture root now points at `tests/fixtures/skills`.
- `tests/fixtures/skills/` - base fixture tree exists and needs one duplicate `scripted-skill` in the home root for the conflict-counting tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Tools tests | `bun test src/tools.test.ts` | no skips in the fixed suites |
| Full suite | `bun test` | all pass |

## Scope

**In scope**
- `src/tools.test.ts`
- `src/test-helpers.ts`
- `src/tools.ts` for the optional timeout injection on `RunSkillScriptFactory`
- test fixture files under `tests/fixtures/skills/`

**Out of scope**
- Other production tool behavior

## Steps

### Step 1: Add the duplicate fixture skill
Create `tests/fixtures/skills/home/.config/opencode/skills/scripted-skill/SKILL.md` so the single-pass discovery tests can observe one duplicate-name warning per discovery pass.

### Step 2: Replace `mock.method`
Rewrite the warning-counting tests to use a Bun-compatible spy around `console.warn` with restore semantics.

### Step 3: Remove unnecessary `mock.timers` usage
Unskip the tests that only need abort/cancellation behavior and do not actually require clock control.

### Step 4: Use a tiny real timeout for the pure helper timeout test
Change the helper-level timeout case to use a very small real timeout (for example, 10ms) and assert the matching timeout message.

### Step 5: Inject timeout control into the tool integration path
Add an optional `timeoutMs` parameter to `RunSkillScriptFactory` and thread it through `createSkillTools`, defaulting to `SKILL_SCRIPT_TIMEOUT_MS`. Use a tiny timeout in the integration timeout test.

### Step 6: Unskip the suites
Remove `describe.skip` only after the tests are Bun-compatible and deterministic.

### Step 7: Verify coverage is restored
Run the targeted file and confirm the skipped suites are now executing.

## Test plan

- `bun test src/tools.test.ts` → the previously skipped suites now run
- `bun run typecheck` → exit 0
- `bun test` → no unexpected skips

## Done criteria

- [ ] Duplicate fixture skill exists in the home root
- [ ] No `mock.method` dependency remains
- [ ] No `mock.timers` dependency remains
- [ ] `mock` removed from the `node:test` import
- [ ] Previously skipped suites now execute
- [ ] `RunSkillScriptFactory` accepts optional `timeoutMs` with unchanged default
- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0

## STOP conditions

- Bun lacks enough test primitives to make the abort/timeout tests deterministic even with real timers.
- The timeout injection would change runtime loading semantics for real callers.
