# Archive Report: fix-skill-loading-regression

## Change Metadata

| Field | Value |
|-------|-------|
| Change name | `fix-skill-loading-regression` |
| Archived date | 2026-06-17 |
| Archive path | `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/` |
| Spec domain | `core-decoupling` |
| Delivery strategy | force-chained |
| Chain strategy | stacked-to-main |

### Commits (9 total, per tasks.md)

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

## Spec Delta Summary

### MODIFIED Requirements

| Requirement | Domain | Action | Details |
|-------------|--------|--------|---------|
| R3 — Backward-Compatible Root Export | core-decoupling | MODIFIED | Strengthened to assert observable skill loading: `onSkillLoaded` callback fires once per session, `SKILL.md` injected once per session, session dedupe via `loadedSkillsPerSession`. Added 3 new scenarios: callback fires, session dedupe, missing callback safe. |
| R5 — Discovery Semantics Preservation | core-decoupling | MODIFIED | Strengthened to pin the surfaced skill set to pre-refactor baseline commit `c2d8e74`. Added 2 new scenarios: matches pre-refactor skill set, partial-trigger regression. |

### Unchanged Requirements
R1 (Core Module Independence), R2 (Boundary Interface Location), R4 (Framework-Agnostic Subpath Export), R6 (Public Surface Freeze) — unchanged by this delta.

## Verification Result

**PASS** — `verify-report.md` (2026-06-17)
- 9/9 tasks complete
- 102/102 tests green (unit: 42, core: 20, opencode: 22, integration: 17, e2e: 1)
- Typecheck: clean
- TDD compliance: 7/7 checks passed
- CRITICAL issues: none
- 7/7 spec scenarios compliant (R3: 4/4, R5: 3/3)

## Artifacts

### Archived Change
- `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/proposal.md`
- `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/design.md`
- `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/specs/core-decoupling/spec.md` (delta)
- `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/tasks.md`
- `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/verify-report.md`
- `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/apply-progress.md`

### Source of Truth Updated
- `openspec/specs/core-decoupling/spec.md` — R3 and R5 updated in place

## Lessons Learned

1. **Callback seam was pre-existing but unwired**: `UseSkill` already accepted `onSkillLoaded?` before the fix; `createSkillTools` simply never accepted or forwarded it. The fix was a minimal 2-line production change — a good reminder that "broken" behavior is often a missing wire, not a missing feature.

2. **Dedupe assertion nuance**: The correct regression target for session dedupe is that the *loaded* skill is filtered from `<skill-evaluation-required>` injections — not that zero injections fire (other skills may match the same query tokens). Getting this wrong produces false negatives in the test.

3. **maxDepth deviation from baseline was deliberate**: Pre-refactor `c2d8e74` used `maxDepth: 1` for Claude-side roots; `12de52a` widened to 3 deliberately. The JSDoc now documents this intentionally and the regression net locks `maxDepth: 3` in place.

4. **Discovery breadth vs. semantic search**: The refactor kept trigger-aware search, tags, Zod validation, and path safety — only the broad/semantic embedding matcher was removed. The fix restores breadth by widening `getDefaultOpencodeRoots` to the four standard locations without reintroducing embeddings.

5. **Plugin/marketplace discovery out of scope**: The `c2d8e74` baseline also surfaced `~/.claude/plugins/cache/` and `~/.claude/plugins/marketplaces/`. The proposal correctly scoped the fix to the four standard locations only, leaving marketplace discovery as future work.

## SDD Cycle Complete

This change was fully planned (`sdd-propose`), specified (`sdd-spec`), designed (`sdd-design`), task-planned (`sdd-tasks`), implemented (`sdd-apply`), verified (`sdd-verify`), and archived (`sdd-archive`). The delta spec has been merged into `openspec/specs/core-decoupling/spec.md`. The archived change at `openspec/changes/archive/2026-06-17-fix-skill-loading-regression/` is the immutable audit trail.
