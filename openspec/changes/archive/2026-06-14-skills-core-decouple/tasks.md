# Tasks: Skills Core Decouple

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR1≈350; PR2≈250; PR3≈150; aggregate≈750 |
| 400-line budget risk | Low per PR |
| Chained PRs recommended | Yes |
| Suggested split | PR1 core-extraction → PR2 opencode-adapter → PR3 subpath-exports |
| Delivery strategy | force-chained |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Extract portable core with import guard | PR 1 | Base=main; merge after `pnpm run typecheck` + `pnpm test` |
| 2 | Add OpenCode host and thin adapter | PR 2 | Base=main after PR1 merge; keep root behavior unchanged |
| 3 | Publish subpath exports and built smoke tests | PR 3 | Base=main after PR2 merge; verify build + e2e |

## Phase 1: PR1 — Core Extraction

- [x] 1.1 Capture a green baseline with `pnpm run typecheck` and `pnpm test` before moving files.
- [x] 1.2 RED: add `tests/core/agnostic.test.ts` with a static walk over `dist/core/**` for zero `@opencode-ai/plugin` imports.
- [x] 1.3 Move host-agnostic code from `src/utils.ts` and `src/skills.ts` into `src/core/{types,parse,discovery,scripts,match,content}.ts`.
- [x] 1.4 Add `src/core/index.ts`; update `src/utils.ts` and `src/skills.ts` to re-export or consume core without behavior changes.
- [x] 1.5 Update `rolldown.config.js` for a temporary `dist/core` entry while preserving the current plugin build. *(Superseded by PR3 3.2 — multi-entry build emits both `dist/opencode/index.js` and `dist/core/index.js` plus the legacy `dist/plugin.mjs` alias.)*
- [x] 1.6 GREEN gate: `pnpm run typecheck` and `pnpm test` pass with the new core boundary.

## Phase 2: PR2 — OpenCode Adapter

- [x] 2.1 Add `src/opencode/host.ts` as the only concrete `SkillHostClient` and `SkillHostSession` implementation.
- [x] 2.2 Add `src/opencode/tools.ts` and rewrite tool factories to compose core logic through the host.
- [x] 2.3 Move plugin composition to `src/opencode/plugin.ts`; keep `src/plugin.ts` as a thin compatibility shim until PR3.
- [x] 2.4 Move `src/superpowers.ts` to `src/opencode/superpowers.ts` and wire `src/opencode/index.ts` as the adapter entry.
- [x] 2.5 Verify R5/R6 by running `tests/integration/plugin.test.ts` and `tests/e2e/startup-smoke.test.ts` unchanged.
- [x] 2.6 GREEN gate: `pnpm run typecheck` and `pnpm test` pass before merge.

## Phase 3: PR3 — Subpath Exports (public surface change)

- [x] 3.1 Add `exports` map to `package.json` with `.` and `./core` subpaths (each with `types` + `import` + `default` conditions) and point `main` at `dist/opencode/index.js`.
- [x] 3.2 Rewrite `rolldown.config.js` to multi-entry emit `dist/opencode/index.js` and `dist/core/index.js`; add `tsconfig.build.json` for `tsc --emitDeclarationOnly` so `.d.ts` files travel with the JS chunks.
- [x] 3.3 Add `tests/core/subpath.test.ts` — resolves `opencode-agent-skills/core` via the package's exports field, asserts the portable API is exported, and walks the built chunk to prove no `@opencode-ai/plugin` reference leaks in.
- [x] 3.4 Add `tests/opencode/subpath.test.ts` — resolves `opencode-agent-skills` (root) via the exports field, asserts the default export + `SkillsPlugin` are the same factory function, and proves module load is side-effect safe.
- [x] 3.5 Add `pretest` hook that runs `pnpm run build` first so the subpath tests always run against fresh built artifacts.
- [x] 3.6 Remove `src/plugin.ts` compat shim (now redundant); build entry is `src/opencode/index.ts` directly. A legacy `dist/plugin.mjs` alias is preserved via a third rolldown entry so any downstream consumer still importing the old path keeps working.
- [x] 3.7 Update `README.md` with a "Programmatic subpath exports" section documenting both subpaths, the intended consumer (harness authors), and a code example using the core.
- [x] 3.8 GREEN gate (final): `pnpm run typecheck` + `pnpm test` + `pnpm run build` all green; the new subpath tests pass against the freshly built artifacts.
- [x] 3.9 Update `openspec/changes/skills-core-decouple/tasks.md` to mark all PR3 tasks done and persist the final apply-progress to engram.

### PR3 Outcome

- `pnpm run typecheck` — clean (0 errors)
- `pnpm test` — 42/42 (21 unit + 3 agnostic + 3 core-subpath + 8 opencode-host + 3 opencode-subpath + 3 integration + 1 e2e)
- `pnpm run build` — emits `dist/opencode/{index.js,index.d.ts,...}`, `dist/core/{index.js,index.d.ts,...}`, and the legacy `dist/plugin.mjs` alias
- The `src/opencode/tools.ts` factory consts needed explicit `: ReturnType<typeof tool>` annotations to break a Zod-shape leak in the inferred return type that broke `tsc --emitDeclarationOnly` with TS2883 (non-portable inferred type). Internal change only — no behavior delta, no public API change.
- The `package.json#exports` block needed a `default` condition on each subpath in addition to `import` so Node 24 can resolve the package via self-reference when called from a CJS context (`require.resolve`).
- The integration test (`tests/integration/plugin.test.ts`) and the e2e test (`tests/e2e/startup-smoke.test.ts`) had their import targets updated to the new entry points (`src/opencode` and `dist/opencode/index.js` respectively).
