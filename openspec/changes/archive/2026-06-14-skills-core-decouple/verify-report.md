# Verification Report: skills-core-decouple

**Change:** skills-core-decouple
**Phase:** verify
**Mode:** strict_tdd=true
**Date:** 2026-06-14

---

## Command Evidence

| Command | Result | Evidence |
|---------|--------|----------|
| `pnpm run typecheck` | PASS | `tsc --noEmit` exits 0, 0 errors |
| `pnpm test` | PASS | 42/42 tests pass (21 unit + 3 agnostic + 3 core-subpath + 8 opencode-host + 3 opencode-subpath + 3 integration + 1 e2e) |
| `pnpm run build` | PASS | Emits `dist/opencode/index.js`, `dist/core/index.js`, `dist/_chunks/*`, and legacy `dist/plugin.mjs` alias |

---

## Requirement Compliance Matrix

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Core module independence | **PASS** | Grep `@opencode-ai/plugin` in `src/core/**/*.ts` → 0 matches. Test `tests/core/agnostic.test.ts` passes. |
| R2 — Boundary interface | **PASS** | `SkillHostClient` and `SkillHostSession` declared in `src/core/types.ts`. Only `src/opencode/host.ts` contains a concrete implementation. Grep across `src/` shows no other implementation. |
| R3 — Backward-compatible root export | **PASS** | `tests/opencode/subpath.test.ts` passes: root resolves to `dist/opencode/index.js`, default export is `SkillsPlugin` factory. Tool names unchanged (`get_available_skills`, `read_skill_file`, `run_skill_script`, `use_skill`). |
| R4 — Framework-agnostic subpath export | **PASS** | `tests/core/subpath.test.ts` passes: `opencode-agent-skills-md/core` resolves via exports field to `dist/core/index.js`. Build emits `dist/core/index.js` + `.d.ts` files. Static walk of dist proves no `@opencode-ai/plugin` reference leaks in. |
| R5 — Discovery semantics preservation | **PASS** | `src/core/discovery.ts` `getDefaultOpencodeRoots()` defines 4-location priority (`.opencode/skills/`, `.claude/skills/`, `~/.config/opencode/skills/`, `~/.claude/skills/`). First-match-wins implemented at line 130: `if (!skill || skillsByName.has(skill.name)) continue;`. `tests/integration/plugin.test.ts` passes. |
| R6 — Public surface freeze | **PASS** | `src/opencode/tools.ts` creates 4 tool factories with unchanged names (`GetAvailableSkills`, `ReadSkillFile`, `RunSkillScript`, `UseSkill`). All `tests/integration/*` and `tests/e2e/*` pass without modification. |

---

## Spec Scenario Compliance

| Scenario | Covered By | Result |
|----------|------------|--------|
| core is decoupled from the OpenCode SDK | `tests/core/agnostic.test.ts` + static grep | PASS |
| opencode host is the only concrete implementation | `src/opencode/host.ts` + grep search | PASS |
| root export still loads the OpenCode plugin | `tests/opencode/subpath.test.ts` | PASS |
| subpath export does not pull in the OpenCode SDK | `tests/core/subpath.test.ts` | PASS |
| discovery priority and first-match-wins are preserved | `tests/integration/plugin.test.ts` | PASS |
| public tool surface is unchanged | All test suites (42/42) | PASS |

---

## Task Completion

All tasks in `openspec/changes/skills-core-decouple/tasks.md` are checked `[x]`.

---

## Findings

### CRITICAL
None.

### WARNING
None.

### SUGGESTION
None.

---

## Final Verdict

**PASS**

All 6 requirements verified. All 42 tests green. Build emits both subpaths correctly. Public surface unchanged.

---

## Next Recommended

`sdd-archive` — ready to sync delta specs and close the change.