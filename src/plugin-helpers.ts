/**
 * Stateless helpers extracted from plugin.ts (C8).
 *
 * These functions have no I/O, no external state dependencies, and are pure.
 * They are kept in a separate module for testability and clarity.
 */

/** Maximum number of sessions to track before LRU eviction kicks in. */
export const MAX_TRACKED_SESSIONS = 100;

/**
 * Time-to-live for a session in milliseconds.
 * Sessions idle longer than this are considered stale and evicted.
 * Default: 30 minutes (30 * 60 * 1000).
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Session state helpers
// ---------------------------------------------------------------------------

/**
 * Live session state record — tracks what skills have been loaded, marked
 * pending, or injected into the chat for a given session.
 *
 * `setupComplete` is set to true once the bootstrap block (superpowers +
 * available-skills) has been appended to the chat output. It gates
 * `isFirstMessageSetup` so the bootstrap is injected exactly once per session.
 */
export interface SessionState {
  setupComplete: boolean;
  loadedSkills: Set<string>;
  pendingSkills: Set<string>;
  injectedSummaries: Set<string>;
  lastTouchedAt: number;
}

export const touchSessionState = (
  state: Map<string, SessionState>,
  sessionID: string,
  now: number,
): SessionState => {
  evictSessionState(state, now);
  const existing = state.get(sessionID);
  if (existing) {
    existing.lastTouchedAt = now;
    return existing;
  }
  const fresh: SessionState = {
    setupComplete: false,
    loadedSkills: new Set(),
    pendingSkills: new Set(),
    injectedSummaries: new Set(),
    lastTouchedAt: now,
  };
  state.set(sessionID, fresh);
  return fresh;
};

export const evictSessionState = (
  state: Map<string, SessionState>,
  now: number,
): string[] => {
  const evicted: string[] = [];
  for (const [id, record] of state) {
    if (now - record.lastTouchedAt > SESSION_TTL_MS) {
      evicted.push(id);
    }
  }
  for (const id of evicted) {
    state.delete(id);
  }
  if (state.size >= MAX_TRACKED_SESSIONS) {
    const sorted = Array.from(state.entries()).sort(
      (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt,
    );
    const excess = state.size - (MAX_TRACKED_SESSIONS - 1);
    for (let i = 0; i < excess; i++) {
      const entry = sorted[i];
      if (entry) {
        const [id] = entry;
        state.delete(id);
        evicted.push(id);
      }
    }
  }
  return evicted;
};

export const deleteSessionState = (
  state: Map<string, SessionState>,
  sessionID: string,
): boolean => {
  return state.delete(sessionID);
};

// ---------------------------------------------------------------------------
// Chat message helpers
// ---------------------------------------------------------------------------

export interface ChatMessageOutput {
  message?: {
    id?: string;
    sessionID?: string;
    role?: string;
    model?: { providerID: string; modelID: string };
    agent?: string;
  };
  parts?: Array<{
    id?: string;
    sessionID?: string;
    messageID?: string;
    type?: string;
    text?: string;
    synthetic?: boolean;
  }>;
}

// Type guard for chat text part — exported for unit testing
export const isChatTextPart = (
  part: unknown,
): part is { type?: string; text?: string; synthetic?: boolean } => {
  if (typeof part !== "object" || part === null) return false;
  return (part as { type?: string }).type === "text";
};

/**
 * Append a synthetic text part to the chat.message output.
 * Synthetic parts are invisible to keyword matching and are not re-injected
 * after compaction — the next bootstrap recomputes them from scratch.
 *
 * The part must satisfy OpenCode's TextPart schema: `id` must start with `prt_`,
 * `messageID` must start with `msg_`, and `sessionID` must start with `ses_`.
 * We derive sessionID and messageID from the output message (UserMessage)
 * which is guaranteed to have valid values when the hook runs.
 */
export const appendSyntheticText = (
  output: ChatMessageOutput,
  text: string,
): void => {
  output.parts ??= [];
  const sessionID = output.message?.sessionID ?? "";
  const messageID = output.message?.id ?? "";
  output.parts.push({
    id: `prt_${crypto.randomUUID().replace(/-/g, "")}`,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  });
};
