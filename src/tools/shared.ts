/**
 * Shared utilities for the tools/ leaf modules.
 *
 * Re-exports escapeXml, escapeShellArg, SKILL_SCRIPT_TIMEOUT_MS, runBoundSkillScript.
 */

/**
 * Escape XML special characters to prevent wrapper breakout.
 * @internal - exported for testing
 */
export const _escapeXml = (s: string): string => {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

/** Public alias for external callers */
export const escapeXml = _escapeXml;

/**
 * Wrap a shell argument in single quotes and escape embedded single quotes (Bourne-shell pattern).
 * @internal - exported for testing
 */
export const _escapeShellArg = (arg: string): string => {
  const escaped = arg.replace(/'/g, "'\\''");
  return "'" + escaped + "'";
};

/** Public alias for external callers */
export const escapeShellArg = _escapeShellArg;

export const SKILL_SCRIPT_TIMEOUT_MS = 30000;

/**
 * Run a shell script with a fixed timeout and optional abort signal.
 * Returns the first resolved value among shell, timeout, or abort.
 */
export const runBoundSkillScript = async (
  shellPromise: Promise<string>,
  abortSignal: AbortSignal | undefined,
  timeoutMs: number,
  scriptPath: string,
): Promise<string> => {
  if (abortSignal?.aborted) {
    return `Script "${scriptPath}" cancelled.`;
  }

  const cleanup: Array<() => void> = [];

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<string>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve(`Script "${scriptPath}" timed out after ${timeoutMs}ms.`),
      timeoutMs,
    );
  });
  cleanup.push(() => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  });

  let abortPromise: Promise<string>;
  if (abortSignal) {
    abortPromise = new Promise<string>((resolve) => {
      const onAbort = () => resolve(`Script "${scriptPath}" cancelled.`);
      abortSignal.addEventListener("abort", onAbort, { once: true });
      cleanup.push(() => abortSignal.removeEventListener("abort", onAbort));
    });
  } else {
    abortPromise = new Promise<string>(() => {});
  }

  try {
    return await Promise.race([shellPromise, timeoutPromise, abortPromise]);
  } finally {
    for (const fn of cleanup) fn();
  }
};
