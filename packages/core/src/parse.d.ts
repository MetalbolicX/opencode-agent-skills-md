/**
 * YAML frontmatter parsing and skill frontmatter validation.
 *
 * Pure functions: no I/O, no host dependencies. The script-discovery step
 * that follows parsing is delegated to `core/scripts.ts`.
 */
import type { Skill, SkillLabel } from "./types";
/**
 * Parse YAML frontmatter using the yaml library with safe options.
 * Uses strict schema to prevent code execution from malicious YAML.
 * Handles all YAML 1.2 features including multi-line strings (| and >).
 */
export declare function parseYamlFrontmatter(text: string): Record<string, unknown>;
export interface SkillFrontmatter {
    name: string;
    description: string;
    trigger?: string;
    license?: string;
    "allowed-tools"?: string[];
    metadata?: Record<string, unknown>;
}
/**
 * Parse a SKILL.md file and validate its frontmatter.
 * Returns null if parsing fails (with error logging).
 */
export declare function parseSkillFile(skillPath: string, relativePath: string, label: SkillLabel): Promise<Skill | null>;
