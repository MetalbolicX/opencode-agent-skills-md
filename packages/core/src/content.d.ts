/**
 * Content formatting helpers for skill listings and synthetic injections.
 *
 * Pure functions: string assembly only, no host dependencies.
 */
import type { Skill } from "./types";
/**
 * Format a list of skills as the inner bullet block used inside the
 * `<available-skills>` synthetic injection.
 */
export declare function formatSkillListing(skills: Skill[]): string;
/**
 * Render the full `<available-skills>...</available-skills>` block that the
 * host injects into a session on startup and after compaction.
 */
export declare function renderAvailableSkillsBlock(skills: Skill[]): string;
