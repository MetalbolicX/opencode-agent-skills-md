# Plan 015: Rewrite the stale README

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report - do not improvise. When done, update the status row for this plan in `plans/README.md`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: 2026-07-10

## Why this matters

The README still advertises commands and versions that are not true in the current repo. That is worse than no docs: it sends users to workflows that do not exist.

## Current state

- `README.md` - contains stale CLI install text, stale version references, and an incomplete discovery-root description.
- `package.json` - actual install/publish behavior is the source of truth.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Test suite | `bun test` | all pass |

## Scope

**In scope**
- `README.md`

**Out of scope**
- Source code
- `package.json` (plan 014 handles publish metadata)

## Steps

### Step 1: Remove fake CLI instructions
Delete the `npx opencode-agent-skills-md install` flow and the `oas install/uninstall/status/doctor` section. Those commands are not implemented.

### Step 2: Replace with the real install story
Document the working manual config path and the actual local dev path that matches the current repo layout.

### Step 3: Fix version references
Update all version strings so the README matches the current package version and release flow.

### Step 4: Document the actual discovery model
Explain the 4 core skill roots plus the 2 Claude plugin roots in a way that matches the code.

### Step 5: Verify the README does not drift from reality
Read back the installation and release sections and compare them to `package.json` and `src/skills.ts`.

## Test plan

- `bun run typecheck` → exit 0
- `bun test` → all pass

## Done criteria

- [ ] No fake CLI commands remain in the README
- [ ] Version references match the package
- [ ] Discovery roots match the code
- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0

## STOP conditions

- The correct install path depends on a package-manager-specific command that is not currently supported.
- Updating the README would require changing runtime behavior first.
