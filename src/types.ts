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

export interface SkillHostContext {
  model?: { providerID: string; modelID: string };
  agent?: string;
}

export interface SkillHostClient {
  injectContent(sessionID: string, text: string, context?: SkillHostContext): Promise<void>;
  getSessionContext(sessionID: string): Promise<SkillHostContext | undefined>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
}

export interface SkillHostSession {
  id: string;
}
