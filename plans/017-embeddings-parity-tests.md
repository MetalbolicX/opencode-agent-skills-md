# Plan 017: Add embeddings parity tests

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report - do not improvise. When done, update the status row for this plan in `plans/README.md`.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: test
- **Planned at**: 2026-07-10

## Why this matters

The current embeddings tests prove the matcher surface works, but they do not directly cover the pure functions that make the semantic ranking correct. Upstream has dedicated coverage for `getEmbedding`, `cosineSimilarity`, and `applyHfEndpoint`, plus a direct `matchSkills` entrypoint.

## Current state

- `src/embeddings.ts` - exports `getEmbedding`, `cosineSimilarity`, `applyHfEndpoint`, and `createMatcher`.
- `src/embeddings.test.ts` - currently exercises `createMatcher()` behavior, not the pure function surface.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Embeddings tests | `bun test src/embeddings.test.ts` | all pass |

## Scope

**In scope**
- `src/embeddings.test.ts`
- `src/embeddings.ts` only if a tiny export shim is needed for parity

**Out of scope**
- The matcher algorithm itself

## Steps

### Step 1: Add pure-function coverage
Add direct tests for `cosineSimilarity` and `applyHfEndpoint` so the low-level behavior is pinned without going through the full matcher.

### Step 2: Add real embedding coverage
Add a conditional test for `getEmbedding()` that verifies the vector length and shape when the model is available, and skips with a clear reason when the environment cannot load the model.

### Step 3: Add API parity if needed
If upstream compatibility requires it, add a tiny `matchSkills` export shim that delegates to `createMatcher().match()`.

### Step 4: Keep the tests deterministic
Use existing test patterns and avoid coupling the new tests to transient environment state.

## Test plan

- `bun test src/embeddings.test.ts` → all pass
- `bun run typecheck` → exit 0

## Done criteria

- [ ] Pure embeddings helpers have direct tests
- [ ] `getEmbedding()` behavior is pinned
- [ ] Any needed parity export is present
- [ ] `bun test src/embeddings.test.ts` exits 0
- [ ] `bun run typecheck` exits 0

## STOP conditions

- The environment cannot support a stable model-backed test even with a conditional skip.
- The export shim would change runtime behavior instead of preserving it.
