/**
 * OpenCode-specific skills glue.
 *
 * Hosts the `injectSkillsList` helper that injects the `<available-skills>`
 * block into a session on first message and after compaction. Consumes the
 * host's bounded client surface for content injection and the portable
 * core for discovery and rendering.
 */

import { discoverAllSkills, renderAvailableSkillsBlock } from "../core";
import type { OpencodeSkillHost, OpencodeSkillHostClient } from "./host";
import type { SkillHostContext } from "../core";

/**
 * Inject the available skills list into a session.
 * Used on session start and after compaction.
 */
export async function injectSkillsList(
  directory: string,
  host: OpencodeSkillHost,
  sessionID: string,
  context?: SkillHostContext
): Promise<void> {
  const skillsByName = await discoverAllSkills(directory);
  const skills = Array.from(skillsByName.values());

  if (skills.length === 0) return;

  const client: OpencodeSkillHostClient = host.client;
  await client.injectContent(
    sessionID,
    renderAvailableSkillsBlock(skills),
    context
  );
}
