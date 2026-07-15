/**
 * Shared utilities for the tools/ leaf modules.
 *
 * Re-exports escapeXml, escapeShellArg, SKILL_SCRIPT_TIMEOUT_MS, runBoundSkillScript.
 */

import type { ToolContext } from "@opencode-ai/plugin";

// ---------------------------------------------------------------------------
// Risk scanning
// ---------------------------------------------------------------------------

/** Risk categories for script content analysis. */
export type RiskCategory =
  | "network-egress"
  | "out-of-skill-write"
  | "privilege-escalation"
  | "shell-env-mutation";

/** Report produced by content scanning. */
export interface ScriptRiskReport {
  categories: RiskCategory[];
  evidence: string[];
}

/**
 * Scan script content for risky operations.
 * Returns matched categories and supporting evidence lines.
 */
export function scanScriptContent(content: string): ScriptRiskReport {
  const categories: RiskCategory[] = [];
  const evidence: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Network egress
    if (/\b(curl|wget|fetch|openssl|s_client|netcat|nc)\b/.test(trimmed)) {
      if (!categories.includes("network-egress")) categories.push("network-egress");
      evidence.push(line);
    }

    // Out-of-skill write (writes outside typical skill path patterns)
    // Detects writes to /tmp, /var, /home, /etc, or absolute paths outside skill
    if (/\b(write|put|setContent|WriteFile|mkdir|mv|cp)\b.*[\/"'](?!\.)/.test(trimmed)) {
      if (!categories.includes("out-of-skill-write")) categories.push("out-of-skill-write");
      evidence.push(line);
    }

    // Privilege escalation
    if (/\b(sudo|su |pkexec|doas|chmod [467]|[0-9]{4,})\b/.test(trimmed)) {
      if (!categories.includes("privilege-escalation")) categories.push("privilege-escalation");
      evidence.push(line);
    }

    // Shell/env mutation
    if (/\b(export|env |source |\..*profile|\.bashrc|\.zshrc|eval)\b/.test(trimmed)) {
      if (!categories.includes("shell-env-mutation")) categories.push("shell-env-mutation");
      evidence.push(line);
    }
  }

  return { categories, evidence };
}

/**
 * Build and send a risk-approval request via context.ask().
 * This function only returns on approval; denial is handled by the framework throwing/aborting.
 * The caller must not assume execution proceeds after this returns.
 */
export async function requestRiskApproval(
  context: ToolContext,
  skillName: string,
  scriptPath: string,
  report: ScriptRiskReport,
): Promise<void> {
  await context.ask({
    permission: `run-skill-script:${skillName}/${scriptPath}`,
    patterns: report.categories as string[],
    always: [],
    metadata: {
      categories: report.categories,
      evidence: report.evidence,
      reason: `Script contains risky operations: ${report.categories.join(", ")}`,
    },
  });
}

// ---------------------------------------------------------------------------
// XML / Shell escaping
// ---------------------------------------------------------------------------

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
