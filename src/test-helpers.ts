/**
 * Shared Bun test fixtures and helpers.
 *
 * Moved from packages/opencode-agent-skills-md/tests/integration/helpers/mock-opencode.ts
 * to serve as root-level test infrastructure for the single-package Bun layout.
 */

import { mkdtemp, cp, rm, chmod } from "node:fs/promises";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "url";
import type { ToolContext } from "@opencode-ai/plugin";

// Resolve the fixture root relative to this file's location.
// Fixtures live at tests/fixtures/skills/ in the single-package Bun layout.
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, "..", "tests", "fixtures", "skills");

export interface FixtureWorkspace {
  projectRoot: string;
  homeRoot: string;
  scriptedSkillPath: string;
  cleanup: () => Promise<void>;
}

export interface PromptRecord {
  text: string;
  sessionID: string;
}

export interface MockOpencodeClient {
  client: {
    session: {
      messages: (input: { path: { id: string } }) => Promise<{ data: unknown[] }>;
      prompt: (input: { path: { id: string }; body: { parts: Array<{ text: string }> } }) => Promise<void>;
    };
  };
  prompts: PromptRecord[];
}

export interface ShellRecorder {
  shell: ((strings: TemplateStringsArray, ...values: unknown[]) => { text: () => Promise<string> }) & {
    cwd: (directory: string) => ShellRecorder["shell"];
    calls: Array<{ cwd: string; command: string }>;
  };
  calls: Array<{ cwd: string; command: string }>;
}

export async function createFixtureWorkspace(): Promise<FixtureWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-agent-skills-md-fixture-"));
  const projectRoot = path.join(root, "project");
  const homeRoot = path.join(root, "home");

  try {
    await cp(path.join(fixtureRoot, "project"), projectRoot, { recursive: true });
    await cp(path.join(fixtureRoot, "home"), homeRoot, { recursive: true });
  } catch (err) {
    // Surface the error so tests that depend on fixtures fail explicitly.
    throw new Error(
      `Fixture workspace setup failed: ${(err as Error).message}\n` +
      `fixtureRoot: ${fixtureRoot}\n` +
      `Ensure tests/fixtures/skills/{project,home} exist before running tests.`
    );
  }

  const scriptedSkillPath = path.join(projectRoot, ".opencode", "skills", "scripted-skill");
  try {
    await chmod(path.join(scriptedSkillPath, "bin", "echo.sh"), 0o755);
  } catch {
    // Executable may not exist yet in RED phase
  }

  const previousHome = process.env.HOME;
  process.env.HOME = homeRoot;

  return {
    projectRoot,
    homeRoot,
    scriptedSkillPath,
    cleanup: async () => {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function createMockOpencodeClient(initialMessages: unknown[] = []): MockOpencodeClient {
  const prompts: PromptRecord[] = [];

  return {
    prompts,
    client: {
      session: {
        messages: async () => ({ data: initialMessages }),
        prompt: async ({ path: sessionPath, body }) => {
          const text = body.parts[0]?.text ?? "";
          prompts.push({ text, sessionID: sessionPath.id });
        },
      },
    },
  };
}

export function createMockToolContext(sessionID: string = "test-session"): ToolContext {
  return {
    sessionID,
    messageID: "msg_test",
    agent: "test",
    directory: "/test",
    worktree: "/test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as ToolContext;
}

export function createShellRecorder(): ShellRecorder {
  const calls: Array<{ cwd: string; command: string }> = [];
  let currentCwd = "";

  const shell = Object.assign(
    ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const command = strings.reduce((acc, chunk, index) => {
        const value = values[index];
        const rendered = Array.isArray(value) ? value.join(" ") : String(value ?? "");
        return acc + chunk + rendered;
      }, "");

      calls.push({ cwd: currentCwd, command });

      return {
        text: async () => `cwd=${currentCwd}\n${command}`,
      };
    }) as ShellRecorder["shell"],
    {
      cwd(directory: string) {
        currentCwd = directory;
        return shell;
      },
      calls,
    }
  );

  return { shell, calls };
}
