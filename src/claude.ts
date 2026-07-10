/**
 * Claude plugin cache and marketplace discovery.
 *
 * Handles two new discovery roots:
 * - Plugin cache (~/.claude/plugins/cache/): v1 and v2 structures
 * - Marketplace (~/.claude/plugins/marketplaces/): via installed_plugins.json
 */
import { homedir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LabeledDiscoveryResult } from "./types";
import { walkDir } from "./utils";
import { debugLog } from "./utils";

const CLAUDE_PLUGINS_CACHE = path.join(homedir(), ".claude", "plugins", "cache");
const CLAUDE_PLUGINS_DIR = path.join(homedir(), ".claude", "plugins");
const CLAUDE_PLUGINS_MARKETPLACE = path.join(homedir(), ".claude", "plugins", "marketplaces");
const DEFAULT_MAX_DEPTH = 3;

/**
 * Discover skills in the Claude plugin cache directory.
 *
 * v1 structure: ~/.claude/plugins/cache/<plugin-name>/skills/<skill-name>/SKILL.md
 * v2 structure: ~/.claude/plugins/cache/marketplace/<plugin>/<version>/skills/<skill-name>/SKILL.md
 *
 * Gracefully returns [] when the cache directory does not exist or is unreadable.
 */
export const discoverPluginCacheSkills = async (): Promise<LabeledDiscoveryResult[]> => {
  const results: LabeledDiscoveryResult[] = [];

  try {
    await fs.access(CLAUDE_PLUGINS_CACHE);
  } catch {
    debugLog("discoverPluginCacheSkills: cache directory not accessible", CLAUDE_PLUGINS_CACHE);
    return [];
  }

  try {
    await walkDir(
      CLAUDE_PLUGINS_CACHE,
      DEFAULT_MAX_DEPTH,
      async (entry, depth) => {
        if (!entry.isDirectory()) return;
        if (entry.name !== "skills") return;

        // Entry is a "skills" dir — its parent is the plugin or skill root
        const skillsDir = path.join(entry.parentPath, entry.name);
        const relSkillsDir = path.relative(CLAUDE_PLUGINS_CACHE, skillsDir);

        // Check for SKILL.md directly in this skills dir
        const skillMdPath = path.join(skillsDir, "SKILL.md");
        try {
          await fs.stat(skillMdPath);
          results.push({
            filePath: skillMdPath,
            relativePath: path.join(relSkillsDir, "SKILL.md"),
            label: "claude-plugin-cache",
          });
        } catch {
          // Not a top-level SKILL.md, look for nested skill directories
        }

        // Scan subdirectories of "skills/" for <skill-name>/SKILL.md
        try {
          const subEntries = await fs.readdir(skillsDir, { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (!subEntry.isDirectory()) continue;
            if (subEntry.name.startsWith(".")) continue;

            const skillDir = path.join(skillsDir, subEntry.name);
            const skillMd = path.join(skillDir, "SKILL.md");
            try {
              await fs.stat(skillMd);
              results.push({
                filePath: skillMd,
                relativePath: path.join(relSkillsDir, subEntry.name, "SKILL.md"),
                label: "claude-plugin-cache",
              });
            } catch {
              // No SKILL.md in this subdirectory
            }
          }
        } catch {
          // Cannot read skills subdirectory
        }
      },
      { skipDirs: new Set(["node_modules", ".git"]) }
    );
  } catch (error) {
    debugLog("discoverPluginCacheSkills: error walking cache", error);
    return [];
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

interface InstalledPluginV1 {
  name: string;
  version?: string;
}

interface InstalledPluginV2 {
  plugin_id: string;
  installed_path?: string;
  version?: string;
}

interface InstalledPlugins {
  plugins?: InstalledPluginV1[];
  installed?: InstalledPluginV2[];
}

/**
 * Discover skills from installed marketplace plugins.
 *
 * Reads ~/.claude/plugins/installed_plugins.json to find installed plugins,
 * then scans each plugin's skills directory.
 *
 * v1 format: { plugins: [{ name: "plugin-name", version: "1.0.0" }] }
 * v2 format: { installed: [{ plugin_id: "org/plugin", installed_path: "/path/to/plugin", version: "1.0.0" }] }
 *
 * Gracefully returns [] when the marketplace directory or installed_plugins.json
 * does not exist or is unreadable.
 */
export const discoverMarketplaceSkills = async (): Promise<LabeledDiscoveryResult[]> => {
  const results: LabeledDiscoveryResult[] = [];

  let installedPlugins: InstalledPlugins = {};

  try {
    await fs.access(CLAUDE_PLUGINS_DIR);
  } catch {
    debugLog("discoverMarketplaceSkills: plugins directory not accessible", CLAUDE_PLUGINS_DIR);
    return [];
  }

  try {
    const installedPluginsPath = path.join(CLAUDE_PLUGINS_DIR, "installed_plugins.json");
    const content = await fs.readFile(installedPluginsPath, "utf-8");
    installedPlugins = JSON.parse(content) as InstalledPlugins;
  } catch (error) {
    debugLog("discoverMarketplaceSkills: could not read installed_plugins.json", error);
    return [];
  }

  const pluginPaths: string[] = [];

  // v1 format: plugins array with name field
  if (installedPlugins.plugins && Array.isArray(installedPlugins.plugins)) {
    for (const plugin of installedPlugins.plugins) {
      if (!plugin.name) continue;
      // v1: plugin directory is directly under marketplace
      const pluginPath = path.join(CLAUDE_PLUGINS_MARKETPLACE, plugin.name, "skills");
      pluginPaths.push(pluginPath);
    }
  }

  // v2 format: installed array with plugin_id and optional installed_path
  if (installedPlugins.installed && Array.isArray(installedPlugins.installed)) {
    for (const plugin of installedPlugins.installed) {
      if (!plugin.plugin_id) continue;

      if (plugin.installed_path) {
        // Use the explicit installed_path if available
        const skillsPath = path.join(plugin.installed_path, "skills");
        pluginPaths.push(skillsPath);
      } else {
        // Fall back to marketplace structure: marketplace/<plugin_id>/skills
        const normalizedId = plugin.plugin_id.replace("/", "__");
        const pluginPath = path.join(CLAUDE_PLUGINS_MARKETPLACE, normalizedId, "skills");
        pluginPaths.push(pluginPath);
      }
    }
  }

  for (const skillsBasePath of pluginPaths) {
    try {
      await fs.access(skillsBasePath);
    } catch {
      continue;
    }

    try {
      await walkDir(
        skillsBasePath,
        DEFAULT_MAX_DEPTH,
        async (entry, _depth) => {
          if (!entry.isDirectory()) return;
          if (entry.name.startsWith(".")) return;

          const skillDir = path.join(entry.parentPath, entry.name);
          const skillMd = path.join(skillDir, "SKILL.md");
          try {
            await fs.stat(skillMd);
            const relPath = path.relative(skillsBasePath, path.join(entry.name, "SKILL.md"));
            results.push({
              filePath: skillMd,
              relativePath: relPath,
              label: "claude-marketplace",
            });
          } catch {
            // No SKILL.md in this subdirectory
          }
        },
        { skipDirs: new Set(["node_modules", ".git"]) }
      );
    } catch (error) {
      debugLog("discoverMarketplaceSkills: error walking", skillsBasePath, error);
      continue;
    }
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};
