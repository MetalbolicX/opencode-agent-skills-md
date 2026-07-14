/**
 * Pure types for the skills core engine.
 *
 * These types are the upstream-aligned equivalents of packages/core/src/types.ts.
 * They are duplicated here to support the single-package Bun layout without
 * requiring the packages/ workspace split.
 */

export type SkillLabel = "project" | "user" | "claude-project" | "claude-user" | "claude-plugin-cache" | "claude-marketplace";

export interface FileDiscoveryResult {
  filePath: string;
  relativePath: string;
}

export interface Script {
  relativePath: string;
  absolutePath: string;
}

export interface Skill {
  name: string;
  description: string;
  trigger?: string;
  path: string;
  relativePath: string;
  namespace?: string;
  label: SkillLabel;
  scripts: Script[];
  template: string;
  tags: string[];
}

export interface SkillSummary {
  name: string;
  description: string;
  trigger?: string;
}

export type LabeledDiscoveryResult = FileDiscoveryResult & { label: SkillLabel };

export interface DiscoveryPath {
  path: string;
  label: SkillLabel;
  maxDepth: number;
}

/**
 * Single cached source of truth for skill discovery.
 * Scans all discovery roots once, caches with TTL, exposes collection interface.
 */
export interface SkillStore {
  all(): Promise<Skill[]>;
  summaries(): Promise<SkillSummary[]>;
  search(query: string, keywords?: string[]): Promise<Skill[]>;
  /** Resolves by exact name first, then path suffix; throws on ambiguous suffix match. */
  resolve(name: string): Promise<Skill>;
  /** List all files in a skill directory, excluding SKILL.md. */
  listFiles(skillName: string): Promise<string[]>;
  invalidate(): void;
}

/**
 * Per-session state: tracks loaded/pending/injected skills and setup flag.
 */
export interface SessionTracker {
  readonly loadedSkills: ReadonlySet<string>;
  readonly pendingSkills: ReadonlySet<string>;
  readonly injectedSummaries: ReadonlySet<string>;
  readonly lastTouchedAt: number;
  readonly ttlMs: number;
  touch(): void;
  markLoaded(name: string): void;
  markPending(name: string): void;
  markUnpending(name: string): void;
  markInjected(name: string): void;
  clear(): void;
  isSetupComplete(): boolean;
  markSetupComplete(): void;
  /** Returns true if the session has exceeded its TTL since lastTouchedAt. */
  isStale(now?: number): boolean;
}

/** Result of a skill resolution attempt. */
export type SkillResolution = { ok: true; skill: Skill } | { ok: false; message: string };

/** Execution context passed to skill tools by the OpenCode runtime. */
export interface SkillToolContext {
  sessionID?: string;
  agent?: string;
  abort?: AbortSignal;
}
