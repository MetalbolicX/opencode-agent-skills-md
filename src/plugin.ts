/**
 * OpenCode plugin — Phase 5 atomic switch.
 *
 * Mirrors packages/opencode-agent-skills-md/src/plugin.ts behaviour.
 *
 * Uses one SkillStore per plugin instance and one SessionTracker per session.
 * All domain logic (matching, formatting) is delegated to leaf modules.
 * Stateless helpers are in plugin-helpers.ts (C8).
 */

import type { SkillSummary } from "./types";
import { debugLog } from "./log";
import { createSkillStore } from "./skill-store";
import { createSessionTracker } from "./session-tracker";
import { renderAvailableSkillsBlock } from "./preference";
import { createSkillTools } from "./tools/index";
import {
  isPreferenceLayerEnabled,
  applyToolDefinition,
  applySystemTransform,
} from "./preference-hooks";
import { createMatcher, type Matcher } from "./embeddings";
import type { SessionTracker } from "./types";
import {
  touchSessionState,
  evictSessionState,
  deleteSessionState,
  isChatTextPart,
  appendSyntheticText,
  type SessionState,
  MAX_TRACKED_SESSIONS,
  SESSION_TTL_MS,
  type ChatMessageOutput,
} from "./plugin-helpers";

/**
 * Re-exported from plugin-helpers.ts for the plugin's public API surface.
 * Type guard for OpenCode TextPart shape — used in `isFirstMessageSetup`
 * to detect whether a message part contains human-authored text.
 */
export { isChatTextPart };

export { debugLog } from "./log";

/**
 * B4: Named interface for the minimal OpenCode client shape used in plugin hooks.
 *
 * This interface captures only the `session.messages` field that the plugin
 * reads inside `isFirstMessageSetup` to detect whether a bootstrap block has
 * already been injected into the session history. Any client that provides
 * this minimal shape is compatible — no full OpenCode client type is needed.
 *
 * Removes the inline cast that was previously spread across `isFirstMessageSetup`.
 */
export interface OpencodeClientLike {
  session?: {
    messages?: (input: { path: { id: string } }) => Promise<{
      data: Array<{ parts?: unknown; info?: { parts?: unknown } }>;
    }>;
  };
}

export { MAX_TRACKED_SESSIONS, SESSION_TTL_MS };
export type { SessionState };

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
  // Phase 5: One SkillStore per plugin instance
  const store = createSkillStore(directory);

  // Phase 5: Per-session trackers (replaces raw SessionState map)
  const trackers = new Map<string, SessionTracker>();

  // Get or create a session tracker with TTL eviction
  const getOrCreateTracker = (sessionID: string): SessionTracker => {
    const now = Date.now();
    // Evict old sessions
    for (const [id, tracker] of trackers) {
      if (now - tracker.lastTouchedAt > SESSION_TTL_MS) {
        trackers.delete(id);
      }
    }
    // Evict excess sessions
    if (trackers.size >= MAX_TRACKED_SESSIONS) {
      const sorted = Array.from(trackers.entries()).sort(
        (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt,
      );
      const excess = trackers.size - (MAX_TRACKED_SESSIONS - 1);
      for (let i = 0; i < excess; i++) {
        trackers.delete(sorted[i]![0]);
      }
    }
    let tracker = trackers.get(sessionID);
    if (!tracker) {
      tracker = createSessionTracker();
      trackers.set(sessionID, tracker);
    }
    tracker.touch();
    return tracker;
  };

  const getLoadedSkills = (sessionID: string): Set<string> => {
    return getOrCreateTracker(sessionID).loadedSkills as Set<string>;
  };

  const isFirstMessageSetup = async (sessionID: string): Promise<boolean> => {
    const tracker = getOrCreateTracker(sessionID);
    if (tracker.isSetupComplete()) return false;
    try {
      const typedClient = client as OpencodeClientLike;
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
            tracker.markSetupComplete();
            return false;
          }
        }
      }
    } catch (error) {
      debugLog("isFirstMessageSetup: failed to read existing messages", error);
    }
    return true;
  };

  /**
   * Append bootstrap content (superpowers block + available-skills block) to
   * output.parts. Sets setupComplete = true.
   */
  const appendBootstrapSkills = async (
    output: ChatMessageOutput,
    sessionID: string,
  ): Promise<void> => {
    const tracker = getOrCreateTracker(sessionID);
    tracker.markSetupComplete();

    if (process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE === 'true') {
      const skills = await store.all();
      const usingSuperpowersSkill = skills.find(s => s.name === 'using-superpowers');
      if (usingSuperpowersSkill) {
        const toolMappingBlock = `**Tool Mapping for OpenCode:**
- \`TodoWrite\` → \`todowrite\`
- \`Task\` tool with subagents → Use the \`task\` tool with \`subagent_type\`
- \`Skill\` tool → \`skill\` (same name in OpenCode)
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\`, \`Glob\`, \`Grep\`, \`WebFetch\` → Use the native lowercase OpenCode tools`;

        const skillsNamespaceBlock = `**Skill namespace priority:**
1. Project: \`project:skill-name\`
2. Claude project: \`claude-project:skill-name\`
3. User: \`skill-name\`
4. Claude user: \`claude-user:skill-name\`
5. Plugin cache: \`claude-plugin-cache:skill-name\`
6. Marketplace: \`claude-marketplace:skill-name\`

The first discovered match wins.`;

        const content = `<EXTREMELY_IMPORTANT>
You have superpowers.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - do not call skill for it again. Use skill only for OTHER skills.**

${usingSuperpowersSkill.template}

${toolMappingBlock}

${skillsNamespaceBlock}
</EXTREMELY_IMPORTANT>`;
        appendSyntheticText(output, content);
      }
    }

    const skills = await store.all();
    if (skills.length > 0) {
      appendSyntheticText(output, renderAvailableSkillsBlock(skills));
    }
  };

  /**
   * Append keyword-matched skill preflight to output.parts.
   * Updates pendingSkills and injectedSummaries via tracker.
   */
  const handleKeywordMatch = async (
    output: ChatMessageOutput,
    userText: string,
    sessionID: string,
    summaries: SkillSummary[],
  ): Promise<void> => {
    if (!isPreferenceLayerEnabled()) return;
    if (!userText) return;
    if (summaries.length === 0) return;

    const matchedSkills = await matcher.match(userText, summaries);
    const tracker = getOrCreateTracker(sessionID);
    const newSkills = matchedSkills.filter(
      (s) =>
        !tracker.loadedSkills.has(s.name) &&
        !tracker.pendingSkills.has(s.name) &&
        !tracker.injectedSummaries.has(s.name),
    );
    if (newSkills.length === 0) return;

    // Import renderSkillPreflightBlock lazily to avoid circular deps
    const { renderSkillPreflightBlock } = await import("./preference");
    const injectionText = renderSkillPreflightBlock(newSkills);
    if (!injectionText) return;

    for (const skill of newSkills) {
      tracker.markPending(skill.name);
      tracker.markInjected(skill.name);
    }

    appendSyntheticText(output, injectionText);
  };

  // Phase 5: createSkillTools with new signature ({ store, shell })
  // Skill loading itself is handled by OpenCode's native `skill` tool, so
  // the plugin no longer needs a per-tool tracker or onSkillLoaded callback.
  const tools = createSkillTools({
    store,
    shell: $ as Parameters<typeof createSkillTools>[0]["shell"],
  });

  return {
    // Exposed for unit testing — do not use in production code
    _sessionStates: trackers,
    _isFirstMessageSetup: isFirstMessageSetup,
    _getOrCreateTracker: getOrCreateTracker,
    // _touchSessionState: for backward compatibility with existing tests
    _touchSessionState: (sessionID: string) => {
      const tracker = getOrCreateTracker(sessionID);
      // Set internal state for test setup (TypeScript doesn't allow direct property access on interface)
      (tracker as unknown as { setupComplete: boolean; loadedSkills: Set<string> }).setupComplete = true;
      return tracker;
    },

    "chat.message": async (input: unknown, output: unknown) => {
      const rawInput = input as { sessionID?: string; agent?: string; model?: { providerID: string; modelID: string } } | null;
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

      debugLog("chat.message: input agent=%s model=%s/%s output.message.agent=%s output.message.model=%s/%s",
        rawInput?.agent ?? "undefined",
        rawInput?.model?.providerID ?? "undefined",
        rawInput?.model?.modelID ?? "undefined",
        rawOutput.message?.agent ?? "undefined",
        rawOutput.message?.model?.providerID ?? "undefined",
        rawOutput.message?.model?.modelID ?? "undefined",
      );

      getOrCreateTracker(sessionID);

      const summaries = await store.summaries();
      const partsBefore = Array.isArray(rawOutput.parts) ? rawOutput.parts.length : 0;

      if (await isFirstMessageSetup(sessionID)) {
        await appendBootstrapSkills(rawOutput, sessionID);
        const partsAfter = Array.isArray(rawOutput.parts) ? rawOutput.parts.length : 0;
        debugLog("chat.message: exit bootstrap — synthetic injected=%s parts count %d→%d agent=%s model=%s/%s",
          partsAfter > partsBefore,
          partsBefore,
          partsAfter,
          rawOutput.message?.agent ?? "undefined",
          rawOutput.message?.model?.providerID ?? "undefined",
          rawOutput.message?.model?.modelID ?? "undefined",
        );
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

      await handleKeywordMatch(rawOutput, userText, sessionID, summaries);
      const partsAfter = Array.isArray(rawOutput.parts) ? rawOutput.parts.length : 0;
      debugLog("chat.message: exit keyword match — synthetic injected=%s parts count %d→%d agent=%s model=%s/%s",
        partsAfter > partsBefore,
        partsBefore,
        partsAfter,
        rawOutput.message?.agent ?? "undefined",
        rawOutput.message?.model?.providerID ?? "undefined",
        rawOutput.message?.model?.modelID ?? "undefined",
      );
    },

    event: async ({ event }: { event?: EventPayload }) => {
      if (!event) return;

      if (event.type === "session.compacted") {
        const sessionID = event.properties?.sessionID;
        if (typeof sessionID !== "string") {
          debugLog("event: session.compacted missing sessionID", event);
          return;
        }
        const tracker = trackers.get(sessionID);
        if (tracker) {
          tracker.clear();
        }
        store.invalidate();
        return;
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties?.info?.id;
        if (typeof sessionID !== "string") {
          debugLog("event: session.deleted missing info.id", event);
          return;
        }
        trackers.delete(sessionID);
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
      input: unknown,
      output: unknown,
    ) => {
      if (!isPreferenceLayerEnabled()) return;
      const rawInput = input as { sessionID?: string; model?: { providerID?: string; modelID?: string; id?: string } } | null;
      debugLog("experimental.chat.system.transform: input sessionID=%s model=%s/%s (id=%s)",
        rawInput?.sessionID ?? "undefined",
        rawInput?.model?.providerID ?? "undefined",
        rawInput?.model?.modelID ?? "undefined",
        rawInput?.model?.id ?? "undefined",
      );
      const rawOutput = output as { system?: string[] } | undefined;
      if (!rawOutput || typeof rawOutput !== "object") {
        debugLog(
          "experimental.chat.system.transform: missing or non-object output",
          output,
        );
        return;
      }
      // B3: Safe init — ensure system is always an array rather than casting away optionality
      rawOutput.system = rawOutput.system ?? [];
      const summaries = await store.summaries();
      applySystemTransform(summaries, rawOutput);
    },
  };
};


// Type guard for chat text part — exported for unit testing
export function isChatTextPart(part: unknown): part is { type?: string; text?: string; synthetic?: boolean } {
  if (typeof part !== "object" || part === null) return false;
  return (part as { type?: string }).type === "text";
}

export default {
  id: "opencode-agent-skills-md",
  server: SkillsPlugin,
};
