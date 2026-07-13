/**
 * OpenCode plugin — full implementation.
 *
 * Mirrors packages/opencode-agent-skills-md/src/plugin.ts behaviour.
 *
 * Wires the skill tools and the chat.message / event hooks.
 * Parity behaviours (synthetic injection, compaction reinjection,
 * Superpowers bootstrap) are preserved.
 */

import type { Skill, SkillSummary, SessionContext } from "./types";
import { debugLog } from "./utils";
import { discoverAllSkills, renderAvailableSkillsBlock, renderSkillPreflightBlock } from "./skills";
import { createOpencodeSkillHost, type OpencodeSkillHostClient } from "./host";
import { createSkillTools } from "./tools";
import {
  isPreferenceLayerEnabled,
  applyToolDefinition,
  applySystemTransform,
} from "./preference-hooks";
import { createMatcher, type Matcher } from "./embeddings";

export { debugLog } from "./utils";

/** @internal */
export const matchSkillsByKeyword = (userMessage: string, availableSkills: SkillSummary[]): SkillSummary[] => {
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
};

/**
 * Render the matched-skill synthetic injection block.
 */
export const formatMatchedSkillsInjection = (
  matchedSkills: SkillSummary[]
): string => {
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
};

export const MAX_TRACKED_SESSIONS = 100;
export const SESSION_TTL_MS = 30 * 60 * 1000;

export interface SessionState {
  setupComplete: boolean;
  loadedSkills: Set<string>;
  pendingSkills: Set<string>;
  injectedSummaries: Set<string>;
  lastTouchedAt: number;
  currentAgent?: string;
  currentModel?: { providerID: string; modelID: string };
}

export const touchSessionState = (
  state: Map<string, SessionState>,
  sessionID: string,
  now: number,
): SessionState => {
  evictSessionState(state, now);
  const existing = state.get(sessionID);
  if (existing) {
    existing.lastTouchedAt = now;
    return existing;
  }
  const fresh: SessionState = {
    setupComplete: false,
    loadedSkills: new Set(),
    pendingSkills: new Set(),
    injectedSummaries: new Set(),
    lastTouchedAt: now,
  };
  state.set(sessionID, fresh);
  return fresh;
};

export const evictSessionState = (
  state: Map<string, SessionState>,
  now: number,
): string[] => {
  const evicted: string[] = [];
  for (const [id, record] of state) {
    if (now - record.lastTouchedAt > SESSION_TTL_MS) {
      evicted.push(id);
    }
  }
  for (const id of evicted) {
    state.delete(id);
  }
  if (state.size >= MAX_TRACKED_SESSIONS) {
    const sorted = Array.from(state.entries()).sort(
      (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt,
    );
    const excess = state.size - (MAX_TRACKED_SESSIONS - 1);
    for (let i = 0; i < excess; i++) {
      const entry = sorted[i];
      if (entry) {
        const [id] = entry;
        state.delete(id);
        evicted.push(id);
      }
    }
  }
  return evicted;
};

export const deleteSessionState = (
  state: Map<string, SessionState>,
  sessionID: string,
): boolean => {
  return state.delete(sessionID);
};

const injectSkillsList = async (
  directory: string,
  host: { client: OpencodeSkillHostClient },
  sessionID: string,
  precomputed?: Map<string, Skill>,
  context?: SessionContext,
): Promise<void> => {
  const skillsByName = precomputed ?? await discoverAllSkills(directory);
  const skills = Array.from(skillsByName.values());
  if (skills.length === 0) return;
  await host.client.injectContent(sessionID, renderAvailableSkillsBlock(skills), context);
};

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
5. Plugin cache: \`claude-plugin-cache:skill-name\`
6. Marketplace: \`claude-marketplace:skill-name\`

The first discovered match wins.`;

const maybeInjectSuperpowersBootstrap = async (
  directory: string,
  host: { client: OpencodeSkillHostClient },
  sessionID: string,
  precomputed?: Map<string, Skill>,
  context?: SessionContext,
): Promise<void> => {
  if (process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE !== 'true') return;
  const skillsByName = precomputed ?? await discoverAllSkills(directory);
  const usingSuperpowersSkill = skillsByName.get('using-superpowers');
  if (!usingSuperpowersSkill) return;
  const content = `<EXTREMELY_IMPORTANT>
You have superpowers.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - do not call use_skill for it again. Use use_skill only for OTHER skills.**

${usingSuperpowersSkill.template}

${toolMapping}

${skillsNamespace}
</EXTREMELY_IMPORTANT>`;
  await host.client.injectContent(sessionID, content, context);
};

// Module-scoped discovery cache with 5-second TTL to avoid duplicate filesystem/parsing work
const DISCOVERY_CACHE_TTL_MS = 5000;
let _discoveryCache: { result: Map<string, Skill>; timestamp: number } | null = null;

const getCachedSkills = async (directory: string): Promise<Map<string, Skill>> => {
  const now = Date.now();
  if (_discoveryCache && now - _discoveryCache.timestamp < DISCOVERY_CACHE_TTL_MS) {
    return _discoveryCache.result;
  }
  _discoveryCache = { result: await discoverAllSkills(directory), timestamp: now };
  return _discoveryCache.result;
};

// Type for the chat.message output shape we handle
interface ChatMessageOutput {
  message?: {
    sessionID?: string;
    info?: { role?: string };
    model?: { providerID: string; modelID: string };
    agent?: string;
  };
  parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
}

// Type for event shape
interface EventPayload {
  type?: string;
  properties?: {
    sessionID?: string;
    info?: { id?: string };
  };
}

// The plugin factory signature
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginFactory = (options: any) => any;

export const SkillsPlugin: PluginFactory = async ({
  client,
  $,
  directory,
  matcher = createMatcher(),
}: {
  client: unknown;
  $: unknown;
  directory: string;
  matcher?: Matcher;
}) => {
  const sessionStates = new Map<string, SessionState>();

  const host = createOpencodeSkillHost(
    client as Parameters<typeof createOpencodeSkillHost>[0],
    (sessionID: string): SessionContext | undefined => {
      const record = sessionStates.get(sessionID);
      if (!record) return undefined;
      return {
        agent: record.currentAgent,
        model: record.currentModel,
      };
    },
  );

  const getLoadedSkills = (sessionID: string): Set<string> => {
    return touchSessionState(sessionStates, sessionID, Date.now()).loadedSkills;
  };

  const isFirstMessageSetup = async (sessionID: string): Promise<boolean> => {
    const record = touchSessionState(sessionStates, sessionID, Date.now());
    if (record.setupComplete) return false;
    try {
      const typedClient = client as {
        session?: {
          messages?: (input: { path: { id: string } }) => Promise<{
            data: Array<{ parts?: unknown; info?: { parts?: unknown } }>;
          }>;
        };
      };
      if (typedClient.session?.messages) {
        const existing = await typedClient.session.messages({
          path: { id: sessionID },
        });
        if (existing.data) {
          const hasSkillsContent = existing.data.some((msg) => {
            const m = msg as { parts?: unknown; info?: { parts?: unknown } };
            const parts = Array.isArray(m.parts)
              ? m.parts
              : Array.isArray(m.info?.parts)
              ? m.info.parts
              : null;
            if (!parts) return false;
            return parts.some((part) => {
              if (!isChatTextPart(part)) return false;
              return typeof part.text === "string" && part.text.includes("<available-skills>");
            });
          });
          if (hasSkillsContent) {
            record.setupComplete = true;
          }
        }
      }
    } catch (error) {
      debugLog("isFirstMessageSetup: failed to read existing messages", error);
    }
    return !record.setupComplete;
  };

  const injectBootstrapSkills = async (
    sessionID: string,
    skillsByName: Map<string, Skill>,
    context?: SessionContext,
  ): Promise<void> => {
    const record = touchSessionState(sessionStates, sessionID, Date.now());
    record.setupComplete = true;
    await maybeInjectSuperpowersBootstrap(directory, host, sessionID, skillsByName, context);
    await injectSkillsList(directory, host, sessionID, skillsByName, context);
  };

  const handleKeywordMatch = async (
    userText: string,
    sessionID: string,
    summaries: SkillSummary[],
    context?: SessionContext,
  ): Promise<void> => {
    if (!isPreferenceLayerEnabled()) return;
    if (!userText) return;
    if (summaries.length === 0) return;

    const matchedSkills = await matcher.match(userText, summaries);
    const record = touchSessionState(sessionStates, sessionID, Date.now());
    const newSkills = matchedSkills.filter(
      (s) =>
        !record.loadedSkills.has(s.name) &&
        !record.pendingSkills.has(s.name) &&
        !record.injectedSummaries.has(s.name),
    );
    if (newSkills.length === 0) return;

    const injectionText = renderSkillPreflightBlock(newSkills);
    if (!injectionText) return;

    for (const skill of newSkills) {
      record.pendingSkills.add(skill.name);
      record.injectedSummaries.add(skill.name);
    }

    await host.client.injectContent(sessionID, injectionText, context);
  };

  const tools = createSkillTools(
    host,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $ as any,
    directory,
    (sessionID, skillName) => {
      const record = touchSessionState(sessionStates, sessionID, Date.now());
      record.loadedSkills.add(skillName);
      record.pendingSkills.delete(skillName);
    },
  );

  return {
    // Exposed for unit testing — do not use in production code
    _sessionStates: sessionStates,
    _isFirstMessageSetup: isFirstMessageSetup,
    _touchSessionState: (sid: string) => touchSessionState(sessionStates, sid, Date.now()),

    "chat.message": async (input: unknown, output: unknown) => {
      const rawOutput = output as ChatMessageOutput | null;
      if (!rawOutput || typeof rawOutput !== "object") {
        debugLog("chat.message: missing or non-object output", rawOutput);
        return;
      }
      if (typeof rawOutput.message?.sessionID !== "string") {
        debugLog("chat.message: missing sessionID on output", rawOutput);
        return;
      }
      const sessionID = rawOutput.message.sessionID;

      const record = touchSessionState(sessionStates, sessionID, Date.now());

      // Only real user messages represent the user's current selector choice.
      // Tool/assistant messages must not overwrite the cached context.
      if (rawOutput.message?.info?.role === "user") {
        if (typeof rawOutput.message?.agent === "string") {
          record.currentAgent = rawOutput.message.agent;
        }
        if (
          rawOutput.message?.model &&
          typeof rawOutput.message.model.providerID === "string" &&
          typeof rawOutput.message.model.modelID === "string"
        ) {
          record.currentModel = rawOutput.message.model;
        }
      }

      const context: SessionContext = {
        agent: record.currentAgent,
        model: record.currentModel,
      };

      const skillsByName = await getCachedSkills(directory);
      const summaries: SkillSummary[] = Array.from(skillsByName.values()).map(skill => ({
        name: skill.name,
        description: skill.description,
        trigger: skill.trigger,
      }));

      if (await isFirstMessageSetup(sessionID)) {
        await injectBootstrapSkills(sessionID, skillsByName, context);
        return;
      }

      const rawParts = Array.isArray(rawOutput.parts) ? rawOutput.parts : [];
      const userText = rawParts
        .flatMap((part): string[] => {
          if (!isChatTextPart(part)) return [];
          if (part.synthetic === true) return [];
          return typeof part.text === "string" ? [part.text] : [];
        })
        .join("\n")
        .trim();

      await handleKeywordMatch(userText, sessionID, summaries, context);
    },

    event: async ({ event }: { event?: EventPayload }) => {
      if (!event) return;

      if (event.type === "session.compacted") {
        const sessionID = event.properties?.sessionID;
        if (typeof sessionID !== "string") {
          debugLog("event: session.compacted missing sessionID", event);
          return;
        }
        const context = host.client.getSessionContext(sessionID);
        await maybeInjectSuperpowersBootstrap(directory, host, sessionID, undefined, context);
        await injectSkillsList(directory, host, sessionID, undefined, context);
        const record = touchSessionState(sessionStates, sessionID, Date.now());
        const preservedAgent = record.currentAgent;
        const preservedModel = record.currentModel;
        record.loadedSkills.clear();
        record.pendingSkills.clear();
        record.injectedSummaries.clear();
        record.setupComplete = false;
        record.currentAgent = preservedAgent;
        record.currentModel = preservedModel;
        _discoveryCache = null;
        return;
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties?.info?.id;
        if (typeof sessionID !== "string") {
          debugLog("event: session.deleted missing info.id", event);
          return;
        }
        deleteSessionState(sessionStates, sessionID);
      }
    },

    tool: tools,

    "tool.definition": async (input: unknown, output: unknown) => {
      if (!isPreferenceLayerEnabled()) return;
      applyToolDefinition(
        input as { toolID?: string },
        output as { description?: string; parameters?: Record<string, unknown> },
      );
    },

    "experimental.chat.system.transform": async (
      _input: unknown,
      output: unknown,
    ) => {
      if (!isPreferenceLayerEnabled()) return;
      const rawOutput = output as { system?: string[] } | undefined;
      if (!rawOutput || typeof rawOutput !== "object") {
        debugLog(
          "experimental.chat.system.transform: missing or non-object output",
          output,
        );
        return;
      }
      const skillsByName = await getCachedSkills(directory);
      const summaries: SkillSummary[] = Array.from(skillsByName.values()).map(
        (skill) => ({
          name: skill.name,
          description: skill.description,
          trigger: skill.trigger,
        }),
      );
      applySystemTransform(summaries, rawOutput);
    },
  };
};

// Type guard for chat text part — exported for unit testing
export function isChatTextPart(part: unknown): part is { type?: string; text?: string; synthetic?: boolean } {
  if (typeof part !== "object" || part === null) return false;
  return (part as { type?: string }).type === "text";
}
