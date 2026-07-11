# Plan 014: Make `package.json` publish-ready

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report - do not improvise. When done, update the status row for this plan in `plans/README.md`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: config
- **Planned at**: 2026-07-10

## Why this matters

The repository is functionally close to upstream, but `package.json` still is not publication-ready. It lacks the packaging metadata that keeps npm publishes deterministic and minimal, and it has no publish gate that enforces the existing `typecheck` + test contract before a release.

## Current state

- `package.json` - raw source entrypoint, no `files`, no `types`, no `exports`, no `publishConfig`, no `prepublishOnly`.
- `README.md` - release instructions still assume older publishing flow.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Test suite | `bun test` | all pass |
| Pack preview | `npm pack --dry-run` | only intended files appear |

## Scope

**In scope**
- `package.json`

**Out of scope**
- `README.md` (plan 015 handles docs)
- Source code behavior

## Steps

### Step 1: Add publish metadata
Add the packaging metadata that makes the package safe to publish:
- `publishConfig.access = "public"`
- `files` whitelist for published artifacts
- `prepublishOnly = "bun run typecheck && bun test"`

### Step 2: Keep the runtime entrypoint honest
Do not introduce a build step unless it is strictly required. The package currently loads source directly; preserve that model if it remains correct for OpenCode plugin loading.

### Step 3: Normalize the toolchain metadata
Align the Bun type dependency naming with the current repo convention if needed, but do not widen the change beyond packaging metadata.

### Step 4: Verify publish shape
Run the pack preview and confirm only intended artifacts are included.

## Test plan

- `bun run typecheck` → exit 0
- `bun test` → all pass
- `npm pack --dry-run` → no generated plans, no memory/cache directories, no workspace artifacts

## Done criteria

- [ ] `package.json` includes publish metadata
- [ ] `prepublishOnly` enforces typecheck + tests
- [ ] Pack preview contains only intended files
- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] No files outside scope modified

## STOP conditions

- Packaging the source entrypoint requires a build step that would change runtime loading semantics.
- The package would need a new runtime format to remain publishable.
