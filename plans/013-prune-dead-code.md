# Plan 013: Prune dead code (superpowers stub + unused keyword matcher)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0105477..HEAD -- src/superpowers.ts src/plugin.ts src/plugin.test.ts`.
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `0105477`, 2026-07-10

## Why this matters

`src/superpowers.ts` is a 6-line no-op stub and is never imported; the real Superpowers bootstrap already lives inline in `src/plugin.ts`. Keeping both creates a misleading second place to look for behavior that does not exist. Separately, `matchSkillsByKeyword` is exported from `src/plugin.ts` but not used by the plugin routing path, so it is either dead weight or an intentionally internal helper that should be labeled as such. This plan removes ambiguity without changing runtime behavior.

## Current state

- `src/superpowers.ts` — stub file, currently a no-op export.
- `src/plugin.ts:33-56` — `matchSkillsByKeyword`, exported but not used by the plugin internals.
- `src/plugin.ts:188-212` — the actual Superpowers bootstrap lives inline here.

Current excerpt (`src/superpowers.ts`):

```ts
/**
 * Superpowers bootstrap — stub for Phase 1.2 GREEN.
 *
 * Preserves synthetic noReply injection and Superpowers bootstrap behaviour.
 */
export const injectSuperpowers = async (): Promise<void> => {};
```

Repo conventions to preserve:
- Keep user-facing behavior with the code that actually runs; do not split live behavior into dead stubs.
- If a helper is kept for tests, document it as internal.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Tests | `bun test` | all pass |
| Confirm no import | `rg -n "superpowers" src/` | no import lines |

## Scope

**In scope**
- `src/superpowers.ts` (delete)
- `src/plugin.ts` (remove `matchSkillsByKeyword` if unused by tests; otherwise mark it `@internal`)
- `src/plugin.test.ts` only if a test needs to be adjusted after the helper is removed

**Out of scope**
- The inline Superpowers bootstrap in `src/plugin.ts`.
- Any ranking behavior changes.

## Steps

### Step 1: Decide whether `matchSkillsByKeyword` is still needed
Run `rg -n "matchSkillsByKeyword" src/`. If the only match is the definition site, remove the function. If tests depend on it, keep it but add a short `@internal` JSDoc explaining that plugin routing uses the embeddings matcher and this helper exists only as a test/internal fallback.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Delete the superpowers stub
Remove `src/superpowers.ts`. Do not move or rewrite the real bootstrap logic; it already lives where the runtime uses it.

**Verify**: `rg -n "import.*superpowers" src/` → no import lines.

### Step 3: Run the repo checks
Ensure the repository still typechecks and the full suite remains green after the cleanup.

**Verify**: `bun run typecheck` → exit 0; `bun test` → all pass.

## Test plan

- No new tests are expected unless `matchSkillsByKeyword` removal requires a small test adjustment.
- Verification: `bun test` → all pass.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `src/superpowers.ts` removed
- [ ] `matchSkillsByKeyword` is either removed or clearly marked internal
- [ ] No files outside scope modified
- [ ] `plans/README.md` row updated

## STOP conditions

- A test imports `matchSkillsByKeyword` and relies on its current behavior (then keep + annotate, do not delete).
- `src/superpowers.ts` is referenced from outside `src/`.

## Maintenance notes

- If the inline Superpowers bootstrap is ever moved into a dedicated module, do that deliberately and remove the dead stub as part of the same change.
