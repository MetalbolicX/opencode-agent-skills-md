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
export type LabeledDiscoveryResult = FileDiscoveryResult & {
    label: SkillLabel;
};
/** Configuration for a skill discovery path. */
export interface DiscoveryPath {
    path: string;
    label: SkillLabel;
    maxDepth: number;
}
