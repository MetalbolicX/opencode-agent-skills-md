import { describe, expect, test } from "bun:test";
import { spawnOpencodePlugin, type SpawnResult } from "./spawn";

// ---------------------------------------------------------------------------
// Test doubles for SpawnFn
// ---------------------------------------------------------------------------

type SpawnCall = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdio: "pipe" | "inherit";
};

const createFakeSpawn = (
  results: SpawnResult[],
): {
  spawnFn: (command: string, args: string[], options: { env: NodeJS.ProcessEnv; stdio: "pipe" | "inherit" }) => SpawnResult;
  calls: SpawnCall[];
} => {
  const calls: SpawnCall[] = [];
  let callIndex = 0;
  const spawnFn = (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; stdio: "pipe" | "inherit" },
  ): SpawnResult => {
    calls.push({ command, args, env: options.env, stdio: options.stdio });
    return results[callIndex++] ?? { status: 0, stdout: "", stderr: "" };
  };
  return { spawnFn, calls };
};

// ---------------------------------------------------------------------------
// spawnOpencodePlugin tests
// ---------------------------------------------------------------------------

describe("spawnOpencodePlugin", () => {
  test("runs opencode plugin <name> --global --force with correct args", async () => {
    const { spawnFn, calls } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    // Caller passes the full args including --global --force
    await spawnOpencodePlugin(["opencode-agent-skills-md", "--global", "--force"], { spawn: spawnFn });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("opencode");
    expect(calls[0]!.args).toEqual([
      "plugin",
      "opencode-agent-skills-md",
      "--global",
      "--force",
    ]);
  });

  test("passes through custom env to spawn function", async () => {
    const { spawnFn, calls } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    const customEnv = { ...process.env, OPENCODE_CONFIG_DIR: "/custom/path" };
    await spawnOpencodePlugin(["opencode-agent-skills-md"], { spawn: spawnFn, env: customEnv });
    expect(calls[0]!.env).toBe(customEnv);
  });

  test("defaults stdio to inherit when not specified", async () => {
    const { spawnFn, calls } = createFakeSpawn([{ status: 0, stdout: "", stderr: "" }]);
    await spawnOpencodePlugin(["opencode-agent-skills-md"], { spawn: spawnFn });
    expect(calls[0]!.stdio).toBe("inherit");
  });

  test("allows stdio override to pipe", async () => {
    const { spawnFn, calls } = createFakeSpawn([{ status: 0, stdout: "output", stderr: "" }]);
    await spawnOpencodePlugin(["opencode-agent-skills-md"], { spawn: spawnFn, stdio: "pipe" });
    expect(calls[0]!.stdio).toBe("pipe");
  });

  test("returns spawn result with status and output", async () => {
    const { spawnFn } = createFakeSpawn([{ status: 0, stdout: "Plugin registered", stderr: "" }]);
    const result = await spawnOpencodePlugin(["opencode-agent-skills-md"], { spawn: spawnFn, stdio: "pipe" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Plugin registered");
    expect(result.stderr).toBe("");
  });

  test("returns non-zero status on spawn failure", async () => {
    const { spawnFn } = createFakeSpawn([{ status: 1, stdout: "", stderr: "Plugin not found" }]);
    const result = await spawnOpencodePlugin(["opencode-agent-skills-md"], { spawn: spawnFn, stdio: "pipe" });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("Plugin not found");
  });

  test("handles multiple consecutive spawns", async () => {
    const { spawnFn, calls } = createFakeSpawn([
      { status: 0, stdout: "ok", stderr: "" },
      { status: 1, stdout: "", stderr: "error" },
    ]);
    await spawnOpencodePlugin(["opencode-agent-skills-md", "--global", "--force"], { spawn: spawnFn });
    await spawnOpencodePlugin(["opencode-agent-skills-md", "--global", "--force"], { spawn: spawnFn });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(["plugin", "opencode-agent-skills-md", "--global", "--force"]);
    expect(calls[1]!.args).toEqual(["plugin", "opencode-agent-skills-md", "--global", "--force"]);
  });

  test("returns null status when spawn throws", async () => {
    const throwSpawn: typeof spawnOpencodePlugin extends (args: infer A, opts?: infer O) => Promise<infer R> ? R : never = {
      status: null,
      stdout: "",
      stderr: "",
    };
    // When spawnFn throws, we need to handle it gracefully
    const errorSpawn = (_command: string, _args: string[], _options: { env: NodeJS.ProcessEnv; stdio: "pipe" | "inherit" }) => {
      throw new Error("spawn failed");
    };
    const result = await spawnOpencodePlugin(["opencode-agent-skills-md"], { spawn: errorSpawn as never, stdio: "pipe" });
    // The default implementation uses spawnSync which throws on error, returning null status
    expect(result.status ?? null).toBeNull();
  });
});
