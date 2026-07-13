/**
 * OpenCode skill host adapter.
 *
 * Mirrors packages/opencode-agent-skills-md/src/host.ts behaviour.
 *
 * Wraps the OpenCode SDK client and provides a bounded surface for
 * content injection, session context, and filesystem access.
 *
 * The boundary contracts (SkillHostClient, SkillHostSession) are declared
 * in src/types.ts.
 */

import * as fs from "node:fs/promises";
import type { SkillHostClient, SkillHostSession, SessionContext } from "./types";
import { debugLog } from "./utils";

export type OpencodeClient = {
  session: {
    prompt: (input: {
      path: { id: string };
      body: {
        noReply?: boolean;
        model?: { providerID: string; modelID: string };
        agent?: string;
        parts: Array<{ type: string; text: string; synthetic?: boolean }>;
      };
    }) => Promise<void>;
    messages: (input: { path: { id: string }; query?: { limit?: number } }) => Promise<{
      data: Array<{ info?: { role?: string; model?: { providerID: string; modelID: string }; agent?: string } }>;
    }>;
  };
};

export type OpencodeSkillHostClient = SkillHostClient;

export interface OpencodeSkillHost {
  client: OpencodeSkillHostClient;
  session: (id: string) => SkillHostSession;
  getSessionContext: (sessionID: string) => SessionContext | undefined;
}

export const createOpencodeSkillHost = (
  client: OpencodeClient,
  getSessionContext: (sessionID: string) => SessionContext | undefined,
): OpencodeSkillHost => {
  const skillClient: OpencodeSkillHostClient = {
    async injectContent(sessionID, text, context) {
      // Forward the current turn's agent/model so the synthetic noReply message
      // carries the user's actual selection. Without this, the server fills in
      // the session default (created at session-init) which can differ from the
      // current selection after a model/agent switch.
      const resolved = context ?? getSessionContext(sessionID);
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          ...(resolved?.agent && { agent: resolved.agent }),
          ...(resolved?.model && { model: resolved.model }),
          parts: [{ type: "text", text, synthetic: true }],
        },
      });
    },

    getSessionContext(sessionID) {
      return getSessionContext(sessionID);
    },

    async readFile(filePath) {
      return fs.readFile(filePath, "utf-8");
    },

    async readdir(dirPath) {
      return fs.readdir(dirPath);
    },
  };

  const session = (id: string): SkillHostSession => ({ id });

  return { client: skillClient, session, getSessionContext };
};
