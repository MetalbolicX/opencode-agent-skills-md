/**
 * YAML frontmatter parsing and skill frontmatter validation.
 *
 * Mirrors packages/core/src/parse.ts behaviour.
 * Pure functions: no I/O beyond the file reads owned by callers.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Skill, SkillLabel } from "./types";
import { debugLog } from "./utils";
import { findScripts } from "./scripts";

export interface SkillFrontmatter {
  name: string;
  description: string;
  trigger?: string;
  license?: string;
  "allowed-tools"?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Parse YAML frontmatter text into a plain object.
 * Handles:
 *   - JSON structure: `{name: "value", ...}`
 *   - Simple YAML: `key: value` pairs, quoted strings, inline arrays
 *   - Block-style nested objects (metadata:\n  namespace: ns)
 *   - Unquoted scalar values become numbers when numeric, strings otherwise
 *   - validateFrontmatter type guards catch wrong types (non-string names, etc.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseYamlFrontmatter(text: string): Record<string, unknown> {
  if (text.trim().length === 0) return {};
  try {
    // Try strict JSON first (quoted keys and string values)
    const result = JSON.parse(`{${text}}`);
    return typeof result === "object" && result !== null ? result : {};
  } catch {
    return manualParse(text);
  }
}

function manualParse(text: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const lines = text.split('\n');

  // Track pending nested-object key and its following indented lines
  let pendingNestedKey: string | null = null;
  const nestedBuffer: string[] = [];

  const flushNested = (): void => {
    if (pendingNestedKey === null) return;
    const nested = parseYamlFrontmatter(nestedBuffer.join('\n'));
    obj[pendingNestedKey] = nested;
    pendingNestedKey = null;
    nestedBuffer.length = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    // Comment line
    if (trimmed.startsWith('#')) continue;

    // Indented line — belongs to pending nested object
    if ((line.startsWith(' ') || line.startsWith('\t')) && pendingNestedKey !== null) {
      nestedBuffer.push(trimmed);
      continue;
    }

    // Non-indented line — flush any pending nested first
    flushNested();

    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (!key) continue;

    // Empty value
    if (rawValue === '' || rawValue === '~') {
      obj[key] = undefined;
      continue;
    }

    // Quoted string values: "..." or '...'
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      obj[key] = rawValue.slice(1, -1);
      continue;
    }

    // Inline array: [item1, item2, ...]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      obj[key] = inner === '' ? [] : parseArrayItems(inner);
      continue;
    }

    // Nested object starts (inline { ... } or block-style indented)
    if (rawValue === '' || (rawValue.startsWith('{') && rawValue.endsWith('}'))) {
      if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
        // Inline nested object: {namespace: ns, tags: [a, b]}
        const inner = rawValue.slice(1, -1).trim();
        obj[key] = parseInlineObject(inner);
      } else {
        // Block-style: the next indented lines form the nested object
        pendingNestedKey = key;
        nestedBuffer.length = 0;
      }
      continue;
    }

    // Unquoted scalar — numeric when purely digits/decimal, else string
    obj[key] = parseScalar(rawValue);
  }

  // Flush any remaining pending nested
  flushNested();
  return obj;
}

function parseArrayItems(inner: string): Array<unknown> {
  const items: Array<unknown> = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';

  for (const ch of inner) {
    if ((ch === '"' || ch === "'") && (current.length === 0 || current[current.length - 1] !== '\\')) {
      if (!inQuote) { inQuote = true; quoteChar = ch; }
      else if (ch === quoteChar) { inQuote = false; quoteChar = ''; }
    }
    if (!inQuote && ch === '[') depth++;
    if (!inQuote && ch === ']') depth--;
    if (!inQuote && depth === 0 && ch === ',') {
      const t = current.trim();
      if (t) items.push(parseScalar(t));
      current = '';
    } else {
      current += ch;
    }
  }
  const t = current.trim();
  if (t) items.push(parseScalar(t));
  return items;
}

function parseInlineObject(inner: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let current = '';
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';

  for (const ch of inner) {
    if ((ch === '"' || ch === "'") && (current.length === 0 || current[current.length - 1] !== '\\')) {
      if (!inQuote) { inQuote = true; quoteChar = ch; }
      else if (ch === quoteChar) { inQuote = false; quoteChar = ''; }
    }
    if (!inQuote && (ch === '[' || ch === '{')) depth++;
    if (!inQuote && (ch === ']' || ch === '}')) depth--;
    if (!inQuote && depth === 0 && ch === ',') {
      const colonIdx2 = current.indexOf(':');
      if (colonIdx2 > 0) {
        const k = current.slice(0, colonIdx2).trim();
        const v = current.slice(colonIdx2 + 1).trim();
        result[k] = parseScalar(v);
      }
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    const colonIdx2 = current.indexOf(':');
    if (colonIdx2 > 0) {
      const k = current.slice(0, colonIdx2).trim();
      const v = current.slice(colonIdx2 + 1).trim();
      result[k] = parseScalar(v);
    }
  }
  return result;
}

function parseScalar(value: string): unknown {
  const t = value.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    return parseArrayItems(t.slice(1, -1).trim());
  }
  const num = Number(t);
  if (!isNaN(num) && t !== '' && /^-?\d+(\.\d+)?$/.test(t)) {
    return num;
  }
  return t;
}

// Kebab-case: lowercase letters, digits, and hyphens only — no uppercase
const NAME_REGEX = /^[a-z0-9][\w-]*$/;

const validateFrontmatter = (obj: unknown): SkillFrontmatter | null => {
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.name !== "string" || !NAME_REGEX.test(o.name) || o.name.length === 0) return null;
  if (typeof o.description !== "string" || o.description.length === 0) return null;
  if (o.trigger !== undefined && typeof o.trigger !== "string") return null;
  if (o.license !== undefined && typeof o.license !== "string") return null;
  if (o["allowed-tools"] !== undefined && !Array.isArray(o["allowed-tools"])) return null;
  if (o.metadata !== undefined && typeof o.metadata !== "object") return null;

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
};

export const parseSkillFile = async (
  skillPath: string,
  relativePath: string,
  label: SkillLabel
): Promise<Skill | null> => {
  const content = await fs.readFile(skillPath, 'utf-8').catch((error) => {
    debugLog("parseSkillFile: cannot read", skillPath, error);
    return null;
  });
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
};
