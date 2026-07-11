# Proposal: Harden the chat session lifecycle

## Intent
Make session handling more reliable and less wasteful by tightening message-part filtering, retrying bootstrap after compaction failure, and reusing discovery results within a turn.

## Problem
`src/plugin.ts` currently accepts any object as text content, never clears `setupComplete` after compaction, and performs duplicate discovery work in the same turn.

## Scope
- Require `type === "text"` for user-text extraction.
- Reset `setupComplete` on compaction.
- Cache discovery results within a turn/session window.
- Add regression tests for these behaviors.

## Non-goals
- Do not change discovery ordering or duplicate handling.
- Do not alter the embeddings matcher.

## Risks
- Caching must not leak across sessions or change first-match semantics.

## Related plan
- `plans/012-harden-chat-session-lifecycle.md`
