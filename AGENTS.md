# Agent Guidelines

## Commands
- **Package manager:** pnpm.
- **Install:** `pnpm install`
- **Test:** `pnpm test`
- **Single test file:** `node --import tsx --test src/utils.test.ts` (or the matching file in `tests/**`)
- **Typecheck:** `pnpm run typecheck`
- **Build:** `pnpm run build`

## Code Style
- TypeScript is strict (`noUncheckedIndexedAccess` is on); check indexed access before using it.
- ESM only; use `import`/`export` and `node:` builtins.
- Runtime validation uses Zod.
- Keep public functions documented with JSDoc when they are part of the plugin surface.
- Prefer graceful fallbacks over hard failures for optional discovery and compaction hooks.
- Validate user-supplied paths before reading files outside a skill root.

## Repo Structure
- `src/plugin.ts` is the plugin entrypoint.
- `src/tools.ts` defines the four skill tools.
- `src/skills.ts` handles discovery, parsing, and resolution.
- `src/superpowers.ts` injects the optional Superpowers bootstrap.
- Tests live in `src/*.test.ts` plus `tests/integration/` and `tests/e2e/`.

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
