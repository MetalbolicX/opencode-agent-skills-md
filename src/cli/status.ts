// ---------------------------------------------------------------------------
// src/cli/status.ts — `oaskills status` and `oaskills doctor` commands.
//
// `status` reports whether the plugin is installed and at what version in
// the global OpenCode config — a read-only, idempotent probe suitable for
// scripting.
//
// `doctor` runs a battery of health checks: Node version, Bun availability,
// config readability, discovery-root existence, and package freshness.
// Issues are grouped by severity; the exit code maps to `ok === false`.
//
// `doctor`'s writability probe touches the real filesystem directly via
// `node:fs` because `CliFs` deliberately does not expose access checks.
// ---------------------------------------------------------------------------

import { accessSync, constants as fsConstants, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import {
  type CliFs,
  loadGlobalConfig,
  matchesPlugin,
  normalizePlugin,
  resolveConfigDir,
} from "./config";
import { createRealFs } from "./real-fs";
import { fetchLatestVersion, getInstalledVersion, isStale } from "./registry";

// ---------------------------------------------------------------------------
// Discovery root paths (the 4 places opencode looks for skills)
// ---------------------------------------------------------------------------

const DISCOVERY_ROOTS = [
  ".opencode/skills/",
  ".claude/skills/",
  "~/.config/opencode/skills/",
  "~/.claude/skills/",
];

const resolveDiscoveryRoot = (root: string, cwd: string): string => {
  if (root.startsWith("~/")) {
    const home = process.env.HOME ?? "";
    return home + root.slice(1);
  }
  if (root.startsWith(".")) {
    return cwd + "/" + root;
  }
  return root;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusResult {
  installed: boolean;
  path: string;
  format: "json" | "jsonc";
  specifier: string | null;
  extras: string[];
  installedVersion?: string | null;
  latestVersion?: string | null;
}

export interface DoctorResult {
  ok: boolean;
  issues: string[];
  warnings: string[];
  info: string[];
  installedVersion?: string | null;
  latestVersion?: string | null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const formatFromPath = (path: string): "json" | "jsonc" =>
  path.endsWith(".jsonc") ? "jsonc" : "json";

/**
 * Read-only status probe. Prints a human-readable report to stdout and
 * returns the same data as a structured result for callers and tests.
 */
export const runStatus = async (
  fs: CliFs = createRealFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<StatusResult> => {
  const loaded = loadGlobalConfig(fs, env);
  const plugins = normalizePlugin(loaded.config.plugin);
  const pluginEntries = plugins.filter(matchesPlugin);
  const extras = plugins.filter((entry) => !matchesPlugin(entry));
  const format = formatFromPath(loaded.path);

  console.log(`Config path:    ${loaded.path}`);
  console.log(`Format:         ${format}`);
  console.log(`Exists on disk: ${loaded.existed ? "yes" : "no (will be created on install)"}`);

  // Env var reporting
  const superpowers = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE;
  const preference = process.env.OPENCODE_AGENT_SKILLS_PREFERENCE_MODE;
  const debug = process.env.OPENCODE_AGENT_SKILLS_DEBUG;
  console.log(`SUPERPOWERS_MODE: ${superpowers ?? "not set"}`);
  console.log(`PREFERENCE_MODE:  ${preference ?? "not set"}`);
  console.log(`DEBUG:             ${debug ?? "not set"}`);

  // Probe both version sources in parallel.
  const [installedVersion, latestVersion] = await Promise.all([
    Promise.resolve(getInstalledVersion(fs)),
    fetchLatestVersion(),
  ]);

  if (pluginEntries.length === 0) {
    console.log(`Installed:      no`);
    return {
      installed: false,
      path: loaded.path,
      format,
      specifier: null,
      extras,
      installedVersion,
      latestVersion,
    };
  }

  const specifier = pluginEntries[0] ?? null;
  console.log(`Installed:      yes`);
  console.log(`Specifier:      ${specifier}`);
  if (extras.length > 0) {
    console.log(`Other plugins:  ${extras.join(", ")}`);
  }

  if (installedVersion != null && latestVersion != null) {
    console.log(`Installed version: ${installedVersion}`);
    console.log(`Latest:            ${latestVersion}`);
  }

  return {
    installed: true,
    path: loaded.path,
    format,
    specifier,
    extras,
    installedVersion,
    latestVersion,
  };
};

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

/**
 * Health checks. Returns `DoctorResult`; `main.ts` maps `ok === false` to exit code 1.
 *
 * Checks:
 *  1. Node >= 20
 *  2. Bun availability (check PATH for `bun` executable)
 *  3. Config readability + format
 *  4. `plugin` shape validity
 *  5. Discovery-root existence (at least one of 4 must exist — warning, not blocking)
 *  6. Package freshness
 */
export const runDoctor = async (
  fs: CliFs = createRealFs(),
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<DoctorResult> => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  // 1. Node major version — `engines.node >= 20`.
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    issues.push(`Node ${process.versions.node} detected — opencode-agent-skills-md requires Node >= 20`);
  } else {
    info.push(`Node ${process.versions.node} OK`);
  }

  // 2. Bun availability — check if `bun` is on PATH.
  const bunOnPath = existsSync("/usr/local/bin/bun") ||
    existsSync("/usr/bin/bun") ||
    (env.PATH?.split(":").some((dir) => existsSync(dir + "/bun")) ?? false);
  if (bunOnPath) {
    info.push(`Bun: available on PATH`);
  } else {
    // Bun is only needed at build time, but we warn if it's missing
    warnings.push(`Bun not found on PATH — required for building the plugin from source`);
  }

  // 3. Config file readability + format detection.
  const loaded = loadGlobalConfig(fs, env);
  const format = formatFromPath(loaded.path);
  info.push(`Config path: ${loaded.path}`);
  info.push(`Config format: ${format}`);
  if (!loaded.existed) {
    warnings.push(`Config file does not exist yet — install will create it`);
  }

  // 4. `plugin` shape — must be array, object (legacy), or absent.
  const rawPlugin = loaded.config.plugin;
  if (rawPlugin === undefined || rawPlugin === null) {
    info.push(`Plugin entries: 0`);
  } else {
    const validShape = Array.isArray(rawPlugin) || typeof rawPlugin === "object";
    if (!validShape) {
      issues.push(`config.plugin is neither array nor object — install will reset it`);
    } else {
      const plugins = normalizePlugin(rawPlugin);
      info.push(`Plugin entries: ${plugins.length}`);
      const pluginCount = plugins.filter(matchesPlugin).length;
      if (pluginCount > 1) {
        warnings.push(`${pluginCount} opencode-agent-skills-md entries present — install will dedupe`);
      }
    }
  }

  // 5. Discovery-root existence — warn if zero of the 4 roots exist.
  const resolvedRoots = DISCOVERY_ROOTS.map((r) => resolveDiscoveryRoot(r, cwd));
  const existingRoots = resolvedRoots.filter((r) => fs.existsSync(r));
  if (existingRoots.length === 0) {
    warnings.push(
      `No skill-discovery roots found — opencode will not load skills. ` +
        `Checked: ${DISCOVERY_ROOTS.join(", ")}`,
    );
  } else {
    info.push(`Discovery roots: ${existingRoots.length}/4 found (${existingRoots.join(", ")})`);
  }

  // 6. Config directory writability.
  try {
    const dir = dirname(loaded.path);
    try {
      const stat = statSync(dir);
      if (stat.isDirectory()) {
        try {
          accessSync(dir, fsConstants.W_OK);
          info.push(`Config directory writable: ${dir}`);
        } catch {
          warnings.push(`Config directory ${dir} is not writable`);
        }
      } else {
        issues.push(`${dir} exists but is not a directory`);
      }
    } catch {
      warnings.push(
        `Config directory ${dir} does not exist yet — will be created on first install`,
      );
    }
  } catch {
    // best-effort — never block on permission probes
  }

  // 7. Package freshness — probe both version sources in parallel.
  const [installedVersion, latestVersion] = await Promise.all([
    Promise.resolve(getInstalledVersion(fs)),
    fetchLatestVersion(),
  ]);

  if (isStale(installedVersion, latestVersion)) {
    warnings.push(
      `opencode-agent-skills-md ${installedVersion ?? "(unknown)"} is stale — ` +
        `run: npx opencode-agent-skills-md@latest install`,
    );
  }

  // Render the report.
  for (const line of info) console.log(`  ✓ ${line}`);
  for (const line of warnings) console.warn(`  ! ${line}`);
  for (const line of issues) console.error(`  ✗ ${line}`);

  const ok = issues.length === 0;
  if (ok) {
    console.log(`\n✓ Doctor: all checks passed`);
  } else {
    console.log(`\n✗ Doctor: ${issues.length} issue(s) found`);
  }

  return { ok, issues, warnings, info, installedVersion, latestVersion };
};
