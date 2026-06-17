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

- [ ] 1.1 RED — Extend `tests/opencode/plugin.test.ts` and `tests/integration/plugin.test.ts` to fail when `use_skill` loads once but does not update loaded-session state or suppress duplicate re-injection; commit `test: add skill loading callback regression coverage`.
- [ ] 1.2 GREEN — Update `src/opencode/tools.ts` and `src/opencode/plugin.ts` to thread optional `onSkillLoaded` through `createSkillTools()` → `UseSkill()` and restore `loadedSkillsPerSession` updates; commit `fix: restore use-skill callback wiring`.
- [ ] 1.3 REFACTOR — Keep the callback seam optional, trim duplicated plugin-test setup, and rerun `node --import tsx --test tests/opencode/plugin.test.ts tests/integration/plugin.test.ts`; commit `refactor: preserve optional skill callback seam`.

## Phase 2: PR 2 — Discovery breadth

- [ ] 2.1 RED — Extend `tests/integration/skill-discovery.test.ts` with baseline-coverage cases for `.opencode/skills`, `.claude/skills`, `~/.config/opencode/skills`, `~/.claude/skills`, plus the partial-trigger regression from spec R5; commit `test: add discovery breadth regression coverage`.
- [ ] 2.2 GREEN — Modify `src/core/discovery.ts` to restore the pre-refactor source set from `c2d8e74` while preserving first-match-wins and duplicate warnings; commit `fix: restore baseline skill discovery sources`.
- [ ] 2.3 REFACTOR — Normalize any helper/constants in `src/core/discovery.ts`, keep search/host boundaries unchanged, and rerun `node --import tsx --test tests/integration/skill-discovery.test.ts`; commit `refactor: clean up discovery source helpers`.

## Phase 3: PR 3 — Optional cleanup / verification

- [ ] 3.1 RED/GREEN — If PR 1 or PR 2 leaves a gap, add the smallest missing regression in `tests/integration/plugin.test.ts` or `tests/opencode/plugin.test.ts` before polishing code; commit `test: cover remaining skill-loading edges`.
- [ ] 3.2 REFACTOR — Apply behavior-neutral cleanup in `src/opencode/plugin.ts`, `src/opencode/tools.ts`, or `src/core/discovery.ts` only if it reduces duplication without widening scope; commit `refactor: tidy regression fix seams`.
- [ ] 3.3 VERIFY — Run `pnpm run typecheck` and `node --import tsx --test tests/opencode/plugin.test.ts tests/integration/plugin.test.ts tests/integration/skill-discovery.test.ts`; commit `chore: verify skill loading regression fix`.
