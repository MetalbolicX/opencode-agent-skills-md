/**
 * Debug-gated logging. Set OPENCODE_AGENT_SKILLS_DEBUG=1 to enable.
 */
export const debugLog = (...args: unknown[]): void => {
  if (!process.env.OPENCODE_AGENT_SKILLS_DEBUG) return;
  console.error("[opencode-agent-skills-md]", ...args);
};
