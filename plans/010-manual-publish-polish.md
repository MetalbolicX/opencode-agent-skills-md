# Plan 010: Polish manual publishing for `opencode-agent-skills-md`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop
> and report instead of improvising. When done, update the status row for
> this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- package.json packages/opencode-agent-skills-md/package.json CHANGELOG.md README.md Justfile .github/workflows/release.yml`
> If any in-scope file changed since this plan was written, compare the
> Current state excerpts below against live code first. Any mismatch is a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: 009
- **Category**: release
- **Planned at**: 2026-07-07

## Why this matters

The package is publishable, but the release story is not polished yet. The
repo should publish manually, not through CI, and it should be pinned to
`pnpm@11.x` so release steps are reproducible and documented. The goal is a
clean, local maintainer flow that builds, validates, packs, and publishes the
real package from `packages/opencode-agent-skills-md`.

## Current state

- `packages/opencode-agent-skills-md/package.json` — publishable package manifest
- `package.json` — private workspace root manifest
- `CHANGELOG.md` — has an `[Unreleased]` section that must be folded into the next release
- `README.md` — user install docs
- `Justfile` — local maintainer task entrypoints
- `.github/workflows/release.yml` — exists, but is out of scope for the new manual release path

Relevant excerpts:

- `packages/opencode-agent-skills-md/package.json:2-29`
  - package name/version/bin/exports are already publishable
  - `prepack` exists, but `prepublishOnly` is missing
  - `publishConfig` is missing
- `package.json:1-35`
  - root workspace manifest is `private: true`
  - `packageManager` is missing
- `CHANGELOG.md:19-31`
  - unreleased changes exist and should become the next version entry
- `.github/workflows/release.yml`
  - a CI release workflow exists, but the user explicitly does not want CI for publishing

Conventions to match:

- Manual local publishing only
- Pin to `pnpm@11.x`
- Do not introduce CI-dependent provenance or release automation
- Keep the user-facing quick install as `npx opencode-agent-skills-md install`
- Keep post-install command usage as `oas ...`

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Pin pnpm | `corepack use pnpm@11` | root `package.json` updated / pnpm 11 active |
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0 |
| Pack | `pnpm -F opencode-agent-skills-md pack` | `.tgz` generated |
| Package contents | `npm pack --dry-run` | intended files listed |
| Publish | `npm publish --access public` | package published |

## Scope

**In scope** (the only files you should modify):
- `package.json`
- `packages/opencode-agent-skills-md/package.json`
- `CHANGELOG.md`
- `README.md`
- `Justfile`
- `plans/README.md`

**Out of scope**:
- Any CI-driven release/publish flow
- npm provenance / OIDC configuration
- New GitHub Actions workflows
- Changes to the package runtime behavior
- Changes to the published package name or CLI bin name

## Git workflow

- Branch: `advisor/010-manual-publish-polish`
- Commit style: conventional commits, for example `chore(release): polish manual publish flow`
- Do NOT push or open a PR unless instructed

## Steps

### Step 1: Pin the repo to pnpm 11

Update the root `package.json`.

Target shape:

- add a `packageManager` field pinned to `pnpm@11.x`
- keep the root manifest private
- do not add workspace-level publish metadata

If preferred, use the exact version produced by `corepack use pnpm@11`.

**Verify**:
- `corepack use pnpm@11`
- `pnpm --version` → reports 11.x
- `pnpm install --frozen-lockfile` → exit 0

### Step 2: Polish the publishable package manifest

Update `packages/opencode-agent-skills-md/package.json`.

Target shape:

- add `publishConfig.access = "public"`
- add `prepublishOnly = "pnpm run build"`
- keep existing `prepack`
- leave `bin`, `main`, `exports`, and `files` intact unless verification proves a packaging issue

Do not add CI/provenance-only fields.

**Verify**:
- `pnpm -F opencode-agent-skills-md run build` → exit 0
- `pnpm -F opencode-agent-skills-md pack` → tarball generated

### Step 3: Sync the changelog and release version

Update `CHANGELOG.md` and both manifest versions.

Target shape:

- move `[Unreleased]` into the next concrete version section
- add release notes for the registry-backed update flow and status freshness work
- bump version from `1.2.0` to the next appropriate release version
- keep the root and package manifest versions aligned

Assume a **minor** bump unless live diff review proves the release is patch-only.

**Verify**:
- `git diff -- CHANGELOG.md package.json packages/opencode-agent-skills-md/package.json`
- version numbers match in both manifests

### Step 4: Document the manual maintainer release flow

Update `README.md` and `Justfile`.

Add a short maintainer-facing release section that documents:

1. `corepack use pnpm@11`
2. `pnpm install --frozen-lockfile`
3. `pnpm run typecheck`
4. `pnpm test`
5. `pnpm -F opencode-agent-skills-md pack`
6. inspect with `npm pack --dry-run`
7. publish from `packages/opencode-agent-skills-md` via `npm publish --access public`
8. tag the release after successful publish

Optionally add a `just release-check` helper that runs the non-destructive verification steps only.

Do not add a `just publish` command unless the maintainer explicitly wants one-button publish.

**Verify**:
- `just --list`
- any new Just recipe runs without publishing

### Step 5: Final release verification

Run the full local release checks.

**Verify**:
- `pnpm install --frozen-lockfile` → exit 0
- `pnpm run typecheck` → exit 0
- `pnpm test` → exit 0
- `pnpm -F opencode-agent-skills-md pack` → exit 0
- from `packages/opencode-agent-skills-md`, `npm pack --dry-run` → shows expected package contents
- `git status --short` → only in-scope files plus `plans/README.md`

## Test plan

Cover the release surface with verification rather than new runtime tests:

- package builds cleanly under pnpm 11
- workspace tests remain green
- tarball contains intended publishable files only
- README/Justfile release instructions match the actual package location and command flow
- root workspace manifest remains private while the package manifest remains publishable

## Done criteria

- [ ] root manifest pins `pnpm@11.x`
- [ ] publishable package manifest includes `publishConfig.access = public`
- [ ] publishable package manifest includes `prepublishOnly`
- [ ] changelog is versioned for the next release
- [ ] README documents the manual release flow
- [ ] optional Just helper, if added, is non-destructive
- [ ] `pnpm test` exits 0
- [ ] `pnpm -F opencode-agent-skills-md pack` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm@11.x` introduces a lockfile or workspace incompatibility that cannot be resolved quickly
- `npm pack --dry-run` reveals missing runtime artifacts from `files` / `dist`
- the release version is unclear because unpublished breaking changes are mixed into `[Unreleased]`
- polishing the publish flow starts to require CI, provenance, or registry automation the user explicitly rejected

## Maintenance notes

- The manual publish flow is the source of truth; the existing CI release workflow should not be treated as authoritative.
- If CI publishing is ever reintroduced later, design it from the manual flow outward rather than the other way around.
- Keep the distinction clear:
  - `npx opencode-agent-skills-md install` for first-use / no-global-install
  - `oas ...` for post-install command usage
