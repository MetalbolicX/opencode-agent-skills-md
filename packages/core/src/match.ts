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
export const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i || j)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] !== b[j - 1] ? 1 : 0)
      );
    }
  }

  return dp[m]![n]!;
};

/**
 * Find the closest matching string from a list of candidates.
 * Uses combined scoring: prefix match (strongest), substring match, then Levenshtein distance.
 * Returns the best match if similarity is above 0.4 threshold, otherwise null.
 * @internal - exported for testing
 */
export const findClosestMatch = (input: string, candidates: string[]): string | null => {
  if (candidates.length === 0) return null;

  const inputLower = input.toLowerCase();
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();
    let score = 0;

    if (candidateLower.startsWith(inputLower)) {
      score = 0.9 + (inputLower.length / candidateLower.length) * 0.1;

      const nextChar = candidateLower[inputLower.length];
      if (nextChar && /[-_/.]/.test(nextChar)) {
        score += 0.05;
      }
    } else if (inputLower.startsWith(candidateLower)) {
      score = 0.8;
    }
    else if (candidateLower.includes(inputLower) || inputLower.includes(candidateLower)) {
      score = 0.7;
    }
    else {
      const distance = levenshtein(inputLower, candidateLower);
      const maxLength = Math.max(inputLower.length, candidateLower.length);
      score = 1 - (distance / maxLength);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore >= 0.4 ? bestMatch : null;
};
