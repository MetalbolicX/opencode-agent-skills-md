/**
 * Per-session state management with TTL eviction.
 *
 * Tracks loaded/pending/injected skills and bootstrap setup state
 * per OpenCode session.
 */

import type { SessionTracker } from "./types";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Creates a SessionTracker instance.
 * The tracker wraps an internal Map and exposes read-only snapshots
 * via ReadonlySet for loadedSkills, pendingSkills, and injectedSummaries.
 */
export const createSessionTracker = (ttlMs: number = DEFAULT_TTL_MS): SessionTracker => {
  let _lastTouchedAt = Date.now();
  let _setupComplete = false;
  const _loaded = new Set<string>();
  const _pending = new Set<string>();
  const _injected = new Set<string>();

  return {
    get loadedSkills(): ReadonlySet<string> {
      return _loaded;
    },
    get pendingSkills(): ReadonlySet<string> {
      return _pending;
    },
    get injectedSummaries(): ReadonlySet<string> {
      return _injected;
    },
    get lastTouchedAt(): number {
      return _lastTouchedAt;
    },
    get ttlMs(): number {
      return ttlMs;
    },

    touch(): void {
      _lastTouchedAt = Date.now();
    },

    markLoaded(name: string): void {
      _loaded.add(name);
    },

    markPending(name: string): void {
      _pending.add(name);
    },

    markUnpending(name: string): void {
      _pending.delete(name);
    },

    markInjected(name: string): void {
      _injected.add(name);
    },

    clear(): void {
      _loaded.clear();
      _pending.clear();
      _injected.clear();
      _setupComplete = false;
      _lastTouchedAt = Date.now();
    },

    isSetupComplete(): boolean {
      return _setupComplete;
    },

    markSetupComplete(): void {
      _setupComplete = true;
    },

    isStale(now?: number): boolean {
      const elapsed = (now ?? Date.now()) - _lastTouchedAt;
      return elapsed > ttlMs;
    },
  };
};
