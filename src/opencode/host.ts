/**
 * OpenCode host adapter.
 *
 * The single concrete implementation of the portable `SkillHostClient` and
 * `SkillHostSession` contracts declared in `src/core/types.ts`. Wraps the
 * OpenCode SDK client (`PluginInput["client"]`) and adapts its full surface
 * down to the bounded `SkillHostClient` interface the core engine consumes.
 *
 * Why the file access methods are filesystem-backed:
 *
 * The OpenCode SDK exposes structured file APIs (`client.file.read`,
 * `client.file.list`) that return rich metadata. The skills tools only need
 * the raw content and the entry names, so this adapter keeps the contract
 * simple and uses `node:fs/promises` directly. Centralising the access here
 * means the tools never import the filesystem module themselves.
 *
 * Boundary map:
 *   - host.client.injectContent  -> client.session.prompt (noReply + synthetic)
 *   - host.client.getSessionContext -> client.session.messages (first user model)
 *   - host.client.readFile       -> node:fs.readFile
 *   - host.client.readdir        -> node:fs.readdir
 *   - host.session(id)           -> SkillHostSession { id }
 */

import * as fs from "node:fs/promises";
import type { PluginInput } from "@opencode-ai/plugin";
import type {
  SkillHostClient,
  SkillHostSession,
} from "../core";

/** Concrete OpenCode client (the SDK's generated client type). */
export type OpencodeClient = PluginInput["client"];

/**
 * File access surface exposed alongside the core `SkillHostClient`. Tools
 * consume these via the host instead of importing `node:fs/promises` so the
 * boundary stays explicit and easy to stub in tests.
 */
export interface OpencodeHostFileAccess {
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
}

/** Combined client surface the host exposes to tools and the plugin. */
export type OpencodeSkillHostClient = SkillHostClient & OpencodeHostFileAccess;

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
 * `client.session.prompt` and `client.session.messages` methods. Any other
 * module that needs to inject content or look up session context should
 * consume the returned `SkillHostClient` surface, not the raw SDK client.
 */
export function createOpencodeSkillHost(client: OpencodeClient): OpencodeSkillHost {
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
      } catch {
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
}
