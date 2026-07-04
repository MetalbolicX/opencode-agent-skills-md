# Plan 006: Preserve commas inside JSONC string values

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop
> and report instead of improvising. When done, update the status row for
> this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9c57cb0..HEAD -- packages/opencode-agent-skills-md/src/cli/config.ts packages/opencode-agent-skills-md/tests/cli-commands.test.ts`
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

`parseJsonc()` currently strips trailing commas with a regex applied to the
entire post-comment text. That regex does not respect string boundaries, so a
valid string value containing `,}` or `,]` is silently mutated before
`JSON.parse()` runs. This is a real data-corruption bug in the CLI config
loader, and the fix is narrow.

## Current state

- `packages/opencode-agent-skills-md/src/cli/config.ts` — CLI config parsing helpers used by install, uninstall, status, and doctor.
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts` — existing characterization tests for `parseJsonc()` and other CLI helpers.

Relevant excerpts:

- `packages/opencode-agent-skills-md/src/cli/config.ts:204-255`
  - `stripJsoncComments()` already tracks `inString` and `escaped` while removing comments.
  - It ends with: `return out.replace(/,(\s*[}\]])/g, "$1");`
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts:272-319`
  - Existing tests cover empty input, comments, escaped quotes, and ordinary trailing commas.
  - There is no test proving commas inside string literals survive unchanged.

Conventions to match:

- CLI helper tests live in `packages/opencode-agent-skills-md/tests/cli-commands.test.ts`.
- Keep the implementation minimal and local; do not introduce a new parser dependency.
- Preserve the current graceful behavior: comments are stripped, trailing commas still work, malformed JSON still throws.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Targeted tests | `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` | all pass |
| Full tests | `pnpm test` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/opencode-agent-skills-md/src/cli/config.ts`
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts`

**Out of scope**:
- Any CLI command behavior beyond config parsing correctness
- Any release workflow or docs change
- Any new dependency

## Git workflow

- Branch: `advisor/006-preserve-jsonc-commas`
- Commit style: conventional commits, for example `fix(cli): preserve commas inside JSONC strings`
- Do NOT push or open a PR unless instructed

## Steps

### Step 1: Add a failing regression test for string-preservation

Extend `describe("parseJsonc", ...)` in `packages/opencode-agent-skills-md/tests/cli-commands.test.ts`.

Add at least these cases:

- A string containing `,}` such as `{"doc":"keep ,} inside string","plugin":["a",],}`
- A string containing `,]` such as `{"doc":"keep ,] inside string","list":[1,2,],}`
- A nested mixed case with both string patterns and structural trailing commas

The assertions must prove both:
- trailing commas are still removed structurally
- string content is unchanged byte-for-byte

**Verify**: `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` → the new test fails before the fix

### Step 2: Replace regex-based trailing-comma stripping with a string-aware pass

Modify `stripJsoncComments()` in `packages/opencode-agent-skills-md/src/cli/config.ts`.

Target shape:

- Keep the existing comment-stripping loop
- Replace the final regex with a second character-by-character pass (or fold it inline)
- Track `inString` and `escaped` state
- Remove commas only when the next non-whitespace token is `}` or `]` and the parser is not inside a string literal

Do not change `parseJsonc()` public behavior.

**Verify**: `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` → all tests pass

### Step 3: Run repo verification

**Verify**:
- `pnpm run typecheck` → exit 0
- `pnpm test` → exit 0
- `git status --short` → only the two in-scope files plus `plans/README.md`

## Test plan

Extend `packages/opencode-agent-skills-md/tests/cli-commands.test.ts` inside the existing `describe("parseJsonc", ...)`. Model new cases after the existing block at lines 272-319. Cover:
- happy path trailing comma removal still works
- regression: `,}` inside a string is preserved
- regression: `,]` inside a string is preserved
- nested mixed case with both strings and structural trailing commas

## Done criteria

- [ ] `parseJsonc()` preserves commas inside string literals
- [ ] Existing trailing-comma behavior still works
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The `parseJsonc` implementation no longer ends in a regex-based trailing comma removal step.
- Fixing the bug appears to require a new parser dependency.
- The regression test cannot be made to fail before the implementation change.
- Verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Keep this logic near `stripJsoncComments()`; splitting into many helpers is unnecessary unless the function becomes unreadable.
- Future changes to config parsing should always add regression tests for string-boundary handling.
