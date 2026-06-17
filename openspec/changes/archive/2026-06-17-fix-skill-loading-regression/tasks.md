# Tasks: Fix Skill-Loading Regression

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180-260 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 (optional) |
| Delivery strategy | force-chained |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Restore callback seam + session dedupe | PR 1 | `src/opencode/*`; tests first |
| 2 | Restore baseline discovery sources | PR 2 | `src/core/discovery.ts`; stack after PR 1 |
| 3 | Cleanup only if scope stays tight | PR 3 | Optional polish + final verification |

## Phase 1: PR 1 — Callback wiring

- [x] 1.1 RED — Extend `tests/opencode/plugin.test.ts` and `tests/integration/plugin.test.ts` to fail when `use_skill` loads once but does not update loaded-session state or suppress duplicate re-injection; commit `test: add skill loading callback regression coverage`.
- [x] 1.2 GREEN — Update `src/opencode/tools.ts` and `src/opencode/plugin.ts` to thread optional `onSkillLoaded` through `createSkillTools()` → `UseSkill()` and restore `loadedSkillsPerSession` updates; commit `fix: restore use-skill callback wiring`.
- [x] 1.3 REFACTOR — Keep the callback seam optional, trim duplicated plugin-test setup, and rerun `node --import tsx --test tests/opencode/plugin.test.ts tests/integration/plugin.test.ts`; commit `refactor: preserve optional skill callback seam`.

## Phase 2: PR 2 — Discovery breadth

- [x] 2.1 RED — Extend `tests/integration/skill-discovery.test.ts` with baseline-coverage cases for `.opencode/skills`, `.claude/skills`, `~/.config/opencode/skills`, `~/.claude/skills`, plus the partial-trigger regression from spec R5; commit `test: add discovery breadth regression coverage`.
- [x] 2.2 GREEN — Modify `src/core/discovery.ts` to restore the pre-refactor source set from `c2d8e74` while preserving first-match-wins and duplicate warnings; commit `fix: restore baseline skill discovery sources`.
- [x] 2.3 REFACTOR — Normalize any helper/constants in `src/core/discovery.ts`, keep search/host boundaries unchanged, and rerun `node --import tsx --test tests/integration/skill-discovery.test.ts`; commit `refactor: clean up discovery source helpers`.

## Phase 3: PR 3 — Optional cleanup / verification

- [x] 3.1 RED/GREEN — Coverage gap check: PR 1 + PR 2 cover all spec R3/R5 scenarios. No additional regression needed; skip the commit.
- [x] 3.2 REFACTOR — Code is already minimal (OnSkillLoaded type, inlined 4-line callback, DEFAULT_DISCOVERY_MAX_DEPTH constant). No behavior-neutral cleanup needed; skip the commit.
- [x] 3.3 VERIFY — Run `pnpm run typecheck` (clean) and the full `pnpm test` suite (102 tests, 0 fail); commit `chore: verify skill loading regression fix`.

## Final Commit Stack

```
d2c3584 test: correct dedupe assertion to allow other matches
c1f5b27 chore: verify skill loading regression fix
8c7de19 refactor: clean up discovery source helpers
7e4293e fix: restore baseline skill discovery sources
b764c15 test: add discovery breadth regression coverage
9e975ab refactor: preserve optional skill callback seam
fd4ab41 fix: restore use-skill callback wiring
c64d4e7 test: add skill loading callback regression coverage
01c4b46 chore(sdd): add fix-skill-loading-regression change artifacts
```

## Verification

- `pnpm run typecheck` — clean
- `node --import tsx --test src/utils.test.ts tests/core/*.test.ts tests/opencode/plugin.test.ts tests/integration/plugin.test.ts tests/integration/skill-discovery.test.ts tests/e2e/*.test.ts` — 89 pass / 0 fail
- `pnpm test` (unit + core + opencode + integration + e2e) — 102 pass / 0 fail
- All spec R3 scenarios covered: callback fires, dedupe, missing-callback
- All spec R5 scenarios covered: priority + first-match-wins, baseline match, partial-trigger
