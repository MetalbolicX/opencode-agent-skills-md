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
  renderSkillPreflightBlock,
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
  type SystemTransformInput,
  type SystemTransformOutput,
  type ToolDefinitionInput,
  type ToolDefinitionOutput,
} from "./sdk";
import {
  applySystemTransform,
  applyToolDefinition,
  isPreferenceLayerEnabled,
} from "./preference-hooks";

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
 *
 * Preference-layer additions (PR 2 of preference-layer):
 *
 *   - `pendingSkills` tracks skills that matched the current turn and
 *     have been injected as a `<skill-preflight>` directive but not yet
 *     loaded via `use_skill`. A successful load removes the entry so
 *     the same skill does not re-trigger on the next turn.
 *   - `injectedSummaries` records every skill whose `<skill-preflight>`
 *     directive has been injected for the session, regardless of whether
 *     it was subsequently loaded. It functions as the dedupe set:
 *     `handleKeywordMatch` filters out skills already in this set so a
 *     keyword match in a later turn does NOT re-emit the same directive.
 *
 * Both sets are reset on `session.compacted` (per design's
 * "Compaction resets state" scenario) and dropped wholesale on
 * `session.deleted` via the existing `deleteSessionState` helper.
 */
export interface SessionState {
  setupComplete: boolean;
  loadedSkills: Set<string>;
  pendingSkills: Set<string>;
  injectedSummaries: Set<string>;
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
    pendingSkills: new Set(),
    injectedSummaries: new Set(),
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

  /**
   * Run keyword matching on the user message and inject the matched-skill prompt.
   *
   * PR 2 of preference-layer — replaces the legacy soft-hint
   * `<skill-evaluation-required>` block with the directive
   * `<skill-preflight>` block rendered from core, and adds three
   * dedupe sets:
   *
   *   - `loadedSkills` — skills already loaded via `use_skill` this
   *     session; never re-injected.
   *   - `pendingSkills` — skills whose `<skill-preflight>` directive
   *     has been injected this session but not yet loaded. A
   *     successful `use_skill` removes the entry (see the
   *     `onSkillLoaded` callback below).
   *   - `injectedSummaries` — every skill whose directive has been
   *     injected this session. Functions as the dedupe set: a keyword
   *     match in a later turn does NOT re-emit the same directive
   *     for a skill that has already been suggested (spec scenario:
   *     "Duplicate match is deduped").
   *
   * All three sets are reset on `session.compacted`. The whole
   * directive-injection path is gated by `isPreferenceLayerEnabled()`
   * so the `OPENCODE_AGENT_SKILLS_PREFERENCE_MODE=off` env var fully
   * disables Layer 3 of the preference layer (spec scenario:
   * "Off disables every layer").
   */
  const handleKeywordMatch = async (
    userText: string,
    sessionID: string,
    summaries: SkillSummary[],
    context: SkillHostContext,
  ): Promise<void> => {
    if (!isPreferenceLayerEnabled()) return;
    if (!userText) return;
    if (summaries.length === 0) return;

    const matchedSkills = matchSkillsByKeyword(userText, summaries);
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

    // Mark every newly-injected skill as pending + recorded in the
    // injectedSummaries dedupe set BEFORE the await on injectContent,
    // so a concurrent chat.message on the same session sees the
    // dedupe state immediately and does not race a duplicate
    // injection.
    for (const skill of newSkills) {
      record.pendingSkills.add(skill.name);
      record.injectedSummaries.add(skill.name);
    }

    await host.client.injectContent(sessionID, injectionText, context);
  };

  const tools = createSkillTools(
    host,
    $,
    directory,
    (sessionID, skillName) => {
      const record = touchSessionState(sessionStates, sessionID, Date.now());
      record.loadedSkills.add(skillName);
      // Successful `use_skill` clears the pending entry so the next
      // turn does not try to re-prompt for this skill. The skill
      // stays in `injectedSummaries` so the dedupe set is preserved
      // for the lifetime of the session (it gets reset on compaction,
      // not on load).
      record.pendingSkills.delete(skillName);
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
        // Touch to refresh `lastTouchedAt`, then reset the loaded-skill,
        // pending, and injected-summary sets so the keyword matcher can
        // re-trigger after compaction. `setupComplete` stays true so the
        // next chat.message takes the keyword path rather than
        // re-bootstrapping. Per the preference-layer spec, compaction
        // resets both `pendingSkills` and `injectedSummaries` so the
        // dedupe state does not leak across the compaction boundary.
        const record = touchSessionState(sessionStates, sessionID, Date.now());
        record.loadedSkills.clear();
        record.pendingSkills.clear();
        record.injectedSummaries.clear();
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

    /**
     * `tool.definition` — append-only description annotation.
     *
     * Layer 2 of the preference layer: for each native tool whose
     * ID is in `PREFERENCE_TOOL_IDS`, append the one-sentence
     * skill-first note to its description. Tools outside the set
     * pass through untouched. The helper itself short-circuits when
     * `OPENCODE_AGENT_SKILLS_PREFERENCE_MODE=off`, but we guard the
     * hook entry point too so the SDK never even calls the helper
     * when the layer is off (defense in depth + zero work on the
     * hot path).
     */
    "tool.definition": async (input: unknown, output: unknown) => {
      if (!isPreferenceLayerEnabled()) return;
      applyToolDefinition(
        input as ToolDefinitionInput,
        output as ToolDefinitionOutput,
      );
    },

    /**
     * `experimental.chat.system.transform` — append-only system prompt
     * injection.
     *
     * Layer 1 of the preference layer: on every chat turn the SDK
     * passes the system prompt array it is assembling; we push the
     * `<skill-preference-policy>` block (with the catalog of every
     * available skill) onto that array. Append-only — existing entries
     * are preserved. The env-var gate inside the helper short-circuits
     * cleanly when the layer is disabled.
     */
    "experimental.chat.system.transform": async (
      _input: unknown,
      output: unknown,
    ) => {
      if (!isPreferenceLayerEnabled()) return;
      const rawOutput = output as SystemTransformOutput | undefined;
      if (!rawOutput || typeof rawOutput !== "object") {
        debugLog(
          "experimental.chat.system.transform: missing or non-object output",
          output,
        );
        return;
      }
      // Cheap discovery: the catalog lists every skill the model can
      // choose from. Run a single `discoverAllSkills` per turn — the
      // same cost the existing chat.message path pays.
      const skillsByName = await discoverAllSkills(directory);
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
