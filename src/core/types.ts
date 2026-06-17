/**
 * Pure types for the skills core engine.
 *
 * The core has zero runtime dependency on any host SDK. Host-specific types
 * (the OpenCode client, session context, etc.) live in the host adapter and
 * are re-exported by the consumer entrypoints.
 *
 * Boundary contracts `SkillHostClient` and `SkillHostSession` declare the
 * surface the core expects from any AI harness host. They are forward-looking
 * for PR2 (the OpenCode adapter) and are not yet consumed by core code.
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
 * Minimal context a host attaches when injecting synthetic content into a
 * session. Mirrors the model + agent pair OpenCode threads through its
 * `session.prompt` body.
 */
export interface SkillHostContext {
  model?: { providerID: string; modelID: string };
  agent?: string;
}

/**
 * Boundary contract for any AI harness host.
 *
 * The core never imports a concrete host SDK. Instead it consumes a
 * `SkillHostClient` supplied by the host adapter. PR2 will provide the
 * OpenCode implementation; other harnesses (Claude Code, custom agents) can
 * implement this interface to reuse the core.
 */
export interface SkillHostClient {
  /**
   * Inject text content into a session as a synthetic, non-reply message so
   * it survives context compaction.
   */
  injectContent(
    sessionID: string,
    text: string,
    context?: SkillHostContext
  ): Promise<void>;

  /**
   * Resolve the current model + agent context for a session, mirroring
   * OpenCode's `lastModel()` lookup. Returns `undefined` if unavailable.
   */
  getSessionContext(sessionID: string): Promise<SkillHostContext | undefined>;
}

/**
 * Boundary contract for a host session. The core only needs the session id
 * to thread through host calls; richer session state lives in the adapter.
 */
export interface SkillHostSession {
  id: string;
}
