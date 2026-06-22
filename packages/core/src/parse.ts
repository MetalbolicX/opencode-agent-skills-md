/**
 * YAML frontmatter parsing and skill frontmatter validation.
 *
 * Pure functions: no I/O, no host dependencies. The script-discovery step
 * that follows parsing is delegated to `core/scripts.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";
import type { Skill, SkillLabel } from "./types";
import { debugLog } from "./debug";
import { findScripts } from "./scripts";

/**
 * Parse YAML frontmatter using the yaml library with safe options.
 * Uses strict schema to prevent code execution from malicious YAML.
 * Handles all YAML 1.2 features including multi-line strings (| and >).
 *
 * Two distinct failure modes:
 *   - Empty frontmatter (blank / whitespace-only input) returns `{}`
 *     without touching the parser. This is a valid zero-field case.
 *   - Malformed YAML (real syntax error) is caught and logged via the
 *     `debugLog` helper; the function still returns `{}` so callers see
 *     the same graceful fallback as before.
 */
export function parseYamlFrontmatter(text: string): Record<string, unknown> {
  if (text.trim().length === 0) return {};
  try {
    const result = YAML.parse(text, {
      schema: "core",
      maxAliasCount: 100,
    });
    return typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : {};
  } catch (error) {
    debugLog("parseYamlFrontmatter: malformed YAML", error);
    return {};
  }
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  trigger?: string;
  license?: string;
  "allowed-tools"?: string[];
  metadata?: Record<string, unknown>;
}

const NAME_REGEX = /^[\p{Ll}\p{N}-]+$/u;

function validateFrontmatter(obj: unknown): SkillFrontmatter | null {
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.name !== "string" || !NAME_REGEX.test(o.name) || o.name.length === 0) return null;
  if (typeof o.description !== "string" || o.description.length === 0) return null;
  if (o.trigger !== undefined && typeof o.trigger !== "string") return null;
  if (o.license !== undefined && typeof o.license !== "string") return null;
  if (o["allowed-tools"] !== undefined && !Array.isArray(o["allowed-tools"])) return null;
  if (o.metadata !== undefined && typeof o.metadata !== "object") return null;

  // Build SkillFrontmatter from validated fields. Avoids the previous
  // `as unknown as SkillFrontmatter` double cast so the resulting object
  // is structurally a SkillFrontmatter at every optional key.
  const frontmatter: SkillFrontmatter = {
    name: o.name,
    description: o.description,
  };
  if (o.trigger !== undefined) frontmatter.trigger = o.trigger;
  if (o.license !== undefined) frontmatter.license = o.license;
  if (o["allowed-tools"] !== undefined) {
    frontmatter["allowed-tools"] = o["allowed-tools"] as string[];
  }
  if (o.metadata !== undefined) {
    frontmatter.metadata = o.metadata as Record<string, unknown>;
  }
  return frontmatter;
}

/**
 * Parse a SKILL.md file and validate its frontmatter.
 * Returns null if parsing fails (with error logging).
 */
export async function parseSkillFile(
  skillPath: string,
  relativePath: string,
  label: SkillLabel
): Promise<Skill | null> {
  const content = await fs.readFile(skillPath, 'utf-8').catch(() => null);
  if (!content) {
    return null;
  }

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch?.[1] || !frontmatterMatch[2]) {
    return null;
  }

  const frontmatterText = frontmatterMatch[1];
  const skillContent = frontmatterMatch[2].trim();

  let frontmatterObj: unknown;
  try {
    frontmatterObj = parseYamlFrontmatter(frontmatterText);
  } catch {
    return null;
  }

  const frontmatter = validateFrontmatter(frontmatterObj);
  if (!frontmatter) {
    return null;
  }

  const skillDirPath = path.dirname(skillPath);
  const scripts = await findScripts(skillDirPath);

  const rawNamespace = frontmatter.metadata?.namespace;
  const namespace =
    typeof rawNamespace === "string" ? rawNamespace : undefined;

  const rawTags = frontmatter.metadata?.tags;
  const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === "string") : [];

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    trigger: frontmatter.trigger,
    path: skillDirPath,
    relativePath,
    namespace,
    tags,
    label,
    scripts,
    template: skillContent
  };
}
