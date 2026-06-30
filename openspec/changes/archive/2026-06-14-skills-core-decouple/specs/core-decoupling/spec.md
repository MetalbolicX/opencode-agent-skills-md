# Core Decoupling Specification

## Purpose

This spec defines the boundary between the portable core skills engine and the OpenCode-specific adapter in the `opencode-agent-skills-md` package. It guarantees that the core is reusable by any host while OpenCode users see no behavior change. This domain is introduced by the `skills-core-decouple` change; there is no prior baseline to delta against, so this file is the initial full definition.

## Requirements

### Requirement: Core Module Independence (R1)

The `src/core/**` module graph SHALL contain zero runtime imports from `@opencode-ai/plugin`. A static import walk (AST or regex over the compiled dependency graph of `src/core/**`) SHALL fail the build if any such import is detected.

### Requirement: Boundary Interface Location (R2)

The interfaces `SkillHostClient` and `SkillHostSession` SHALL be declared in `src/core/types.ts`. The concrete OpenCode implementation of those interfaces SHALL exist only in `src/opencode/host.ts`. No other module SHALL contain a concrete implementation of either interface.

### Requirement: Backward-Compatible Root Export (R3)

Importing `opencode-agent-skills-md` (the package root) SHALL return the OpenCode plugin with the same shape and behavior as before this change. A smoke test that loads the package and resolves the four tool names (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`) SHALL pass.

### Requirement: Framework-Agnostic Subpath Export (R4)

Importing `opencode-agent-skills-md/core` SHALL resolve to the core modules only. A smoke import of the subpath SHALL NOT trigger any side effect, top-level await, or transitive import from `@opencode-ai/plugin`.

### Requirement: Discovery Semantics Preservation (R5)

When the OpenCode adapter delegates to the core's `discoverAllSkills()`, the adapter SHALL observe the same four-location priority and first-match-wins semantics defined by the existing skill behavior. An integration test that mirrors `tests/integration/*` SHALL pass against the new boundary.

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

### Scenario: root export still loads the OpenCode plugin

- GIVEN a consumer imports the package via its root export
- WHEN the consumer resolves the four tool names from the returned plugin object
- THEN all four tool names (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`) are present
- AND the test-skill load assertion in `tests/integration/startup-smoke.test.ts` continues to pass

### Scenario: subpath export does not pull in the OpenCode SDK

- GIVEN a consumer imports `opencode-agent-skills-md/core` in a fresh process
- WHEN the import resolves and the module graph is recorded
- THEN no module under `node_modules/@opencode-ai/plugin` appears in the resolved graph
- AND no side effect from the SDK runs at import time

### Scenario: discovery priority and first-match-wins are preserved

- GIVEN skill fixtures exist under `.opencode/skills/`, `.claude/skills/`, `~/.config/opencode/skills/`, and `~/.claude/skills/`
- WHEN the OpenCode adapter calls `discoverAllSkills()`
- THEN the returned list follows the four-location priority
- AND duplicate skill names resolve to the first matching location
- AND the new integration test in `tests/core/` passes

### Scenario: public tool surface is unchanged

- GIVEN the refactor is complete and `pnpm run typecheck` is clean
- WHEN `pnpm test` runs the existing `tests/integration/*` and `tests/e2e/*` suites
- THEN all existing assertions on tool names, parameter shapes, and error messages continue to pass without modification
