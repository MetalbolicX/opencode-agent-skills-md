# Design: Fix Skill-Loading Regression

## Technical Approach

Restore the two regressions captured in Engram #1734 (`bugfix/skill-loading-regression`) and #1736 (`bugfix/skill-loading-regression-plan`) with the smallest host-adapter changes. First, thread the existing `onSkillLoaded` callback from `SkillsPlugin` through `createSkillTools()` into `UseSkill()` so a successful `use_skill` call updates session loaded-skill state again. Second, align `discoverAllSkills()` default source coverage with the pre-refactor baseline (`c2d8e74`) while keeping the current core/host split, search engine, tag filtering, trigger-aware ranking, Zod parsing, and path-safety checks intact. This design implements the proposal and gives the pending `core-decoupling` R3/R5 spec delta concrete code targets.

Strict TDD order: add failing regression tests first, implement the minimum wiring/discovery fix, then refactor only if duplication appears.

## Architecture Decisions

### Decision: Restore loaded-skill state through the existing callback seam

| Option | Tradeoff | Decision |
|---|---|---|
| Update `loadedSkillsPerSession` directly inside `UseSkill` | Couples tool code to plugin session state | Rejected |
| Pass `onSkillLoaded` from `plugin.ts` → `createSkillTools()` → `UseSkill()` | Small signature change, preserves core/host boundaries | Chosen |

Rationale: the callback already exists in `UseSkill`; the regression is that `createSkillTools()`/`SkillsPlugin` stopped threading it.

### Decision: Restore discovery breadth in `core/discovery.ts`, not in search or host code

| Option | Tradeoff | Decision |
|---|---|---|
| Reintroduce old semantic matcher | Larger rollback, discards current trigger/tag work | Rejected |
| Expand default discovery roots/source handling to match baseline coverage | Narrow fix, keeps current search/ranking stack | Chosen |

Rationale: discovery breadth is a source-enumeration concern. `searchSkills()`, trigger scoring, Zod validation, and safe file access stay unchanged.

## Data Flow

```text
chat.message
  -> getSkillSummaries() / matchSkillsByKeyword()
  -> synthetic skill-evaluation prompt
  -> model calls use_skill
  -> createSkillTools().UseSkill()
  -> host.injectContent(<skill ...>)
  -> onSkillLoaded(sessionID, skillName)
  -> loadedSkillsPerSession.add(skillName)
  -> later chat.message skips already-loaded skills

discoverAllSkills(directory)
  -> baseline-aligned default roots
  -> findSkillsRecursive()
  -> parseSkillFile() [Zod]
  -> Map<string, Skill> first-match-wins
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/opencode/tools.ts` | Modify | Add an optional `onSkillLoaded` parameter to `createSkillTools()` and pass it into `UseSkill()` without changing tool behavior otherwise. |
| `src/opencode/plugin.ts` | Modify | Provide the callback that records loaded skills per session and keep keyword matching / synthetic injection behavior unchanged. |
| `src/core/discovery.ts` | Modify | Reconcile default discovery roots/source handling with baseline `c2d8e74`, preserving first-match-wins and duplicate warnings. |
| `tests/integration/plugin.test.ts` | Modify | Add RED/GREEN regression coverage for baseline discovery breadth and end-to-end tool loading behavior. |
| `tests/opencode/plugin.test.ts` | Modify | Add focused host-adapter regression coverage proving `use_skill` updates loaded-skill session state and prevents duplicate re-suggestion. |

## Interfaces / Contracts

```ts
type OnSkillLoaded = (sessionID: string, skillName: string) => void;

export function createSkillTools(
  host: OpencodeSkillHost,
  $: PluginInput["$"],
  directory: string,
  onSkillLoaded?: OnSkillLoaded
): SkillTools;
```

`getDefaultOpencodeRoots(directory)` remains the canonical discovery-source definition. The fix may adjust its returned roots/depths to match the pre-refactor baseline, but it must continue returning `DiscoveryPath[]` and must not move host-specific knowledge into search or parsing modules.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/host | `use_skill` marks a skill as loaded again | In `tests/opencode/plugin.test.ts`, call `use_skill`, then send a matching message and assert no duplicate matched-skill injection is produced for that session. |
| Integration | Discovery returns the baseline-visible skill set | In `tests/integration/plugin.test.ts`, extend the temp workspace as needed and compare discovered labels/names against the pre-refactor source expectations. |
| Integration | Tool wiring still injects skill content | Reuse the mock host client to assert `<skill ...>` injection still happens while the callback seam is restored. |
| E2E | N/A | No separate UI harness; session bookkeeping is the local proxy for icon-visible behavior. |

## Migration / Rollout

No migration required. Rollout is a normal bugfix; if the change grows past the 400-line review budget, keep the delivery split aligned with the force-chained stacked PR strategy.

## Open Questions

- [ ] None; verify the exact restored source set against `c2d8e74` during RED test authoring.
