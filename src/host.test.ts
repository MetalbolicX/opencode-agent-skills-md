/**
 * RED phase: Port of packages/opencode-agent-skills-md/tests/opencode/host.test.ts
 * into root src/host.test.ts.
 *
 * These tests verify createOpencodeSkillHost contract:
 *   - injectContent -> client.session.prompt (noReply + synthetic, agent/model forwarded when known)
 *   - readFile passthrough (filesystem-backed)
 *   - readdir passthrough (filesystem-backed)
 *   - session(id) factory returns a SkillHostSession
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { createOpencodeSkillHost } from "./host";
import type { SessionContext } from "./types";

describe("createOpencodeSkillHost", () => {
  let workspace: string;
  let fixtureFile: string;
  let fixtureDir: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-host-"));
    fixtureDir = path.join(workspace, "sub");
    await mkdir(fixtureDir, { recursive: true });
    fixtureFile = path.join(workspace, "hello.txt");
    await writeFile(fixtureFile, "hello host", "utf8");
    await writeFile(path.join(fixtureDir, "a.txt"), "alpha", "utf8");
    await writeFile(path.join(fixtureDir, "b.txt"), "bravo", "utf8");
  });

  after(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("injectContent omits model/agent when no context is available", async () => {
    const prompts: Array<{
      path: { id: string };
      body: {
        noReply?: boolean;
        model?: { providerID: string; modelID: string };
        agent?: string;
        parts: Array<{ type: string; text: string; synthetic?: boolean }>;
      };
    }> = [];
    const stub = {
      session: {
        prompt: async (input: typeof prompts[number]) => {
          prompts.push(input);
        },
        messages: async () => ({ data: [] }),
      },
    };
    const host = createOpencodeSkillHost(stub as any, () => undefined);

    await host.client.injectContent("sess-1", "hello world");

    assert.equal(prompts.length, 1);
    assert.deepEqual(prompts[0]!.path, { id: "sess-1" });
    assert.equal(prompts[0]!.body.noReply, true);
    assert.equal(prompts[0]!.body.model, undefined, "model must not be forwarded when context is absent");
    assert.equal(prompts[0]!.body.agent, undefined, "agent must not be forwarded when context is absent");
    assert.equal(prompts[0]!.body.parts[0]!.type, "text");
    assert.equal(prompts[0]!.body.parts[0]!.text, "hello world");
    assert.equal(prompts[0]!.body.parts[0]!.synthetic, true);
  });

  test("injectContent forwards model/agent from the callback context", async () => {
    const prompts: any[] = [];
    const stub = {
      session: {
        prompt: async (input: any) => {
          prompts.push(input);
        },
        messages: async () => ({ data: [] }),
      },
    };
    const context: SessionContext = {
      agent: "build",
      model: { providerID: "anthropic", modelID: "opus" },
    };
    const host = createOpencodeSkillHost(stub as any, () => context);

    await host.client.injectContent("sess-2", "hello world");

    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].body.agent, "build");
    assert.deepEqual(prompts[0].body.model, { providerID: "anthropic", modelID: "opus" });
  });

  test("injectContent explicit context overrides callback context", async () => {
    const prompts: any[] = [];
    const stub = {
      session: {
        prompt: async (input: any) => {
          prompts.push(input);
        },
        messages: async () => ({ data: [] }),
      },
    };
    const host = createOpencodeSkillHost(stub as any, () => ({
      agent: "plan",
      model: { providerID: "openai", modelID: "gpt-4" },
    }));

    await host.client.injectContent("sess-3", "hello world", {
      agent: "build",
      model: { providerID: "anthropic", modelID: "opus" },
    });

    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].body.agent, "build");
    assert.deepEqual(prompts[0].body.model, { providerID: "anthropic", modelID: "opus" });
  });

  test("readFile reads file content from the host's filesystem", async () => {
    const host = createOpencodeSkillHost({} as any, () => undefined);

    const content = await host.client.readFile(fixtureFile);

    assert.equal(content, "hello host");
  });

  test("readdir lists directory entries from the host's filesystem", async () => {
    const host = createOpencodeSkillHost({} as any, () => undefined);

    const entries = (await host.client.readdir(fixtureDir)).sort();

    assert.deepEqual(entries, ["a.txt", "b.txt"]);
  });

  test("session(id) returns a SkillHostSession with the supplied id", () => {
    const host = createOpencodeSkillHost({} as any, () => undefined);

    const session = host.session("sess-factory");

    assert.deepEqual(session, { id: "sess-factory" });
  });
});
