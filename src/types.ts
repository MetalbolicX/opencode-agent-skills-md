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
 * The agent/model context for a session — carried through injection calls
 * to prevent synthetic noReply messages from shadowing the user's selection.
 */
export interface SessionContext {
  agent?: string;
  model?: { providerID: string; modelID: string };
}

export interface SkillHostClient {
  injectContent(sessionID: string, text: string, context?: SessionContext): Promise<void>;
  getSessionContext(sessionID: string): SessionContext | undefined;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
}

export interface SkillHostSession {
  id: string;
}
