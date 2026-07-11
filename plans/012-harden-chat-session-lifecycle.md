# Plan 012: Harden the chat session lifecycle

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0105477..HEAD -- src/plugin.ts src/plugin.test.ts`.
> If either file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0105477`, 2026-07-10

## Why this matters

Three correctness/reliability issues share the same plugin lifecycle surface and should be fixed together: (1) `isChatTextPart` accepts any non-null object, so non-text parts can leak into keyword matching; (2) the compaction path clears the tracked skill sets but leaves `setupComplete = true`, so a failed reinjection is never retried; (3) `discoverAllSkills` is invoked twice for the same turn (once in `chat.message`, once in `experimental.chat.system.transform`), which doubles filesystem/parsing work across six discovery roots. This plan hardens the chat lifecycle without changing the feature set.

## Current state

- `src/plugin.ts` — message handling, compaction handling, preference hooks, and skill injection.
- `src/plugin.test.ts` — plugin behavior tests; add regression cases here.
- `src/skills.ts` — skill discovery; leave the signature alone, but reuse results from the plugin if possible.

Current excerpts:

`src/plugin.ts:459-462`
```ts
function isChatTextPart(part: unknown): part is { type?: string; text?: string; synthetic?: boolean } {
  if (typeof part !== "object" || part === null) return false;
  return true;
}
```

`src/plugin.ts:396-408`
```ts
      if (event.type === "session.compacted") {
        const sessionID = event.properties?.sessionID;
        if (typeof sessionID !== "string") {
          debugLog("event: session.compacted missing sessionID", event);
          return;
        }
        const context = await host.client.getSessionContext(sessionID);
        await maybeInjectSuperpowersBootstrap(directory, host, sessionID, context);
        await injectSkillsList(directory, host, sessionID, context);
        const record = touchSessionState(sessionStates, sessionID, Date.now());
        record.loadedSkills.clear();
        record.pendingSkills.clear();
        record.injectedSummaries.clear();
        return;
      }
```

`src/plugin.ts:363` and `src/plugin.ts:445`
```ts
      const skillsByName = await discoverAllSkills(directory);
```

Repo conventions to preserve:
- Graceful fallback for optional discovery/compaction hooks (`AGENTS.md:16`).
- First-match duplicate semantics must remain intact (`AGENTS.md:28`).
- Keep the preference layer behavior unchanged; this plan is only about lifecycle correctness.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Test file | `bun test src/plugin.test.ts` | all pass |

## Scope

**In scope**
- `src/plugin.ts`
- `src/plugin.test.ts`

**Out of scope**
- `src/embeddings.ts` (plan 011 handles semantic extraction).
- `src/skills.ts` public API and discovery ordering.

## Steps

### Step 1: Tighten text-part detection
Change `isChatTextPart` so only real text parts are accepted. Require `part.type === "text"` (and keep the structural check for objects/null). Preserve the existing synthetic-part filtering in the caller.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Reset setup state on compaction
In the `session.compacted` branch, after clearing the skill sets, set `record.setupComplete = false;` so the next `chat.message` can retry bootstrap if the reinjection path failed.

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Reuse discovery results within the same turn
Introduce a plugin-scoped cache or turn-scoped promise so the `chat.message` handler and `experimental.chat.system.transform` share the same `discoverAllSkills` result for one turn/session window. Invalidate the cache on compaction. Do not change root order, duplicate handling, or skill resolution semantics.

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Add regression tests
Add tests in `src/plugin.test.ts` for:
- non-text parts are ignored by the user-text extraction path;
- after compaction, the next message can re-run bootstrap when setup was not completed;
- (if feasible) discovery is not repeated within one turn.

**Verify**: `bun test src/plugin.test.ts` → all pass.

## Test plan

- Add targeted plugin behavior tests in `src/plugin.test.ts`.
- Use the existing plugin test structure as the pattern.
- Verification: `bun test src/plugin.test.ts` → all pass.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/plugin.test.ts` exits 0; the new tests exist and pass
- [ ] `isChatTextPart` returns false for non-text parts
- [ ] `setupComplete` is reset on compaction
- [ ] Discovery is reused within the same turn/session window
- [ ] No files outside scope modified
- [ ] `plans/README.md` row updated

## STOP conditions

- The live code in `src/plugin.ts` differs materially from the excerpts above.
- The OpenCode SDK part schema requires a different discriminator than `type === "text"`.
- Caching discovery would alter first-match or duplicate behavior.

## Maintenance notes

- Reviewers should confirm the cache invalidation does not leak across sessions/directories.
- If discovery needs a stronger invalidation signal later, keep the plugin-side cache small and conservative.
