/**
 * OpenCode Agent Skills Plugin (host adapter).
 *
 * The plugin factory builds the host over the OpenCode SDK client, composes
 * the four skill tools, and wires the chat.message and event hooks. The
 * keyword matcher and session/loaded-skill bookkeeping are the only
 * adapter-specific logic; everything else delegates to the portable core
 * or the host.
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import {
  discoverAllSkills,
  renderAvailableSkillsBlock,
  type Skill,
  type SkillHostContext,
  type SkillSummary,
} from "opencode-agent-skills-md-core";
import { createOpencodeSkillHost, type OpencodeSkillHostClient } from "./host";
import { createSkillTools } from "./tools";
import { debugLog } from "opencode-agent-skills-md-core";
import {
  isChatTextPart,
  isSessionCompactedEvent,
  isSessionDeletedEvent,
  type ChatMessageOutput,
} from "./sdk";

const injectSkillsList = async (
  directory: string,
  host: { client: OpencodeSkillHostClient },
  sessionID: string,
  context?: SkillHostContext,
  precomputed?: Map<string, Skill>,
): Promise<void> => {
  const skillsByName = precomputed ?? await discoverAllSkills(directory);
  const skills = Array.from(skillsByName.values());
  if (skills.length === 0) return;
  await host.client.injectContent(sessionID, renderAvailableSkillsBlock(skills), context);
};

/**
 * Maximum retention for per-session bookkeeping entries. When the
 * in-memory map grows beyond this cap, the lazy sweep evicts the
 * oldest entries by `lastTouchedAt` until the size is back at or
 * below the cap. Picked as a generous bound that comfortably covers
 * a multi-hour plugin session without leaking memory.
 */
export const MAX_TRACKED_SESSIONS = 100;

/**
 * Idle interval after which a session entry is eligible for lazy
 * eviction on the next touch. The TTL favours active sessions: a
 * session that has not been touched in this many milliseconds is
 * considered stale and dropped before the cap-based eviction runs.
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Per-session bookkeeping record. Consolidates the previous
 * `setupCompleteSessions` Set and `loadedSkillsPerSession` Map into a
 * single record keyed by session ID. `lastTouchedAt` drives the TTL +
 * cap eviction policy (see R-session-state-lifecycle).
 */
export interface SessionState {
  setupComplete: boolean;
  loadedSkills: Set<string>;
  lastTouchedAt: number;
}

/**
 * Upsert a session record and run the lazy eviction sweep in the same
 * pass. Behaviour (in order):
 *   1. `evictSessionState(state, now)` — drops TTL-expired entries
 *      first, then drops the oldest-by-`lastTouchedAt` entries until
 *      the map is at or below `MAX_TRACKED_SESSIONS`. The session we
 *      are about to touch is never picked by step 1's TTL pass (it
 *      is being refreshed to `now`) and is never picked by step 2
 *      either (it is about to be the newest entry).
 *   2. If the session exists, bump its `lastTouchedAt` and return it.
 *   3. Otherwise insert a fresh record and return it.
 *
 * Pure with respect to its inputs (mutates only the supplied map);
 * `now` is taken as a parameter so tests can drive a deterministic
 * clock without monkey-patching `Date`.
 */
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
    lastTouchedAt: now,
  };
  state.set(sessionID, fresh);
  return fresh;
};

/**
 * Drop TTL-expired entries first, then oldest-by-`lastTouchedAt`
 * entries until the map has room for one new touch. Returns the IDs
 * that were evicted (handy for tests; the plugin factory does not
 * currently consume the return value). Pure helper — mutates only
 * the supplied map.
 *
 * Post-condition: `state.size <= MAX_TRACKED_SESSIONS - 1` after this
 * call (when called inside `touchSessionState`, the subsequent `set`
 * brings the map back up to at most `MAX_TRACKED_SESSIONS`). The cap
 * condition is `>= MAX_TRACKED_SESSIONS` so the very touch that would
 * push the map over the cap is the one that triggers eviction.
 */
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

/**
 * Remove the entry for `sessionID`. Returns `true` when the map held
 * the entry and removed it, `false` otherwise. Used by the explicit
 * `session.deleted` lifecycle path so cleanup does not have to wait
 * for the next lazy sweep.
 */
export const deleteSessionState = (
  state: Map<string, SessionState>,
  sessionID: string,
): boolean => {
  return state.delete(sessionID);
};

const maybeInjectSuperpowersBootstrap = async (
  directory: string,
  host: { client: OpencodeSkillHostClient },
  sessionID: string,
  context?: SkillHostContext,
  precomputed?: Map<string, Skill>,
): Promise<void> => {
  if (process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE !== 'true') return;
  const skillsByName = precomputed ?? await discoverAllSkills(directory);
  const usingSuperpowersSkill = skillsByName.get('using-superpowers');
  if (!usingSuperpowersSkill) return;
  const ctx = context ?? await host.client.getSessionContext(sessionID);
  const content = `<EXTREMELY_IMPORTANT>
You have superpowers.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - do not call use_skill for it again. Use use_skill only for OTHER skills.**

${usingSuperpowersSkill.template}

${toolMapping}

${skillsNamespace}
</EXTREMELY_IMPORTANT>`;
  await host.client.injectContent(sessionID, content, ctx);
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
5. Marketplace: \`claude-plugins:skill-name\`

The first discovered match wins.`;

/**
 * Render the matched-skill synthetic injection that asks the model to
 * evaluate which of the matched skills (if any) it should activate.
 *
 * Each skill line carries a sub-line `trigger: <text>` whenever the
 * skill has a non-empty `trigger`, so the model knows which user
 * phrases should activate it. Skills with no trigger render exactly as
 * before (`- name: description`).
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

// Synchronous factory to prevent any blocking during startup
export const SkillsPlugin: Plugin = async ({
  client,
  $,
  directory,
}: PluginInput) => {
  const host = createOpencodeSkillHost(client);

  // Per-instance session state. Module-level state would leak across plugin
  // instances (two plugins in the same process would share the bookkeeping
  // map), so it lives in the factory closure. The `touchSessionState`
  // helper drives both the lazy TTL + cap eviction and the per-touch
  // `lastTouchedAt` bump in a single call.
  const sessionStates = new Map<string, SessionState>();

  const getLoadedSkills = (sessionID: string): Set<string> => {
    return touchSessionState(sessionStates, sessionID, Date.now()).loadedSkills;
  };

  /**
   * Returns true when this chat.message is the first one for the session
   * AND no prior message in this session already injected the available-
   * skills block (which would mean the session was bootstrapped before
   * this plugin instance attached).
   */
  const isFirstMessageSetup = async (sessionID: string): Promise<boolean> => {
    const record = touchSessionState(sessionStates, sessionID, Date.now());
    if (record.setupComplete) return false;
    try {
      const existing = await client.session.messages({
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
    } catch (error) {
      debugLog("isFirstMessageSetup: failed to read existing messages", error);
    }
    return !record.setupComplete;
  };

  /** Mark the session as bootstrapped and inject the available-skills block. */
  const injectBootstrapSkills = async (
    sessionID: string,
    skillsByName: Map<string, Skill>,
    context: SkillHostContext,
  ): Promise<void> => {
    const record = touchSessionState(sessionStates, sessionID, Date.now());
    record.setupComplete = true;
    await maybeInjectSuperpowersBootstrap(directory, host, sessionID, context, skillsByName);
    await injectSkillsList(directory, host, sessionID, context, skillsByName);
  };

  /** Run keyword matching on the user message and inject the matched-skill prompt. */
  const handleKeywordMatch = async (
    userText: string,
    sessionID: string,
    summaries: SkillSummary[],
    context: SkillHostContext,
  ): Promise<void> => {
    if (!userText) return;
    if (summaries.length === 0) return;

    const matchedSkills = matchSkillsByKeyword(userText, summaries);
    const loadedSkills = getLoadedSkills(sessionID);
    const newSkills = matchedSkills.filter(s => !loadedSkills.has(s.name));
    if (newSkills.length === 0) return;

    const injectionText = formatMatchedSkillsInjection(newSkills);
    await host.client.injectContent(sessionID, injectionText, context);
  };

  const tools = createSkillTools(
    host,
    $,
    directory,
    (sessionID, skillName) => {
      getLoadedSkills(sessionID).add(skillName);
    },
  );

  return {
    "chat.message": async (input, output) => {
      // Defensive: narrow the SDK payload through our local type so the
      // plugin degrades gracefully if the SDK sends a partial / malformed
      // shape. The plugin factory still returns the SDK's Hooks type, so
      // the outer signature is inferred from the SDK contract.
      const rawOutput = output as unknown;
      if (!rawOutput || typeof rawOutput !== "object") {
        debugLog("chat.message: missing or non-object output", output);
        return;
      }
      const safeOutput = rawOutput as ChatMessageOutput;
      if (typeof safeOutput.message?.sessionID !== "string") {
        debugLog("chat.message: missing sessionID on output", safeOutput);
        return;
      }
      const sessionID = safeOutput.message.sessionID;

      // Single discovery per handler invocation. Both bootstrap and keyword
      // matching consume the same snapshot; no cross-request caching.
      const skillsByName = await discoverAllSkills(directory);
      const summaries: SkillSummary[] = Array.from(skillsByName.values()).map(skill => ({
        name: skill.name,
        description: skill.description,
        trigger: skill.trigger,
      }));

      const context: SkillHostContext = {
        // The SDK's model field is `{ providerID, modelID }`; the local
        // interface declares it as a loose `string` per the SDK-shape spec,
        // so we cast here to land it on the boundary contract without
        // pulling the full UserMessage type into the plugin module.
        model: safeOutput.message.model as { providerID: string; modelID: string } | undefined,
        agent: safeOutput.message.agent,
      };

      if (await isFirstMessageSetup(sessionID)) {
        await injectBootstrapSkills(sessionID, skillsByName, context);
        return;
      }

      const rawParts = Array.isArray(safeOutput.parts) ? safeOutput.parts : [];
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

    event: async ({ event }) => {
      // Defensive narrowing via local type guards; the SDK passes a
      // broad Event union and we only care about two of its variants.
      if (isSessionCompactedEvent(event)) {
        const sessionID = event.properties.sessionID;
        if (typeof sessionID !== "string") {
          debugLog("event: session.compacted missing sessionID", event);
          return;
        }
        const context = await host.client.getSessionContext(sessionID);
        await maybeInjectSuperpowersBootstrap(directory, host, sessionID, context);
        await injectSkillsList(directory, host, sessionID, context);
        // Touch to refresh `lastTouchedAt`, then clear the loaded-skill
        // set so the keyword matcher can re-trigger. `setupComplete`
        // stays true so the next chat.message takes the keyword path
        // rather than re-bootstrapping.
        const record = touchSessionState(sessionStates, sessionID, Date.now());
        record.loadedSkills.clear();
        return;
      }

      if (isSessionDeletedEvent(event)) {
        const sessionID = event.properties.info?.id;
        if (typeof sessionID !== "string") {
          debugLog("event: session.deleted missing info.id", event);
          return;
        }
        // Explicit cleanup — no need to wait for the lazy sweep.
        deleteSessionState(sessionStates, sessionID);
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
