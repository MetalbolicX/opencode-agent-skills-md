# Plan 009: Smart `update` flow for `oas`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop
> and report instead of improvising. When done, update the status row for
> this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/opencode-agent-skills-md/src/cli/main.ts packages/opencode-agent-skills-md/src/cli/status.ts packages/opencode-agent-skills-md/src/cli/uninstall.ts packages/opencode-agent-skills-md/tests/cli-commands.test.ts`
> If any in-scope file changed since this plan was written, compare the
> Current state excerpts below against live code first. Any mismatch is a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: feature
- **Planned at**: 2026-07-07

## Why this matters

`opencode-agent-skills-md` already hit the same pnpm v11 freshness trap as
`opencode-smart-router`: `@latest` global updates can lag behind the published
package because pnpm applies its release-age gate. The fix should be simple,
not config-heavy: detect staleness from the npm registry, show the current vs
latest version in `oas status`, and print the canonical
`npx opencode-agent-skills-md@latest install` instruction from `oas update`.

## Current state

- `packages/opencode-agent-skills-md/src/cli/main.ts` — CLI dispatcher and usage text
- `packages/opencode-agent-skills-md/src/cli/status.ts` — read-only status/doctor output
- `packages/opencode-agent-skills-md/src/cli/uninstall.ts` — exported `cachePath()` helper for runtime purge paths
- `packages/opencode-agent-skills-md/src/cli/config.ts` — `PLUGIN_NAME` and `CliFs` seam used by CLI helpers
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts` — existing command coverage

Relevant excerpts:

- `packages/opencode-agent-skills-md/src/cli/main.ts`
  - currently dispatches `install`, `uninstall`, `status`, and `doctor` only
  - `runMain()` is synchronous today
- `packages/opencode-agent-skills-md/src/cli/status.ts`
  - prints config/install state only; it does not check the registry yet
- `packages/opencode-agent-skills-md/src/cli/uninstall.ts:56-63`
  - already exports `cachePath()` for the runtime cache location
- `packages/opencode-agent-skills-md/src/cli/config.ts:29,57-67`
  - package name is already `opencode-agent-skills-md`
  - `CliFs` already exposes the sync file methods needed by registry helpers
- Smart-router reference: `src/cli/registry.ts` + `src/cli/update.ts`
  - the feature there is the right shape, but the target repo does not need the
    extra config/init/path machinery that smart-router has

Conventions to match:

- Keep the feature minimal: no new config directories, no state file, no `config init`, no `config paths`
- Reuse `cachePath()` from `uninstall.ts` instead of re-deriving purge paths
- Treat registry/network failures as non-blocking; the CLI should degrade gracefully to `unknown` / `noop`
- Keep `npx ...@latest install` as the canonical user-facing recovery command

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm -F opencode-agent-skills-md exec tsc -p tsconfig.json --noEmit` | exit 0 |
| CLI tests | `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` | all pass |
| Registry tests | `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-registry.test.ts` | all pass |
| Package tests | `pnpm -F opencode-agent-skills-md test` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `packages/opencode-agent-skills-md/src/cli/registry.ts` (new)
- `packages/opencode-agent-skills-md/src/cli/update.ts` (new)
- `packages/opencode-agent-skills-md/src/cli/main.ts`
- `packages/opencode-agent-skills-md/src/cli/status.ts`
- `packages/opencode-agent-skills-md/tests/cli-commands.test.ts`
- `packages/opencode-agent-skills-md/tests/cli-registry.test.ts` (new)

**Out of scope**:
- Any `tiers.json` / `config init` / `config paths` work
- Any router, reasoning, or state migration work
- Any changes to the plugin install format beyond the recovery command text
- Any new config abstraction beyond the existing `CliFs` seam

## Git workflow

- Branch: `advisor/009-smart-update-command`
- Commit style: conventional commits, for example `feat(cli): add registry-backed update flow`
- Do NOT push or open a PR unless instructed

## Steps

### Step 1: Add registry freshness helpers

Create `packages/opencode-agent-skills-md/src/cli/registry.ts`.

Implement the smallest useful set from the smart-router reference:

- `getInstalledVersion()` should read the bundled package version
- `fetchLatestVersion()` should query npm's `latest` endpoint for `opencode-agent-skills-md`
- `compareSemver()` / `isStale()` should provide a deterministic stale check
- Keep the helpers defensive: malformed JSON, network errors, and timeouts must return `null` / safe defaults rather than throwing

Reuse the existing `CliFs` shape and the same `import.meta.url` resolution style that smart-router uses.

**Verify**: add and run `tests/cli-registry.test.ts` once the file exists.

### Step 2: Add the `update` command

Create `packages/opencode-agent-skills-md/src/cli/update.ts`.

Implement a small command that:

- reads the installed version
- fetches the latest registry version
- returns `noop` when latest is unknown or already current
- when stale, purges the runtime cache path from `cachePath()`
- prints `npx opencode-agent-skills-md@latest install`
- supports `--dry-run` without touching disk

Do not add auto-install logic, retries, or any extra config handling.

**Verify**: extend `tests/cli-commands.test.ts` with stale/current/network-fail/dry-run cases.

### Step 3: Wire the CLI dispatcher

Update `packages/opencode-agent-skills-md/src/cli/main.ts`.

Target shape:

- add `update` to usage text
- dispatch `update`
- make `runMain()` async only as far as needed for registry lookup
- keep `install`, `uninstall`, `status`, and `doctor` behavior unchanged except for any async call sites needed by `status`

Be careful to preserve the existing symlink-safe entrypoint behavior.

**Verify**: run the CLI tests again after wiring.

### Step 4: Surface version freshness in `status`

Update `packages/opencode-agent-skills-md/src/cli/status.ts`.

Add a light-weight version freshness block that:

- shows installed version
- shows latest version when reachable
- indicates whether an update is available
- degrades gracefully when the registry is unreachable

Keep the existing config/install reporting intact.

**Verify**: add status-specific assertions to `tests/cli-commands.test.ts`.

### Step 5: Run repo verification

**Verify**:
- `pnpm -F opencode-agent-skills-md exec tsc -p tsconfig.json --noEmit` → exit 0
- `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-registry.test.ts` → exit 0
- `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/cli-commands.test.ts` → exit 0
- `pnpm -F opencode-agent-skills-md test` → exit 0
- `git status --short` → only the in-scope files plus `plans/README.md`

## Test plan

Cover these cases:

- `getInstalledVersion()` returns version, `null` for missing/malformed package.json
- `fetchLatestVersion()` returns version, `null` on network failure / timeout / bad payload
- `compareSemver()` handles equal, older, newer, and unparsable input
- `runUpdate()` handles stale, current, dry-run, and unknown-latest branches
- `runStatus()` shows freshness info without breaking the existing config report

## Done criteria

- [ ] `oas update` prints the canonical `npx opencode-agent-skills-md@latest install` recovery command
- [ ] `oas status` shows installed/latest freshness when possible
- [ ] Registry failures do not crash the CLI
- [ ] `pnpm -F opencode-agent-skills-md test` exits 0
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- the implementation starts pulling in smart-router-only config features
- the command needs a new persistent state file or config directory
- fixing the async wiring requires changing unrelated CLI contracts
- verification fails twice after a reasonable fix attempt

## Maintenance notes

- This feature should stay small: registry freshness + guidance, not an installer framework.
- The target plugin is simpler than smart-router, so do not copy its config subcommands or path machinery.
- Use the existing `cachePath()` export and `PLUGIN_NAME` constant; do not duplicate them.
