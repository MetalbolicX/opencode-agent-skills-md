/**
 * Fuzzy string matching helpers used to suggest the closest skill or script
 * name when a user request does not match exactly.
 *
 * Pure functions: no I/O, no host dependencies.
 */
/**
 * Calculate Levenshtein edit distance between two strings.
 * Used for fuzzy matching suggestions when skill/script names are not found.
 * @internal - exported for testing
 */
export declare function levenshtein(a: string, b: string): number;
/**
 * Find the closest matching string from a list of candidates.
 * Uses combined scoring: prefix match (strongest), substring match, then Levenshtein distance.
 * Returns the best match if similarity is above 0.4 threshold, otherwise null.
 * @internal - exported for testing
 */
export declare function findClosestMatch(input: string, candidates: string[]): string | null;
