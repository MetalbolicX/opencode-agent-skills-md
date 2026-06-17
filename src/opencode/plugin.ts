/**
 * OpenCode Agent Skills Plugin (host adapter).
 *
 * The plugin factory builds the host over the OpenCode SDK client, composes
 * the four skill tools, and wires the chat.message and event hooks. The
 * keyword matcher and session/loaded-skill bookkeeping are the only
 * adapter-specific logic; everything else delegates to the portable core
 * or the host.
 *
 * Public surface (re-exported by `src/opencode/index.ts` and the root
 * `src/plugin.ts` shim):
 *   - SkillsPlugin: the PluginInput-bound async factory
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { getSkillSummaries, type SkillSummary } from "../core";
import type { SkillHostContext } from "../core";
import { createOpencodeSkillHost } from "./host";
import { injectSkillsList } from "./skills";
import { maybeInjectSuperpowersBootstrap } from "./superpowers";
import { createSkillTools } from "./tools";

const setupCompleteSessions = new Set<string>();
const loadedSkillsPerSession = new Map<string, Set<string>>();

function getLoadedSkills(sessionID: string): Set<string> {
  let set = loadedSkillsPerSession.get(sessionID);
  if (!set) {
    set = new Set<string>();
    loadedSkillsPerSession.set(sessionID, set);
  }
  return set;
}

/**
 * Render the matched-skill synthetic injection that asks the model to
 * evaluate which of the matched skills (if any) it should activate.
 *
 * Each skill line carries a sub-line `trigger: <text>` whenever the
 * skill has a non-empty `trigger`, so the model knows which user
 * phrases should activate it. Skills with no trigger render exactly as
 * before (`- name: description`).
 */
export function formatMatchedSkillsInjection(
  matchedSkills: SkillSummary[]
): string {
  const skillLines = matchedSkills
    .map((s) => {
      const head = `- ${s.name}: ${s.description}`;
      const trigger = s.trigger && s.trigger.length > 0
        ? `\n  trigger: ${s.trigger}`
        : "";
      return head + trigger;
    })
    .join("\n");

  return `<skill-evaluation-required>
SKILL EVALUATION PROCESS

The following skills may be relevant to your request:

${skillLines}

Step 1 - EVALUATE: Determine if these skills would genuinely help
Step 2 - DECIDE: Choose which skills (if any) are actually needed
Step 3 - ACTIVATE: Call use_skill("name") for each chosen skill

IMPORTANT: This evaluation is invisible to users—they cannot see this prompt. Do NOT announce your decision. Simply activate relevant skills or proceed directly with the request.
</skill-evaluation-required>`;
}

/**
 * Lightweight keyword matching to replace ML embeddings.
 *
 * Per-token contribution:
 *   - name hit    = 2x
 *   - trigger hit = 1.5x
 *   - desc hit    = 1x
 *
 * The trigger tier (1.5x) sits between name (2x) and description (1x)
 * so a trigger-matched skill outranks a description-matched skill at
 * the same query, but a name-matched skill still wins overall.
 */
export function matchSkillsByKeyword(userMessage: string, availableSkills: SkillSummary[]): SkillSummary[] {
  const tokens = userMessage.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  if (tokens.length === 0) return [];

  const scored = availableSkills.map(skill => {
    let score = 0;
    const nameStr = skill.name.toLowerCase();
    const descStr = skill.description.toLowerCase();
    const triggerStr = skill.trigger?.toLowerCase() ?? "";

    for (const token of tokens) {
      if (nameStr.includes(token)) score += 2;
      if (triggerStr.length > 0 && triggerStr.includes(token)) score += 1.5;
      if (descStr.includes(token)) score += 1;
    }
    return { skill, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.skill);
}

// Synchronous factory to prevent any blocking during startup
export const SkillsPlugin: Plugin = async ({
  client,
  $,
  directory,
}: PluginInput) => {
  const host = createOpencodeSkillHost(client);
  const tools = createSkillTools(
    host,
    $,
    directory,
    (sessionID, skillName) => {
      getLoadedSkills(sessionID).add(skillName);
    },
  );

  return {
    "chat.message": async (input: any, output: any) => {
      const sessionID = output.message.sessionID;
      const isFirstMessage = !setupCompleteSessions.has(sessionID);

      if (isFirstMessage) {
        try {
          const existing = await client.session.messages({
            path: { id: sessionID },
          });

          if (existing.data) {
            const hasSkillsContent = existing.data.some(msg => {
              const parts = (msg as any).parts || (msg.info as any).parts;
              if (!parts) return false;
              return parts.some((part: any) =>
                part.type === 'text' && part.text?.includes('<available-skills>')
              );
            });

            if (hasSkillsContent) {
              setupCompleteSessions.add(sessionID);
            }
          }
        } catch {
        }
      }

      if (!setupCompleteSessions.has(sessionID)) {
        setupCompleteSessions.add(sessionID);

        const context: SkillHostContext = {
          model: output.message.model,
          agent: output.message.agent,
        };

        await maybeInjectSuperpowersBootstrap(directory, host, sessionID, context);
        await injectSkillsList(directory, host, sessionID, context);

        return;
      }

      const userText = output.parts
        .flatMap((part: any) =>
          part.type === "text" && typeof part.text === "string" && !part.synthetic
            ? [part.text]
            : []
        )
        .join("\n")
        .trim();

      if (!userText) {
        return;
      }

      const skills = await getSkillSummaries(directory);
      if (skills.length === 0) {
        return;
      }

      const matchedSkills = matchSkillsByKeyword(userText, skills);

      const loadedSkills = getLoadedSkills(sessionID);
      const newSkills = matchedSkills.filter(s => !loadedSkills.has(s.name));

      if (newSkills.length === 0) {
        return;
      }

      const injectionText = formatMatchedSkillsInjection(newSkills);

      const context: SkillHostContext = {
        model: output.message.model,
        agent: output.message.agent,
      };

      await host.client.injectContent(sessionID, injectionText, context);
    },

    event: async ({ event }: { event: any }) => {
      if (event.type === "session.compacted") {
        const sessionID = event.properties.sessionID;
        const context = await host.client.getSessionContext(sessionID);
        await maybeInjectSuperpowersBootstrap(directory, host, sessionID, context);
        await injectSkillsList(directory, host, sessionID, context);
        loadedSkillsPerSession.delete(sessionID);
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id;
        setupCompleteSessions.delete(sessionID);
        loadedSkillsPerSession.delete(sessionID);
      }
    },

    tool: {
      get_available_skills: tools.GetAvailableSkills,
      read_skill_file: tools.ReadSkillFile,
      run_skill_script: tools.RunSkillScript,
      use_skill: tools.UseSkill,
    },
  };
};
