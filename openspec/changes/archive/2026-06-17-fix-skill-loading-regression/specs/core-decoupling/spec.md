# Delta for Core Decoupling

## Purpose

This delta strengthens `core-decoupling` R3 and R5 after the refactor introduced two regressions: (1) `onSkillLoaded` was dropped from the tool factory wiring, so `use_skill` no longer updates host loaded-skill state or injects `SKILL.md`; (2) `discoverAllSkills()` narrowed to literal-token search and dropped skills the pre-refactor matcher surfaced. Scope matches the proposal: no new requirements, no new spec domain — only R3 and R5 are tightened with regression scenarios.

## MODIFIED Requirements

### Requirement: Backward-Compatible Root Export (R3)

Importing `opencode-agent-skills` (the package root) SHALL return the OpenCode plugin with the same shape and behavior as before this change. The four tool names (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`) SHALL resolve. Additionally, `use_skill` SHALL visibly load a skill: the `onSkillLoaded` callback registered with `createSkillTools` SHALL fire exactly once per successful load per session, the loaded skill's `SKILL.md` content SHALL be injected into the agent context exactly once per session per skill, and the host SHALL observe the loaded-skill state update (TUI icon visible). The callback SHALL be threaded from `src/opencode/plugin.ts` → `createSkillTools` → `UseSkill`.

(Previously: only asserted the four tool names resolve; did not cover observable skill loading or session-level dedupe.)

#### Scenario: root export still loads the OpenCode plugin

- GIVEN a consumer imports the package via its root export
- WHEN the consumer resolves the four tool names from the returned plugin object
- THEN all four tool names (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`) are present
- AND the test-skill load assertion in `tests/integration/startup-smoke.test.ts` passes

#### Scenario: use_skill fires the onSkillLoaded callback

- GIVEN the host registered an `onSkillLoaded` callback via `createSkillTools`
- WHEN the agent calls `use_skill("test-skill")` on an unloaded skill
- THEN the callback is invoked exactly once with the loaded skill identifier
- AND the loaded skill's `SKILL.md` content is present in the agent context
- AND the host's loaded-skill state reflects the new skill

#### Scenario: use_skill does not re-inject the same skill in one session

- GIVEN the agent has already loaded a given skill via `use_skill` in the current session
- WHEN the agent calls `use_skill` with the same skill name again in the same session
- THEN `onSkillLoaded` is NOT re-fired for that skill
- AND the `SKILL.md` content is NOT re-injected into the context

#### Scenario: missing callback does not break the load

- GIVEN no `onSkillLoaded` is registered with `createSkillTools`
- WHEN the agent calls `use_skill("any-skill")`
- THEN the skill still loads and `SKILL.md` content is injected
- AND no thrown error or unhandled rejection occurs

### Requirement: Discovery Semantics Preservation (R5)

When the OpenCode adapter delegates to the core's `discoverAllSkills()`, the adapter SHALL observe the same four-location priority and first-match-wins semantics defined by the existing skill behavior. The set of skills surfaced for the baseline fixture locations SHALL match the set surfaced by pre-refactor commit `c2d8e74`. An integration test that mirrors `tests/integration/*` SHALL pass against the new boundary.

(Previously: asserted priority and first-match-wins but did not pin the surface skill set to the pre-refactor baseline; literal-token search was permitted to drop skills.)

#### Scenario: discovery priority and first-match-wins are preserved

- GIVEN skill fixtures exist under `.opencode/skills/`, `.claude/skills/`, `~/.config/opencode/skills/`, and `~/.claude/skills/`
- WHEN the OpenCode adapter calls `discoverAllSkills()`
- THEN the returned list follows the four-location priority
- AND duplicate skill names resolve to the first matching location
- AND the new integration test in `tests/core/` passes

#### Scenario: discoverAllSkills matches the pre-refactor skill set

- GIVEN the same fixture tree used by pre-refactor commit `c2d8e74`
- WHEN the OpenCode adapter calls `discoverAllSkills()`
- THEN every skill the baseline surfaced is also surfaced now
- AND no skill the baseline surfaced is missing from the result

#### Scenario: literal-token search does not drop the pre-refactor skill set

- GIVEN a skill whose trigger tokens are partial substrings of the user's query (not exact match)
- WHEN the user searches via the literal-token path in `discoverAllSkills()`
- THEN that skill appears in the result
- AND the four-location priority remains consistent with first-match-wins

## Notes

- No `ADDED Requirements`, no `REMOVED Requirements`, no `RENAMED Requirements`. R1, R2, R4, R6 are unchanged.
- The new R3 scenario "missing callback does not break the load" preserves the host-agnostic split (core must not assume a callback).
- The new R5 scenarios pin the pre-refactor skill set so widening discovery does not silently re-narrow.
- All scenarios are written to be TDD-friendly: each maps to one or two test cases in `tests/integration/plugin.test.ts` and `tests/opencode/plugin.test.ts`.