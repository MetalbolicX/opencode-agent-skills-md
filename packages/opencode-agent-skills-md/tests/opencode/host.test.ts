import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { createOpencodeSkillHost } from "../../src/host";

/**
 * Host adapter contract test.
 *
 * Verifies that `createOpencodeSkillHost` translates calls into the correct
 * OpenCode client surface, using a hand-rolled stub client. No real
 * @opencode-ai/plugin runtime is loaded beyond the type import.
 *
 * Coverage:
 *   - injectContent -> client.session.prompt (noReply + synthetic + model/agent)
 *   - getSessionContext -> client.session.messages (walks user messages)
 *   - readFile passthrough (filesystem-backed)
 *   - readdir passthrough (filesystem-backed)
 *   - session(id) factory returns a SkillHostSession
 */
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

  test("injectContent translates to client.session.prompt with noReply + synthetic", async () => {
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
    const host = createOpencodeSkillHost(stub as any);

    await host.client.injectContent("sess-1", "hello world", {
      model: { providerID: "p", modelID: "m" },
      agent: "a",
    });

    assert.equal(prompts.length, 1);
    assert.deepEqual(prompts[0]!.path, { id: "sess-1" });
    assert.equal(prompts[0]!.body.noReply, true);
    assert.deepEqual(prompts[0]!.body.model, { providerID: "p", modelID: "m" });
    assert.equal(prompts[0]!.body.agent, "a");
    assert.equal(prompts[0]!.body.parts[0]!.type, "text");
    assert.equal(prompts[0]!.body.parts[0]!.text, "hello world");
    assert.equal(prompts[0]!.body.parts[0]!.synthetic, true);
  });

  test("injectContent omits model/agent when no context is provided", async () => {
    const prompts: any[] = [];
    const stub = {
      session: {
        prompt: async (input: any) => {
          prompts.push(input);
        },
        messages: async () => ({ data: [] }),
      },
    };
    const host = createOpencodeSkillHost(stub as any);

    await host.client.injectContent("sess-2", "bare content");

    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.body.model, undefined);
    assert.equal(prompts[0]!.body.agent, undefined);
    assert.equal(prompts[0]!.body.parts[0]!.text, "bare content");
  });

  test("getSessionContext walks client.session.messages and returns the first user model + agent", async () => {
    const stub = {
      session: {
        prompt: async () => {},
        messages: async () => ({
          data: [
            { info: { role: "assistant" } },
            { info: { role: "user", model: { providerID: "p", modelID: "m" }, agent: "a" } },
            { info: { role: "user", model: { providerID: "p2", modelID: "m2" }, agent: "a2" } },
          ],
        }),
      },
    };
    const host = createOpencodeSkillHost(stub as any);

    const ctx = await host.client.getSessionContext("sess-3");

    assert.deepEqual(ctx, {
      model: { providerID: "p", modelID: "m" },
      agent: "a",
    });
  });

  test("getSessionContext returns undefined when no user message carries a model", async () => {
    const stub = {
      session: {
        prompt: async () => {},
        messages: async () => ({
          data: [
            { info: { role: "assistant" } },
            { info: { role: "user" } },
          ],
        }),
      },
    };
    const host = createOpencodeSkillHost(stub as any);

    const ctx = await host.client.getSessionContext("sess-4");

    assert.equal(ctx, undefined);
  });

  test("getSessionContext returns undefined when client.session.messages throws", async () => {
    const stub = {
      session: {
        prompt: async () => {},
        messages: async () => {
          throw new Error("network down");
        },
      },
    };
    const host = createOpencodeSkillHost(stub as any);

    const ctx = await host.client.getSessionContext("sess-5");

    assert.equal(ctx, undefined);
  });

  test("readFile reads file content from the host's filesystem", async () => {
    const host = createOpencodeSkillHost({} as any);

    const content = await host.client.readFile(fixtureFile);

    assert.equal(content, "hello host");
  });

  test("readdir lists directory entries from the host's filesystem", async () => {
    const host = createOpencodeSkillHost({} as any);

    const entries = (await host.client.readdir(fixtureDir)).sort();

    assert.deepEqual(entries, ["a.txt", "b.txt"]);
  });

  test("session(id) returns a SkillHostSession with the supplied id", () => {
    const host = createOpencodeSkillHost({} as any);

    const session = host.session("sess-factory");

    assert.deepEqual(session, { id: "sess-factory" });
  });
});
