/**
 * Script discovery and path-safety helpers.
 *
 * Pure functions: filesystem reads only, no host dependencies.
 */
import type { Script } from "./types";
/**
 * Recursively find executable scripts in a skill's directory.
 * Skips hidden directories (starting with .) and common dependency dirs.
 * Only files with executable bit set are returned.
 */
export declare function findScripts(skillPath: string, maxDepth?: number): Promise<Script[]>;
/**
 * Check if a path is safely within a base directory (no escape via ..)
 */
export declare function isPathSafe(basePath: string, requestedPath: string): boolean;
