/**
 * Tests for createOpencodeSkillHost contract (after eliminating
 * session.prompt() injection).
 *
 * Verifies:
 *   - readFile passthrough (filesystem-backed)
 *   - readdir passthrough (filesystem-backed)
 *   - session(id) factory returns a SkillHostSession
 *   - client only exposes filesystem methods (injectContent/getSessionContext removed)
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { createOpencodeSkillHost } from "./host";

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

  test("client exposes only filesystem methods (readFile, readdir)", () => {
    const host = createOpencodeSkillHost({} as any);
    const client = host.client;

    assert.equal(typeof client.readFile, "function", "readFile must be a function");
    assert.equal(typeof client.readdir, "function", "readdir must be a function");
    // injectContent and getSessionContext were removed
    assert.equal(typeof (client as any).injectContent, "undefined", "injectContent must not exist");
    assert.equal(typeof (client as any).getSessionContext, "undefined", "getSessionContext must not exist");
  });
});
