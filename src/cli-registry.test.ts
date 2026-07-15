import { describe, expect, test } from "bun:test";
import {
  compareSemver,
  fetchLatestVersion,
  getInstalledVersion,
  isStale,
} from "./cli/registry";
import type { RegistryFetch } from "./cli/registry";

// ---------------------------------------------------------------------------
// compareSemver
// ---------------------------------------------------------------------------

test("compareSemver returns -1 when a < b", () => {
  expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
  expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
  expect(compareSemver("1.0.0", "1.1.0")).toBe(-1);
});

test("compareSemver returns 1 when a > b", () => {
  expect(compareSemver("2.0.0", "1.0.0")).toBe(1);
  expect(compareSemver("1.0.1", "1.0.0")).toBe(1);
  expect(compareSemver("1.1.0", "1.0.0")).toBe(1);
});

test("compareSemver returns 0 when equal", () => {
  expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
});

test("compareSemver pads missing trailing segments as 0", () => {
  expect(compareSemver("1.0", "1.0.0")).toBe(0);
  expect(compareSemver("1", "1.0.0")).toBe(0);
});

test("compareSemver strips prerelease suffix", () => {
  expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(0);
  expect(compareSemver("1.0.0-beta", "1.0.0")).toBe(0);
});

test("compareSemver fails closed on null/undefined/empty", () => {
  expect(compareSemver(null, "1.0.0")).toBe(0);
  expect(compareSemver(undefined, "1.0.0")).toBe(0);
  expect(compareSemver("", "1.0.0")).toBe(0);
  expect(compareSemver("1.0.0", null)).toBe(0);
  expect(compareSemver("1.0.0", undefined)).toBe(0);
  expect(compareSemver("1.0.0", "")).toBe(0);
});

test("compareSemver fails closed on unparseable input", () => {
  expect(compareSemver("not-a-version", "1.0.0")).toBe(0);
  expect(compareSemver("1.0.0", "not-a-version")).toBe(0);
  expect(compareSemver("1.0.a", "1.0.0")).toBe(0);
});

// ---------------------------------------------------------------------------
// isStale
// ---------------------------------------------------------------------------

test("isStale returns true when installed < latest", () => {
  expect(isStale("1.0.0", "2.0.0")).toBe(true);
});

test("isStale returns false when installed >= latest", () => {
  expect(isStale("2.0.0", "1.0.0")).toBe(false);
  expect(isStale("1.0.0", "1.0.0")).toBe(false);
});

test("isStale returns false on null/undefined inputs", () => {
  expect(isStale(null, "1.0.0")).toBe(false);
  expect(isStale(undefined, "1.0.0")).toBe(false);
  expect(isStale("1.0.0", null)).toBe(false);
  expect(isStale("1.0.0", undefined)).toBe(false);
  expect(isStale(null, null)).toBe(false);
});

test("isStale returns false on unparseable inputs", () => {
  expect(isStale("not-a-version", "1.0.0")).toBe(false);
  expect(isStale("1.0.0", "not-a-version")).toBe(false);
});

// ---------------------------------------------------------------------------
// getInstalledVersion
// ---------------------------------------------------------------------------

test("getInstalledVersion returns version from package.json", () => {
  const mockFs = {
    existsSync: (p: string) => p.endsWith("package.json"),
    readFileSync: (p: string) => {
      if (p.endsWith("package.json")) return JSON.stringify({ version: "1.2.3" });
      throw new Error("ENOENT");
    },
  };
  const result = getInstalledVersion(mockFs, "/fake/root");
  expect(result).toBe("1.2.3");
});

test("getInstalledVersion returns null when package.json missing", () => {
  const mockFs = {
    existsSync: (_p: string) => false,
    readFileSync: () => { throw new Error("ENOENT"); },
  };
  const result = getInstalledVersion(mockFs, "/fake/root");
  expect(result).toBeNull();
});

test("getInstalledVersion returns null on malformed JSON", () => {
  const mockFs = {
    existsSync: (_p: string) => true,
    readFileSync: () => "not json",
  };
  const result = getInstalledVersion(mockFs, "/fake/root");
  expect(result).toBeNull();
});

test("getInstalledVersion returns null when version field missing", () => {
  const mockFs = {
    existsSync: (_p: string) => true,
    readFileSync: () => JSON.stringify({ name: "pkg" }),
  };
  const result = getInstalledVersion(mockFs, "/fake/root");
  expect(result).toBeNull();
});

test("getInstalledVersion returns null when version is not a string", () => {
  const mockFs = {
    existsSync: (_p: string) => true,
    readFileSync: () => JSON.stringify({ version: 42 }),
  };
  const result = getInstalledVersion(mockFs, "/fake/root");
  expect(result).toBeNull();
});

test("getInstalledVersion returns null when version is empty string", () => {
  const mockFs = {
    existsSync: (_p: string) => true,
    readFileSync: () => JSON.stringify({ version: "" }),
  };
  const result = getInstalledVersion(mockFs, "/fake/root");
  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// fetchLatestVersion
// ---------------------------------------------------------------------------

const mockFetchFactory = (response: unknown, ok = true) => {
  const mockResponse = {
    ok,
    json: async () => response,
  };
  return async () => mockResponse as unknown as Response;
};

test("fetchLatestVersion returns version string on valid response", async () => {
  const mockFetch = mockFetchFactory({ version: "3.0.0" }, true);
  const result = await fetchLatestVersion(mockFetch as RegistryFetch, 3000);
  expect(result).toBe("3.0.0");
});

test("fetchLatestVersion returns null on HTTP error", async () => {
  const mockFetch = mockFetchFactory({ version: "3.0.0" }, false);
  const result = await fetchLatestVersion(mockFetch as RegistryFetch, 3000);
  expect(result).toBeNull();
});

test("fetchLatestVersion returns null on malformed JSON body", async () => {
  const mockFetch = async () =>
    ({ ok: true, json: async () => { throw new Error("parse error"); } }) as unknown as Response;
  const result = await fetchLatestVersion(mockFetch as RegistryFetch, 3000);
  expect(result).toBeNull();
});

test("fetchLatestVersion returns null when version missing from response", async () => {
  const mockFetch = mockFetchFactory({ name: "pkg" }, true);
  const result = await fetchLatestVersion(mockFetch as RegistryFetch, 3000);
  expect(result).toBeNull();
});

test("fetchLatestVersion returns null when version is not a string", async () => {
  const mockFetch = mockFetchFactory({ version: 42 }, true);
  const result = await fetchLatestVersion(mockFetch as RegistryFetch, 3000);
  expect(result).toBeNull();
});

test("fetchLatestVersion returns null when version is empty string", async () => {
  const mockFetch = mockFetchFactory({ version: "" }, true);
  const result = await fetchLatestVersion(mockFetch as RegistryFetch, 3000);
  expect(result).toBeNull();
});

test("fetchLatestVersion returns null on network error", async () => {
  const mockFetch = async () => { throw new Error("network unreachable"); };
  const result = await fetchLatestVersion(mockFetch as RegistryFetch, 3000);
  expect(result).toBeNull();
});

test("fetchLatestVersion uses AbortSignal.timeout", async () => {
  let timedOut = false;
  const mockFetch = async (_url: string, opts?: { signal?: AbortSignal }) => {
    // Verify timeout signal was passed
    if (opts?.signal) {
      try {
        await new Promise((_, reject) => {
          opts.signal!.addEventListener("abort", () => reject(new Error("timeout")));
          // Fire after a tick to simulate timeout
          setTimeout(() => reject(new Error("timeout")), 0);
        });
      } catch (e: unknown) {
        if ((e as Error).message === "timeout") timedOut = true;
      }
    }
    throw new Error("timeout");
  };
  await fetchLatestVersion(mockFetch as RegistryFetch, 1);
  expect(timedOut).toBe(true);
});
