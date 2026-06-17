# Apply Progress: Fix Skill-Loading Regression

## Status: ok

All chained PR tasks complete. Verification clean.

## Commit Stack

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

## Phase Summary

### PR 1: Callback wiring (host-adapter)

- **1.1 RED** — `c64d4e7`: failing regression tests in
  `tests/opencode/plugin.test.ts` (3 new) and
  `tests/integration/plugin.test.ts` (1 new).
- **1.2 GREEN** — `fd4ab41`: added `OnSkillLoaded` type alias and
  optional 4th arg on `createSkillTools` in `src/opencode/tools.ts`;
  passed a 4-line callback that records the loaded skill in
  `loadedSkillsPerSession` from `src/opencode/plugin.ts`.
- **1.3 REFACTOR** — `9e975ab`: extracted a tiny `sendMessage` helper
  in `tests/opencode/plugin.test.ts` to reduce ~30 lines of chat.message
  dispatch boilerplate. Production code unchanged.

### PR 2: Discovery breadth (core)

- **2.1 RED** — `b764c15`: added regression nets in
  `tests/integration/skill-discovery.test.ts` covering all four
  priority locations (`.opencode/skills`, `.claude/skills`,
  `~/.config/opencode/skills`, `~/.claude/skills`), first-match-wins
  shadowing, default duplicate-warning callback, and the partial-trigger
  R5 scenario. Added fixtures under
  `tests/fixtures/skills/{project,home}/.claude/skills/`.
- **2.2 GREEN** — `7e4293e`: tightened JSDoc on `getDefaultOpencodeRoots`
  to reference pre-refactor commit `c2d8e74` and the intentional
  maxDepth widening (commit `12de52a`).
- **2.3 REFACTOR** — `8c7de19`: extracted `DEFAULT_DISCOVERY_MAX_DEPTH`
  constant to remove the repeated `maxDepth: 3` magic number.

### PR 3: Optional cleanup / verification

- **3.1 RED/GREEN** — Coverage is complete for spec R3 (callback fires,
  dedupe, missing-callback) and R5 (priority + first-match-wins,
  baseline match, partial-trigger). No additional regression needed.
- **3.2 REFACTOR** — Production code is already minimal. No
  behavior-neutral cleanup that would reduce duplication.
- **3.3 VERIFY** — `c1f5b27`: empty chore commit acknowledging
  `pnpm run typecheck` clean and `pnpm test` 102/102 green.

## Files Changed

### Production (3 files, 33 insertions, 14 deletions)

- `src/opencode/tools.ts` — added `OnSkillLoaded` type and optional
  callback parameter on `createSkillTools`.
- `src/opencode/plugin.ts` — wired the callback to update
  `loadedSkillsPerSession` in the module-level Map.
- `src/core/discovery.ts` — JSDoc clarified and `DEFAULT_DISCOVERY_MAX_DEPTH`
  constant extracted.

### Tests (2 files modified, 4 new tests)

- `tests/opencode/plugin.test.ts` — added 3 regression tests covering
  callback wiring, dedupe, and missing-callback. Extracted `sendMessage`
  helper.
- `tests/integration/plugin.test.ts` — added 1 end-to-end regression
  test for the full plugin path (bootstrap → use_skill → chat.message
  dedupe).

### Fixtures (2 new files)

- `tests/fixtures/skills/project/.claude/skills/claude-project-only-skill/SKILL.md`
- `tests/fixtures/skills/home/.claude/skills/claude-user-only-skill/SKILL.md`

### Change artifacts (4 new files, tracked in `01c4b46`)

- `openspec/changes/fix-skill-loading-regression/{proposal,design,tasks}.md`
- `openspec/changes/fix-skill-loading-regression/specs/core-decoupling/spec.md`

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/opencode/plugin.test.ts` | Unit | ✅ 18/18 | ✅ Written (2 fail) | ✅ Passed | ✅ 3 cases | ✅ Clean |
| 1.1 | `tests/integration/plugin.test.ts` | Integration | ✅ 18/18 | ✅ Written (1 fail) | ✅ Passed | ➖ Single | ✅ Clean |
| 1.2 | (production code) | — | ✅ 18/18 | ✅ Written | ✅ Passed | — | — |
| 1.3 | (test refactor) | Unit | — | — | — | — | ✅ Helper extracted |
| 2.1 | `tests/integration/skill-discovery.test.ts` | Integration | ✅ 22/22 | ✅ Written (regression net) | ✅ Passed | ✅ 4 cases | ✅ Clean |
| 2.2 | (production doc update) | — | — | — | — | — | ✅ JSDoc tightened |
| 2.3 | (production refactor) | — | — | — | — | — | ✅ Constant extracted |

## Verification

- `pnpm run typecheck` — clean (0 errors)
- `pnpm test` (full suite: unit + core + opencode + integration + e2e)
  — 102 pass / 0 fail / 0 skipped
- `node --import tsx --test src/utils.test.ts tests/core/*.test.ts
  tests/opencode/plugin.test.ts tests/integration/plugin.test.ts
  tests/integration/skill-discovery.test.ts tests/e2e/*.test.ts`
  — 89 pass / 0 fail

## Notable Discoveries (for sdd-verify)

- **Dedupe assertion gotcha**: An earlier draft of the dedupe test
  asserted that zero `<skill-evaluation-required>` injections fire
  after `use_skill`. The keyword matcher legitimately matches other
  skills that share tokens with the query (e.g., `user-only-skill`,
  `nested-skill`, `shared-skill` all match `"use the script skill"`
  via the `script`/`skill`/`use` tokens). The correct regression is
  that the loaded skill is filtered OUT of the matched list — see the
  `for (const prompt of evaluationInjections)` loop in both test files.
- **`getDefaultOpencodeRoots` maxDepth deviation**: Pre-refactor
  `c2d8e74` used `maxDepth: 1` for the Claude-side roots. Commit
  `12de52a` widened them to 3 deliberately. The current code preserves
  the widening; the spec R5 only requires the four-location priority,
  not the depths. The regression net locks the depth=3 choice.
- **Plugin cache / marketplace discovery**: `c2d8e74` discovered
  `~/.claude/plugins/cache/` and `~/.claude/plugins/marketplaces/` via
  `claude.ts`. These are intentionally out of scope for this fix; the
  proposal scopes the change to the four standard locations.
- **Callback wiring shape**: `UseSkill` already accepted an optional
  `onSkillLoaded(sessionID, skillName)` parameter before the fix.
  `createSkillTools` simply never accepted/forwarded it. The fix is a
  minimal signature change on `createSkillTools`; `UseSkill` and the
  host adapter logic are unchanged.
