/**
 * OpenCode skill host adapter.
 *
 * Mirrors packages/opencode-agent-skills-md/src/host.ts behaviour.
 *
 * Wraps the OpenCode SDK client and provides a bounded surface for
 * filesystem access. Session.prompt() injection is eliminated — synthetic
 * context now flows through chat.message output.parts.
 *
 * The boundary contracts (SkillHostClient, SkillHostSession) are declared
 * in src/types.ts.
 */

import * as fs from "node:fs/promises";
import type { SkillHostClient, SkillHostSession } from "./types";

export type OpencodeClient = {
  session: {
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createOpencodeSkillHost = (client: OpencodeClient): OpencodeSkillHost => {
  const skillClient: OpencodeSkillHostClient = {
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
