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
import type { SkillHostClient, SkillHostSession } from "./types";
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
}

export const createOpencodeSkillHost = (client: OpencodeClient): OpencodeSkillHost => {
  const skillClient: OpencodeSkillHostClient = {
    async injectContent(sessionID, text) {
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          // Deliberately omit model/agent: synthetic noReply messages must not
          // create a shadow UserMessage that flips the TUI model/agent selector.
          parts: [{ type: "text", text, synthetic: true }],
        },
      });
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
