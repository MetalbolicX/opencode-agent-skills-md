# Proposal: Fix broken embeddings extraction

## Intent
Restore the real HuggingFace embeddings extraction path in `src/embeddings.ts` so the semantic matcher actually runs instead of always falling back to bag-of-words.

## Problem
The current implementation calls `.tolot()` on the transformer Tensor. That method does not exist in the installed `@huggingface/transformers` package, so extraction fails and returns `null` on every call.

## Scope
- Fix the tensor extraction call and normalize the returned shape.
- Add a regression test that proves `getEmbedding()` returns a real vector when the model loads.

## Non-goals
- Do not change the lazy-init, timeout, caching, or fallback strategy.
- Do not change public matcher APIs.

## Risks
- Tensor output shape can vary across transformer versions; the implementation must flatten the batch dimension safely.

## Related plan
- `plans/011-fix-broken-embeddings-extraction.md`
