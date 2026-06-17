/**
 * YAML frontmatter parsing and skill frontmatter validation.
 *
 * Pure functions: no I/O, no host dependencies. The script-discovery step
 * that follows parsing is delegated to `core/scripts.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { Skill, SkillLabel } from "./types";
import { findScripts } from "./scripts";

/**
 * Parse YAML frontmatter using the yaml library with safe options.
 * Uses strict schema to prevent code execution from malicious YAML.
 * Handles all YAML 1.2 features including multi-line strings (| and >).
 */
export function parseYamlFrontmatter(text: string): Record<string, unknown> {
  try {
    const result = YAML.parse(text, {
      // Use core schema which only supports basic JSON-compatible types
      // This prevents custom tags that could execute code
      schema: "core",
      // Limit recursion depth to prevent DoS attacks
      maxAliasCount: 100,
    });
    return typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Anthropic Agent Skills Spec v1.0 compliant schema.
 * @see https://github.com/anthropics/skills/blob/main/agent_skills_spec.md
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string()
    .regex(/^[\p{Ll}\p{N}-]+$/u, { message: "Name must be lowercase alphanumeric with hyphens" })
    .min(1, { message: "Name cannot be empty" }),
  description: z.string()
    .min(1, { message: "Description cannot be empty" }),
  trigger: z.string().optional(),
  license: z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  metadata: z
    .object({
      tags: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

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

  let frontmatter: SkillFrontmatter;
  try {
    frontmatter = SkillFrontmatterSchema.parse(frontmatterObj);
  } catch (error) {
    return null;
  }

  const skillDirPath = path.dirname(skillPath);
  const scripts = await findScripts(skillDirPath);

  // `metadata.namespace` is a passthrough key, so its static type is
  // `unknown`. We only surface it when it is actually a string, which
  // matches the behaviour of the previous record(string,string) schema.
  const rawNamespace = frontmatter.metadata?.namespace;
  const namespace =
    typeof rawNamespace === "string" ? rawNamespace : undefined;

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    trigger: frontmatter.trigger,
    path: skillDirPath,
    relativePath,
    namespace,
    tags: frontmatter.metadata?.tags ?? [],
    label,
    scripts,
    template: skillContent
  };
}
