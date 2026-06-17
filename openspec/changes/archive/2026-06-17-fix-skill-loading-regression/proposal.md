# Proposal: Fix Skill-Loading Regression

## Intent

After the core-decoupling / discovery-filtering refactor, the plugin no longer visibly loads skills as before. Two regressions: (1) `onSkillLoaded` is no longer wired through `createSkillTools`/`UseSkill`, so loaded-skill state and the TUI icon never update; (2) discovery narrowed to literal-token search over local roots, so skills the old broad/semantic matcher surfaced no longer appear — blocking the follow-up `use_skill` call. This restores observable behavior while keeping the refactor's architectural wins.

## Scope

### In Scope
- Re-wire `onSkillLoaded` through `createSkillTools` → `UseSkill` in `src/opencode/tools.ts` / `src/opencode/plugin.ts`
- Restore pre-refactor discovery breadth in `src/core/discovery.ts` (surface the same skill set as baseline commit `c2d8e74`)
- Regression tests in `tests/integration/plugin.test.ts` and `tests/opencode/plugin.test.ts`
- Strengthen `core-decoupling` spec R3/R5 with skill-loading + discovery-breadth scenarios

### Out of Scope
- Reintroducing the old semantic embedding matcher (kept: trigger-aware search, tags, Zod validation, path safety, core/host split)
- A new standalone skill-loading domain spec
- TUI/host icon changes beyond callback wiring

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `core-decoupling`: R3 (Backward-Compatible Root Export) and R5 (Discovery Semantics Preservation) are violated by the refactor. The delta strengthens both to assert observable skill loading (`onSkillLoaded` fires, `SKILL.md` injected, icon appears) and discovery breadth (same skill set as pre-refactor), plus regression scenarios.

## Approach

Smallest change restoring correctness: (1) thread `onSkillLoaded` back through the OpenCode tool factory so `use_skill` updates host loaded-skill state; (2) widen `discoverAllSkills()` to the pre-refactor source set so literal-token search no longer drops skills. Keep the new search stack; tests confirm the same skills surface. TDD: red regression test first, then green.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/opencode/tools.ts` | Modified | Re-wire `onSkillLoaded` in `createSkillTools`/`UseSkill` |
| `src/opencode/plugin.ts` | Modified | Pass loaded-state callback into tool factory |
| `src/core/discovery.ts` | Modified | Restore pre-refactor discovery breadth |
| `tests/integration/plugin.test.ts` | New | Regression: skill surfaces + callback fires |
| `tests/opencode/plugin.test.ts` | New | Regression: loaded-state update + icon |
| `openspec/specs/core-decoupling/spec.md` | Modified (via delta) | Strengthen R3/R5 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Widening discovery re-introduces duplicate / first-match bugs | Low | R5 first-match-wins tests already exist; extend them |
| Fix scope grows beyond callback + discovery | Med | Delivery strategy `force-chained` → split into stacked PRs at the 400-line budget |
| Literal-token search still misses edge skills after breadth fix | Low | Regression test mirrors the pre-refactor fixture set from `c2d8e74` |

## Rollback Plan

Revert the fix commits; the refactor stays intact (regression returns but the build stays green). Changes are isolated to `src/opencode/{tools,plugin}.ts` + `src/core/discovery.ts`, so rollback is a clean `git revert` of the fix PR(s).

## Dependencies

- Reference baseline: commit `c2d8e74` (pre-refactor `src/plugin.ts` / `src/tools.ts`)
- Engram observations: #1734 (discovery), #1736 (decision), #664 (config)

## Success Criteria

- [ ] `use_skill` visibly loads a skill: `SKILL.md` injected, `onSkillLoaded` fires, TUI icon appears
- [ ] `discoverAllSkills()` surfaces the same skill set as `c2d8e74` for the fixture locations
- [ ] `pnpm run typecheck` clean; `pnpm test` (integration + opencode layers) green
- [ ] `core-decoupling` delta spec R3/R5 scenarios pass
