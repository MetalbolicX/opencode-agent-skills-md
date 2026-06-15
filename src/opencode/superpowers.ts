/**
 * Superpowers bootstrap for the OpenCode host.
 *
 * Provides automatic injection of the "using-superpowers" skill content
 * when OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true. Consumes the host's
 * bounded client surface for content injection and the portable core for
 * skill discovery.
 */

import { discoverAllSkills } from "../core";
import type { OpencodeSkillHost } from "./host";
import type { SkillHostContext } from "../core";

const toolMapping = `**Tool Mapping for OpenCode:**
- \`TodoWrite\` → \`todowrite\`
- \`Task\` tool with subagents → Use the \`task\` tool with \`subagent_type\`
- \`Skill\` tool → \`use_skill\`
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\`, \`Glob\`, \`Grep\`, \`WebFetch\` → Use the native lowercase OpenCode tools`;

const skillsNamespace = `**Skill namespace priority:**
1. Project: \`project:skill-name\`
2. Claude project: \`claude-project:skill-name\`
3. User: \`skill-name\`
4. Claude user: \`claude-user:skill-name\`
5. Marketplace: \`claude-plugins:skill-name\`

The first discovered match wins.`;

/**
 * Maybe inject superpowers bootstrap content into a session.
 * Only injects if superpowers mode is enabled and using-superpowers skill exists.
 */
export async function maybeInjectSuperpowersBootstrap(
  directory: string,
  host: OpencodeSkillHost,
  sessionID: string,
  context?: SkillHostContext
): Promise<void> {
  const superpowersModeEnabled = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE === 'true';
  if (!superpowersModeEnabled) return;

  const skillsByName = await discoverAllSkills(directory);
  const usingSuperpowersSkill = skillsByName.get('using-superpowers');
  if (!usingSuperpowersSkill) return;

  const content = `<EXTREMELY_IMPORTANT>
You have superpowers.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - do not call use_skill for it again. Use use_skill only for OTHER skills.**

${usingSuperpowersSkill.template}

${toolMapping}

${skillsNamespace}
</EXTREMELY_IMPORTANT>`;

  const ctx = context ?? await host.client.getSessionContext(sessionID);
  await host.client.injectContent(sessionID, content, ctx);
}
