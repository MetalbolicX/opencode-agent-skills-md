# Core Decoupling Specification

## Purpose

This spec defines the boundary between the portable core skills engine and the OpenCode-specific adapter in the `opencode-agent-skills` package. It guarantees that the core is reusable by any host while OpenCode users see no behavior change. This domain is introduced by the `skills-core-decouple` change; there is no prior baseline to delta against, so this file is the initial full definition.

## Requirements

### Requirement: Core Module Independence (R1)

The `src/core/**` module graph SHALL contain zero runtime imports from `@opencode-ai/plugin`. A static import walk (AST or regex over the compiled dependency graph of `src/core/**`) SHALL fail the build if any such import is detected.

### Requirement: Boundary Interface Location (R2)

The interfaces `SkillHostClient` and `SkillHostSession` SHALL be declared in `src/core/types.ts`. The concrete OpenCode implementation of those interfaces SHALL exist only in `src/opencode/host.ts`. No other module SHALL contain a concrete implementation of either interface.

### Requirement: Backward-Compatible Root Export (R3)

Importing `opencode-agent-skills` (the package root) SHALL return the OpenCode plugin with the same shape and behavior as before this change. The four tool names (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`) SHALL resolve. Additionally, `use_skill` SHALL visibly load a skill: the `onSkillLoaded` callback registered with `createSkillTools` SHALL fire exactly once per successful load per session, the loaded skill's `SKILL.md` content SHALL be injected into the agent context exactly once per session per skill, and the host SHALL observe the loaded-skill state update (TUI icon visible). The callback SHALL be threaded from `src/opencode/plugin.ts` → `createSkillTools` → `UseSkill`.

### Requirement: Framework-Agnostic Subpath Export (R4)

Importing `opencode-agent-skills/core` SHALL resolve to the core modules only. A smoke import of the subpath SHALL NOT trigger any side effect, top-level await, or transitive import from `@opencode-ai/plugin`.

### Requirement: Discovery Semantics Preservation (R5)

When the OpenCode adapter delegates to the core's `discoverAllSkills()`, the adapter SHALL observe the same four-location priority and first-match-wins semantics defined by the existing skill behavior. The set of skills surfaced for the baseline fixture locations SHALL match the set surfaced by pre-refactor commit `c2d8e74`. An integration test that mirrors `tests/integration/*` SHALL pass against the new boundary.

### Requirement: Public Surface Freeze (R6)

The four tool names, their parameter shapes, and their user-visible error messages SHALL remain unchanged. Existing tests under `tests/integration/*` and `tests/e2e/*` SHALL pass without modification.

## Scenarios

### Scenario: core is decoupled from the OpenCode SDK

- GIVEN the `src/core/**` module graph is fully composed
- WHEN a static import walk scans every file in that graph for `from "@opencode-ai/plugin"`
- THEN zero matches are reported
- AND the test `tests/core/agnostic.test.ts` passes

### Scenario: opencode host is the only concrete implementation

- GIVEN the interfaces `SkillHostClient` and `SkillHostSession` exist in `src/core/types.ts`
- WHEN the codebase is searched for classes or factories that implement either interface
- THEN exactly one match exists, located in `src/opencode/host.ts`

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

### Scenario: subpath export does not pull in the OpenCode SDK

- GIVEN a consumer imports `opencode-agent-skills/core` in a fresh process
- WHEN the import resolves and the module graph is recorded
- THEN no module under `node_modules/@opencode-ai/plugin` appears in the resolved graph
- AND no side effect from the SDK runs at import time

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

### Scenario: public tool surface is unchanged

- GIVEN the refactor is complete and `pnpm run typecheck` is clean
- WHEN `pnpm test` runs the existing `tests/integration/*` and `tests/e2e/*` suites
- THEN all existing assertions on tool names, parameter shapes, and error messages continue to pass without modification
