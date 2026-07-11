# Proposal: Prune dead code

## Intent
Remove confusing dead code so the live bootstrap and ranking logic have a single source of truth.

## Problem
`src/superpowers.ts` is an unused no-op stub, and `matchSkillsByKeyword` is exported even though the plugin routes through the embeddings matcher.

## Scope
- Delete the unused `src/superpowers.ts` stub.
- Remove `matchSkillsByKeyword` if no tests depend on it, or mark it internal if it must stay.

## Non-goals
- Do not move or rewrite the real Superpowers bootstrap logic.
- Do not change ranking behavior.

## Risks
- A test may still import `matchSkillsByKeyword`; if so, keep the helper and document it as internal.

## Related plan
- `plans/013-prune-dead-code.md`
