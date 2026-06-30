/**
 * Debug-gated logging for bare `catch {}` blocks.
 *
 * Bare catches stay silent by default so malformed payloads and parse
 * errors never surface as user-visible noise. Setting
 * `OPENCODE_AGENT_SKILLS_DEBUG=1` makes the diagnostic context appear on
 * stderr so developers can trace why a fallback fired.
 *
 * The env var is checked on every call (not cached at module load) so
 * tests can toggle it without re-importing the module.
 */
export const debugLog = (...args: unknown[]): void => {
  if (!process.env.OPENCODE_AGENT_SKILLS_DEBUG) return;
  // eslint-disable-next-line no-console
  console.error("[opencode-agent-skills-md]", ...args);
};