/**
 * Pure types for the skills core engine.
 *
 * The core has zero runtime dependency on any host SDK. Host-specific types
 * (the OpenCode client, etc.) live in the host adapter and are re-exported
 * by the consumer entrypoints.
 *
 * Boundary contracts `SkillHostClient` and `SkillHostSession` (and the
 * minimal `SkillHostContext` they reference) declare the surface the core
 * expects from any AI harness host. The concrete OpenCode implementation
 * lives in the plugin package; other harnesses implement the same contracts.
 */

/**
 * Skill label indicating the source/location of a skill.
 * - project: .opencode/skills/ in project directory
 * - user: ~/.config/opencode/skills/
 * - claude-project: .claude/skills/ in project directory
 * - claude-user: ~/.claude/skills/
 */
export type SkillLabel = "project" | "user" | "claude-project" | "claude-user";

/**
 * Result from finding a file in a directory.
 */
export interface FileDiscoveryResult {
  filePath: string;
  relativePath: string;
}

/**
 * Script metadata with both relative and absolute paths.
 */
export interface Script {
  relativePath: string;
  absolutePath: string;
}

/**
 * Complete metadata for a discovered skill.
 */
export interface Skill {
  name: string;
  description: string;
  /**
   * Free-form trigger phrase(s) parsed from the `trigger` frontmatter key.
   * Surfaced in targeted outputs (matched-skill injection, `get_available_skills`)
   * so the model knows which user phrases should activate the skill. Absent
   * when the frontmatter has no `trigger` key.
   */
  trigger?: string;
  path: string;
  relativePath: string;
  namespace?: string;
  label: SkillLabel;
  scripts: Script[];
  template: string;
  /**
   * Free-form tags parsed from `metadata.tags` in the skill frontmatter.
   * Defaults to an empty array when the skill has no `metadata` block or
   * the block has no `tags` key. Consumers (e.g. the search layer) use
   * this list to filter skills by user-supplied keywords.
   */
  tags: string[];
}

/**
 * Skill summary for preflight evaluation.
 */
export interface SkillSummary {
  name: string;
  description: string;
  /**
   * Optional trigger phrase(s) parsed from the `trigger` frontmatter key.
   * Mirrors `Skill.trigger` so summaries carry the same discovery metadata.
   */
  trigger?: string;
}

/** Discovery result with label attached. */
export type LabeledDiscoveryResult = FileDiscoveryResult & { label: SkillLabel };

/** Configuration for a skill discovery path. */
export interface DiscoveryPath {
  path: string;
  label: SkillLabel;
  maxDepth: number;
}

/**
 * Minimal per-call context the host carries alongside an injected message.
 *
 * The core never needs more than the model + agent hint that the host can
 * resolve from a session. Declaring the shape here (instead of in the
 * adapter) keeps the boundary contract self-contained: the plugin's
 * OpenCode implementation supplies the values; future harnesses do the
 * same without changing core.
 */
export interface SkillHostContext {
  model?: { providerID: string; modelID: string };
  agent?: string;
}

/**
 * Bounded client surface the core expects from any AI harness host.
 *
 * The interface is intentionally structural — a host adapter may add more
 * methods, but it MUST provide these four to satisfy the boundary. The
 * concrete OpenCode implementation (`createOpencodeSkillHost` in the plugin
 * package) supplies them over the OpenCode SDK client plus `node:fs`.
 *
 *   - `injectContent`        push a synthetic message into a session
 *   - `getSessionContext`    resolve model/agent hint for a session id
 *   - `readFile` / `readdir` bounded filesystem access for skill loading
 */
export interface SkillHostClient {
  injectContent(sessionID: string, text: string, context?: SkillHostContext): Promise<void>;
  getSessionContext(sessionID: string): Promise<SkillHostContext | undefined>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
}

/**
 * Host-side session handle. The core only needs to carry the session id
 * through calls back into the host (e.g. when injecting matched-skill
 * content). Hosts are free to attach additional state internally; the
 * boundary contract here is the minimum the core relies on.
 */
export interface SkillHostSession {
  id: string;
}
