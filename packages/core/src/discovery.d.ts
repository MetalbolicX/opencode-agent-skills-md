/**
 * Skill discovery across filesystem roots.
 *
 * The core never hard-codes a host's directory layout. Callers pass the list
 * of discovery roots; the default `getDefaultOpencodeRoots` reproduces the
 * legacy OpenCode priority order. PR2 will call `discoverAllSkills` from the
 * OpenCode host adapter with the same default.
 */
import type { DiscoveryPath, FileDiscoveryResult, LabeledDiscoveryResult, Skill, SkillLabel } from "./types";
/**
 * Check if a file exists in a directory and return path info.
 *
 * @param directory - Directory to check
 * @param relativePath - Relative path to use in result (caller-specific)
 * @param filename - Name of file to look for (e.g., 'SKILL.md')
 * @returns Path info if file exists, null otherwise
 */
export declare function findFile(directory: string, relativePath: string, filename: string): Promise<FileDiscoveryResult | null>;
/**
 * Recursively find SKILL.md files in a directory.
 *
 * The base directory itself is checked first: a SKILL.md placed at the root
 * of a discovery root is returned with `relativePath = ""` and wins the
 * shadowing tie-break over same-name skills in subdirectories (first found
 * wins in `discoverAllSkills`).
 */
export declare function findSkillsRecursive(baseDir: string, label: SkillLabel, maxDepth?: number): Promise<LabeledDiscoveryResult[]>;
/**
 * Default discovery roots matching the pre-refactor OpenCode priority order
 * (see commit `c2d8e74`, `src/skills.ts#discoverAllSkills`):
 *   1. .opencode/skills/         (project - OpenCode)
 *   2. .claude/skills/           (project - Claude)
 *   3. ~/.config/opencode/skills/ (user - OpenCode)
 *   4. ~/.claude/skills/         (user - Claude)
 *
 * No shadowing - unique names only. First match wins, duplicates are warned.
 */
export declare function getDefaultOpencodeRoots(directory: string): DiscoveryPath[];
/**
 * Default callback for shadowed skill names. Emits a `console.warn` that
 * identifies the surviving (existing) skill and the duplicate that was
 * skipped. Hosts can override by passing `onDuplicate` to `discoverAllSkills`.
 *
 * @internal - exported for testing
 */
export declare const defaultOnDuplicate: (existing: Skill, duplicate: Skill) => void;
/**
 * Discover all skills from the provided roots.
 *
 * @param directory - Project directory (used to build the default roots).
 * @param roots - Discovery roots. Defaults to the OpenCode priority order
 *   via `getDefaultOpencodeRoots(directory)`. Hosts pass an explicit list to
 *   override the layout.
 * @param onDuplicate - Optional callback invoked when two roots produce a
 *   skill with the same `name`. Defaults to `console.warn` via
 *   `defaultOnDuplicate`. The first-discovered skill wins; the duplicate
 *   (second one encountered) is passed to the callback but never stored.
 */
export declare function discoverAllSkills(directory: string, roots?: DiscoveryPath[], onDuplicate?: (existing: Skill, duplicate: Skill) => void): Promise<Map<string, Skill>>;
/**
 * Resolve a skill by name, handling namespace prefixes.
 * Supports: "skill-name", "project:skill-name", "user:skill-name", etc.
 */
export declare function resolveSkill(skillName: string, skillsByName: Map<string, Skill>): Skill | null;
/**
 * Recursively list all files in a directory, returning relative paths.
 * Excludes SKILL.md since it's already loaded as the main content.
 */
export declare function listSkillFiles(skillPath: string, maxDepth?: number): Promise<string[]>;
/**
 * Get summaries of all available skills (name, description, trigger).
 * Used by preflight LLM call to evaluate which skills are relevant and
 * by the plugin's keyword matcher to rank matched skills.
 *
 * The `trigger` frontmatter key (PR 2 of `trigger-aware-skill-discovery`)
 * is threaded through so the keyword matcher can apply the 1.5x trigger
 * tier and the targeted outputs can render trigger text.
 *
 * @param directory - Project directory to discover skills from
 * @returns Array of skill summaries
 */
export declare function getSkillSummaries(directory: string): Promise<Array<{
    name: string;
    description: string;
    trigger?: string;
}>>;
