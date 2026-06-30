# Plan 001: Add CI gating before release

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fb45791..HEAD -- .github/ README.md packages/opencode-agent-skills-md/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `fb45791`, 2026-06-29

## Why this matters

The repo has zero CI workflows — the `release.yml` referenced in the README
badge and as a GitHub Actions link does not exist in the repo. The release
pipeline (prepublish-only, if any) never runs tests. Regressions in the
high-churn discovery/search/plugin cycle ship silently. This plan adds a
CI workflow that runs typecheck + test on push/PR, and fixes the
`pretest` script in the plugin package that uses `npm run build` instead of
`pnpm run build`.

## Current state

- `.github/workflows/` — directory does not exist in the repo.
- `README.md:4` — badge references `release.yml` workflow that does not exist.
- `packages/opencode-agent-skills-md/package.json:21` — `"pretest": "npm run build"` uses `npm` in a pnpm workspace.

Conventions:
- Existing scripts in `package.json` use pnpm commands. Test runner is `node --import tsx --test`.
- Install is `pnpm install`. Root manifest is private and delegates to packages via `pnpm -r`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Typecheck | `pnpm run typecheck`     | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass            |

## Scope

**In scope** (the only files you should modify):
- `packages/opencode-agent-skills-md/package.json` — fix `pretest` script
- `README.md` — update stale workflow badge or remove it
- `.github/workflows/ci.yml` — create CI workflow
- `.github/workflows/release.yml` — create release workflow (optional, only if you have context on the release process)

**Out of scope** (do NOT touch):
- Any source code in `packages/core/src/` or `packages/opencode-agent-skills-md/src/`
- Any test files — those are covered in other plans
- Any config files not listed above

## Git workflow

- Branch: `advisor/001-ci-gate`
- Commit per logical step; message style: conventional commits (e.g. `dx: add CI workflow`, `fix: use pnpm in pretest hook`)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fix `pretest` script in plugin package

Change `"pretest": "npm run build"` to `"pretest": "pnpm run build"` in
`packages/opencode-agent-skills-md/package.json`. This ensures the build runs
with the pnpm workspace resolver, not npm.

**Verify**: `grep '"pretest"' packages/opencode-agent-skills-md/package.json` → `"pretest": "pnpm run build"`

### Step 2: Create CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: pnpm
      - run: pnpm install
      - run: pnpm run typecheck
      - run: pnpm test
```

The workflow runs on push/PR to `main`, installs deps via pnpm, then runs
typecheck and test across a Node 18/20/22 matrix.

**Verify**: `ls .github/workflows/ci.yml` → file exists

### Step 3: Update README badge

The README line 4 has a badge with a `release.yml` workflow reference that
does not exist in the repo. Either:
- Replace the badge with one pointing to the new `ci.yml` workflow, OR
- If you also create a `release.yml` (out of scope for this plan), keep it.

Update the badge at `README.md:4`:

Old:
```
<a href="https://github.com/joshuadavidthomas/opencode-agent-skills-md/actions/workflows/release.yml"><img alt="release" src="..."/></a>
```

New — point to the CI workflow:
```
<a href="https://github.com/joshuadavidthomas/opencode-agent-skills-md/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/joshuadavidthomas/opencode-agent-skills-md/ci.yml?style=flat-square&logo=githubactions&label=ci" /></a>
```

**Verify**: `grep 'actions/workflows/ci.yml' README.md` → matches

### Step 4: Verify everything still works

Run the full verification suite from the repo root.

**Verify**:
- `pnpm install` → exit 0
- `pnpm run typecheck` → exit 0, no errors
- `pnpm test` → exit 0, all tests pass
- `git status` — only the three in-scope files are modified

## Test plan

No new tests needed for this plan — it only adds automation infrastructure.
The existing test suite must pass unchanged.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` exists and follows the pattern above
- [ ] `packages/opencode-agent-skills-md/package.json` uses `pnpm run build` in pretest
- [ ] `README.md` references `ci.yml` badge (not a missing `release.yml`)
- [ ] `pnpm install` exits 0
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The README badge URL or the GitHub org/repo name differs from the excerpts above — the badge URL format may need adjustment.
- Creating `.github/workflows/ci.yml` causes any existing hook or lint step to fail.
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.

## Maintenance notes

- The Node version matrix (18, 20, 22) matches the engine constraint `>=18.0.0` in the plugin `package.json`. Update if the minimum engine changes.
- If a `release.yml` is added later, move the test/typecheck steps into a shared composite action to avoid duplication.
