// ---------------------------------------------------------------------------
// src/cli/registry.ts — npm registry freshness helpers for `oas`.
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import { type CliFs } from "./config";
import { createRealFs } from "./real-fs";

const PACKAGE_JSON_PATHS = [
  fileURLToPath(new URL("../../package.json", import.meta.url)),
  fileURLToPath(new URL("../../../../package.json", import.meta.url)),
];
const REGISTRY_LATEST_URL = "https://registry.npmjs.org/opencode-agent-skills-md/latest";

type SemverTuple = {
  major: number;
  minor: number;
  patch: number;
  preRelease: string[];
};

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string | URL,
  init?: { signal?: AbortSignal },
) => Promise<FetchLikeResponse>;

export type LatestVersionFetcher = (fetchImpl?: FetchLike, timeoutMs?: number) => Promise<string | null>;

const SEMVER_RE =
  /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const parseSemver = (raw: string): SemverTuple | null => {
  const match = raw.trim().match(SEMVER_RE);
  if (!match?.groups) return null;

  const major = Number.parseInt(match.groups.major ?? "", 10);
  const minor = Number.parseInt(match.groups.minor ?? "", 10);
  const patch = Number.parseInt(match.groups.patch ?? "", 10);
  if (![major, minor, patch].every(Number.isInteger)) return null;

  const preRelease = match.groups.pre ? match.groups.pre.split(".") : [];
  return { major, minor, patch, preRelease };
};

const compareIdentifiers = (left: string, right: string): number => {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    const diff = Number.parseInt(left, 10) - Number.parseInt(right, 10);
    return diff === 0 ? 0 : diff > 0 ? 1 : -1;
  }

  if (leftNumeric) return -1;
  if (rightNumeric) return 1;

  if (left === right) return 0;
  return left > right ? 1 : -1;
};

const comparePreRelease = (left: string[], right: string[]): number => {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const diff = compareIdentifiers(leftPart, rightPart);
    if (diff !== 0) return diff;
  }

  return 0;
};

/** Read the package's bundled version from `package.json`. */
export const getInstalledVersion = (
  fs: Pick<CliFs, "readFileSync"> = createRealFs(),
  packageJsonPath?: string,
): string | null => {
  const candidates = packageJsonPath ? [packageJsonPath] : PACKAGE_JSON_PATHS;

  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate);
      const parsed = JSON.parse(raw) as { version?: unknown };
      return typeof parsed.version === "string" && parsed.version.trim().length > 0
        ? parsed.version.trim()
        : null;
    } catch {
      // Try the next location. Source and built files live at different depths.
    }
  }

  return null;
};

/** Fetch the latest npm registry version for this package. */
export const fetchLatestVersion = async (
  fetchImpl: FetchLike | undefined = globalThis.fetch as FetchLike | undefined,
  timeoutMs = 3000,
): Promise<string | null> => {
  if (typeof fetchImpl !== "function") return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(REGISTRY_LATEST_URL, { signal: controller.signal });
    if (!response.ok || response.status < 200 || response.status >= 300) return null;

    const body = await response.json();
    if (typeof body !== "object" || body === null) return null;

    const version = (body as { version?: unknown }).version;
    return typeof version === "string" && version.trim().length > 0 ? version.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

/** Compare two semver strings. Returns `-1`, `0`, `1`, or `null` when parsing fails. */
export const compareSemver = (left: string, right: string): number | null => {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) return null;

  if (parsedLeft.major !== parsedRight.major) return parsedLeft.major > parsedRight.major ? 1 : -1;
  if (parsedLeft.minor !== parsedRight.minor) return parsedLeft.minor > parsedRight.minor ? 1 : -1;
  if (parsedLeft.patch !== parsedRight.patch) return parsedLeft.patch > parsedRight.patch ? 1 : -1;

  return comparePreRelease(parsedLeft.preRelease, parsedRight.preRelease);
};

/** Return `true` when `latest` is newer than `installed`, `false` when current, `null` on parse failure. */
export const isStale = (installed: string | null, latest: string | null): boolean | null => {
  if (!installed || !latest) return null;
  const compared = compareSemver(installed, latest);
  if (compared === null) return null;
  return compared < 0;
};
