# Agent Guidelines

## Commands
- **Runtime:** Bun (`bun`).
- **Install:** `bun install`
- **Test:** `bun test` (runs all `src/*.test.ts` files in the root `src/` directory)
- **Single test file:** `bun test src/<file>.test.ts`
- **Typecheck:** `bun run typecheck` (runs `tsc --noEmit`)
- **Local plugin install:** `bun run install-local` (symlinks `src/plugin.ts` into `.opencode/plugins/`)

## Code Style
- TypeScript is strict (`noUncheckedIndexedAccess` is on); check indexed access before using it.
- ESM only; use `import`/`export` and `node:` builtins.
- Runtime validation is manual (no Zod dependency).
- Keep public functions documented with JSDoc when they are part of the plugin surface.
- Prefer graceful fallbacks over hard failures for optional discovery and compaction hooks.
- Validate user-supplied paths before reading files outside a skill root.

## Repo Structure
Single-package Bun layout under `src/`:
- `src/` — the plugin source: `plugin.ts`, `skills.ts`, `host.ts`, `tools.ts`, `search.ts`, `match.ts`, `embeddings.ts`, `preference.ts`, `preference-hooks.ts`, `parse.ts`, `utils.ts`, `types.ts`, and their corresponding test files.
- `src/index.ts` — root entrypoint, re-exports the public plugin API.
- Per-file test files: `src/*.test.ts`.
- `.opencode/plugins/` — development plugin symlink target.

## Skill Behavior
- Discovery order is `.opencode/skills/`, `.claude/skills/`, `~/.config/opencode/skills/`, then `~/.claude/skills/`.
- First match wins; duplicate skill names are ignored.
- `skill` injects `SKILL.md` into context.
- `read_skill_file` only reads inside the selected skill directory.
- `run_skill_script` only runs executable files.
- `OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true` enables the optional Superpowers bootstrap.

## Task Tracking
- Use **bd (beads)** for all issue/task tracking; do not create markdown TODO lists.
- Commit `.beads/issues.jsonl` with code changes when issue state changes.
- Run `bd sync` at the end of work sessions.
- `.github/copilot-instructions.md` mirrors the bd workflow and is the repo-local source of truth.

## Verification
- Run `bun run typecheck` before `bun test` when you need a quick smoke check.
- The full test suite: `bun test` (84 pass, 12 skip in normal conditions).
