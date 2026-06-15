/**
 * OpenCode host glue — backward-compatible shim for legacy imports.
 *
 * The portable skills engine lives under `src/core/` and the OpenCode
 * adapter (the only concrete `SkillHostClient` implementation) lives under
 * `src/opencode/`. This module survives as a thin re-export shim so
 * existing consumers that imported `OpencodeClient`, `SessionContext`,
 * `injectSyntheticContent`, and `getSessionContext` from `../utils`
 * keep compiling without churn.
 *
 * PR3 may either keep this shim or fold its exports into the host
 * adapter. Either way, the four named exports below are the only stable
 * surface of this module.
 */

import type { PluginInput } from "@opencode-ai/plugin";
import type { SkillHostContext } from "./core";

/** OpenCode SDK client type (alias of `PluginInput["client"]`). */
export type OpencodeClient = PluginInput["client"];

/**
 * Session context (model + agent) carried alongside synthetic injections.
 * Structurally identical to the core's `SkillHostContext`; kept under the
 * legacy name so the existing public surface is preserved.
 */
export type SessionContext = SkillHostContext;

/**
 * Inject content into a session via noReply + synthetic.
 * Content persists across context compaction.
 * Must pass model and agent to prevent mode/model switching.
 *
 * @deprecated Prefer consuming the host's `SkillHostClient.injectContent`
 * via `createOpencodeSkillHost(client).client`. This function remains for
 * legacy callers that already hold a raw `OpencodeClient`.
 */
export async function injectSyntheticContent(
  client: OpencodeClient,
  sessionID: string,
  text: string,
  context?: SessionContext
): Promise<void> {
  await client.session.prompt({
    path: { id: sessionID },
    body: {
      noReply: true,
      model: context?.model,
      agent: context?.agent,
      parts: [{ type: "text", text, synthetic: true }],
    },
  });
}

/**
 * Get the current context (model + agent) for a session by querying messages.
 * This mirrors OpenCode's internal lastModel() logic to find the most recent
 * user message and extract its model/agent.
 *
 * Used during tool execution when we don't have direct access to the
 * current user message's context.
 *
 * @deprecated Prefer consuming the host's `SkillHostClient.getSessionContext`
 * via `createOpencodeSkillHost(client).client`. This function remains for
 * legacy callers that already hold a raw `OpencodeClient`.
 */
export async function getSessionContext(
  client: OpencodeClient,
  sessionID: string,
  limit: number = 50
): Promise<SessionContext | undefined> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { limit }
    });

    if (response.data) {
      for (const msg of response.data) {
        if (msg.info.role === "user" && "model" in msg.info && msg.info.model) {
          return {
            model: msg.info.model,
            agent: msg.info.agent
          };
        }
      }
    }
  } catch { }

  return undefined;
}
