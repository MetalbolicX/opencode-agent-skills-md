# Plan 011: Fix the broken embeddings extraction (`tolot` → `tolist`)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0105477..HEAD -- src/embeddings.ts src/embeddings.test.ts`.
> If either file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0105477`, 2026-07-10

## Why this matters

The semantic-matching regression is currently broken at the extraction step. `src/embeddings.ts` calls `.tolot()` on the transformer Tensor, but the installed `@huggingface/transformers` package exposes `.tolist()`, not `.tolot`. That means the property check always fails, the raw Tensor falls through to `Array.from(...)`, and the code catches and returns `null`, which forces the matcher into the bag-of-words fallback every time. The headline fix never actually runs.

## Current state

- `src/embeddings.ts` — lazy model init, cache, cosine similarity, and fallback ranking.
- `src/embeddings.test.ts` — matcher tests; needs a regression test for real extraction.

Current excerpt (`src/embeddings.ts:171-183`):

```ts
    // Convert Tensor to number[] — tolot() returns Float32Array
    // We need to extract the data and convert to a plain number array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (tensorResult as any).tolot ? (tensorResult as any).tolot() : tensorResult;

    // Result is typically [1, hidden_size] or [hidden_size]
    let embedding: number[];
    if (Array.isArray(result)) {
      embedding = Array.isArray(result[0]) ? (result[0] as number[]) : (result as number[]);
    } else {
      // It's a typed array (Float32Array or similar)
      embedding = Array.from(result as Iterable<number>);
    }
```

Repo convention to honor: graceful degradation is fine (`AGENTS.md:16`), but the real extraction path must work when the model loads.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Test file | `bun test src/embeddings.test.ts` | all pass |
| Search for typo | `rg -n "tolot" src/` | no matches |

## Scope

**In scope**
- `src/embeddings.ts`
- `src/embeddings.test.ts`

**Out of scope**
- Do not change the lazy-init, timeout, caching, or fallback strategy.
- Do not rename public matcher APIs.

## Steps

### Step 1: Fix the tensor extraction call
Replace `.tolot()` with `.tolist()` and normalize the returned shape into a flat `number[]`. Preserve the existing fallback behavior when extraction fails, but make the real path work when the model is available.

**Verify**: `rg -n "tolot" src/` → no matches.

### Step 2: Add a regression test for real embeddings
Add a test in `src/embeddings.test.ts` that exercises `getEmbedding("hello world")` (or equivalent) after successful model init and asserts the result is a non-null vector with a stable expected length (384 for the bundled MiniLM model). If the model cannot load in the environment, skip with a clear reason; if model init succeeds and the result is `null`, fail.

**Verify**: `bun test src/embeddings.test.ts` → all pass.

## Test plan

- New regression test in `src/embeddings.test.ts` proves the real extraction path returns a vector.
- Model the test after the existing matcher/lazy-init tests in the same file.
- Verification: `bun test src/embeddings.test.ts` → all pass.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/embeddings.test.ts` exits 0; the new regression test exists and passes
- [ ] `rg -n "tolot" src/` returns no matches
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` row updated

## STOP conditions

- The live code at `src/embeddings.ts:171-183` no longer matches the excerpt above.
- `.tolist()` is unavailable on the installed transformer Tensor type.
- The fix requires touching an out-of-scope file.

## Maintenance notes

- If `@huggingface/transformers` changes tensor shape semantics, re-verify the flattened output length.
- Reviewers should confirm the test exercises the real path, not only the fallback.
