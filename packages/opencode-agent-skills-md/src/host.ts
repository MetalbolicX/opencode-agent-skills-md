/**
 * OpenCode host adapter.
 *
 * Wraps the OpenCode SDK client (`PluginInput["client"]`) and provides
 * a bounded surface for content injection, session context, and filesystem
 * access consumed by the plugin and skill tools.
 *
 * The boundary contracts (`SkillHostClient`, `SkillHostSession`,
 * `SkillHostContext`) are declared in the `opencode-agent-skills-md-core`
 * package per spec R2; this module IMPLEMENTS them over the OpenCode SDK
 * client plus `node:fs/promises`. No other package may declare a concrete
 * implementation — the plugin package owns exactly one.
 */

import * as fs from "node:fs/promises";
import type { PluginInput } from "@opencode-ai/plugin";
import type {
  SkillHostClient,
  SkillHostContext,
  SkillHostSession,
} from "opencode-agent-skills-md-core";
import { debugLog } from "opencode-agent-skills-md-core";

/** Concrete OpenCode client (the SDK's generated client type). */
export type OpencodeClient = PluginInput["client"];

/**
 * File access surface exposed alongside the host client. Tools
 * consume these via the host instead of importing `node:fs/promises` so the
 * boundary stays explicit and easy to stub in tests.
 */
export interface OpencodeHostFileAccess {
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
}

/**
 * Concrete OpenCode client surface.
 *
 * Structurally identical to the core boundary contract `SkillHostClient`
 * (it implements all four methods). The alias is preserved for backward
 * compatibility with prior plugin-package consumers and to make the
 * OpenCode-specific implementation obvious at use sites.
 */
export type OpencodeSkillHostClient = SkillHostClient;

/**
 * The full host surface: a bounded client plus a session factory. Each call
 * to `session(id)` returns a `SkillHostSession` carrying only the id the core
 * needs to thread through host calls.
 */
export interface OpencodeSkillHost {
  client: OpencodeSkillHostClient;
  session: (id: string) => SkillHostSession;
}

/**
 * Build an `OpencodeSkillHost` over the supplied OpenCode SDK client.
 *
 * The host is the only place in the codebase that touches the SDK's
 * `client.session.prompt` and `client.session.messages` methods.
 */
export const createOpencodeSkillHost = (client: OpencodeClient): OpencodeSkillHost => {
  const skillClient: OpencodeSkillHostClient = {
    async injectContent(sessionID, text, context) {
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          model: context?.model,
          agent: context?.agent,
          parts: [{ type: "text", text, synthetic: true }],
        },
      });
    },

    async getSessionContext(sessionID) {
      try {
        const response = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 50 },
        });

        if (response.data) {
          for (const msg of response.data) {
            if (
              msg.info.role === "user" &&
              "model" in msg.info &&
              msg.info.model
            ) {
              return {
                model: msg.info.model,
                agent: msg.info.agent,
              };
            }
          }
        }
      } catch (error) {
        debugLog("getSessionContext: session lookup failed", sessionID, (error as Error)?.name);
        // Fall through to undefined - mirrors the legacy behaviour where
        // getSessionContext returns undefined on any lookup failure.
      }

      return undefined;
    },

    async readFile(filePath) {
      return fs.readFile(filePath, "utf-8");
    },

    async readdir(dirPath) {
      return fs.readdir(dirPath);
    },
  };

  const session = (id: string): SkillHostSession => ({ id });

  return { client: skillClient, session };
};
