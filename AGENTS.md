# Agent Guidelines

## Commands
- **Package manager:** pnpm.
- **Install:** `pnpm install`
- **Test:** `pnpm test` (runs `pnpm -r --no-bail test` for both packages, then the workspace contract test if all packages pass)
- **Workspace contract test only:** `pnpm run test:workspace` (runs `node --import tsx --test tests/workspace.test.ts`)
- **Single test file:** `pnpm -F opencode-agent-skills-md-core exec node --import tsx --test tests/<file>.test.ts` (or any file inside a package's `tests/`)
- **Typecheck:** `pnpm run typecheck` (delegates to `pnpm -r run typecheck`)
- **Build:** `pnpm run build` (delegates to `pnpm -r --workspace-concurrency=1 run build`)

## Code Style
- TypeScript is strict (`noUncheckedIndexedAccess` is on); check indexed access before using it.
- ESM only; use `import`/`export` and `node:` builtins.
- Runtime validation is manual (no Zod dependency).
- Keep public functions documented with JSDoc when they are part of the plugin surface.
- Prefer graceful fallbacks over hard failures for optional discovery and compaction hooks.
- Validate user-supplied paths before reading files outside a skill root.

## Repo Structure
This is a pnpm workspace with two packages:
- `packages/core/src/` — the portable, host-agnostic skills engine (`opencode-agent-skills-md-core`). Discovery, parsing, search, and the `SkillHostClient` / `SkillHostSession` boundary contracts.
- `packages/opencode-agent-skills-md/src/` — the OpenCode plugin adapter (`opencode-agent-skills-md`). The four skill tools, the OpenCode host implementation, and the plugin factory.
- Per-package tests live inside `packages/<pkg>/tests/`.
- The repo root is a private workspace manifest (`package.json`) with no source of its own; legacy `src/`, root `tests/`, root `rolldown.config.js`, and root `tsconfig.build.json` were removed in favor of the per-package locations.

## Skill Behavior
- Discovery order is `.opencode/skills/`, `.claude/skills/`, `~/.config/opencode/skills/`, then `~/.claude/skills/`.
- First match wins; duplicate skill names are ignored.
- `use_skill` injects `SKILL.md` into context.
- `read_skill_file` only reads inside the selected skill directory.
- `run_skill_script` only runs executable files.
- `OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true` enables the optional Superpowers bootstrap.

## Task Tracking
- Use **bd (beads)** for all issue/task tracking; do not create markdown TODO lists.
- Commit `.beads/issues.jsonl` with code changes when issue state changes.
- Run `bd sync` at the end of work sessions.
- `.github/copilot-instructions.md` mirrors the bd workflow and is the repo-local source of truth.

## Verification
- Prefer `pnpm run typecheck` before `pnpm test` when you need a quick smoke check.
- Keep docs aligned with the actual repo workflow; Bun references are stale and should not be reintroduced.