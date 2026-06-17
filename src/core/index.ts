/**
 * Public entrypoint for the portable skills core.
 *
 * Re-exports every type and function defined under `core/*` so consumers
 * (the host adapter in PR2, the test suite, and external harnesses) can
 * import everything from a single path:
 *
 *     import { discoverAllSkills, resolveSkill, type Skill } from "opencode-agent-skills/core";
 *
 * The core has zero runtime dependency on any host SDK. Host adapters
 * supply the `SkillHostClient` and `SkillHostSession` implementations.
 */

export type {
  DiscoveryPath,
  FileDiscoveryResult,
  LabeledDiscoveryResult,
  Script,
  Skill,
  SkillHostClient,
  SkillHostContext,
  SkillHostSession,
  SkillLabel,
  SkillSummary,
} from "./types";

export type { SkillFrontmatter } from "./parse";
export { SkillFrontmatterSchema, parseSkillFile, parseYamlFrontmatter } from "./parse";

export {
  defaultOnDuplicate,
  discoverAllSkills,
  findFile,
  findSkillsRecursive,
  getDefaultOpencodeRoots,
  getSkillSummaries,
  listSkillFiles,
  resolveSkill,
} from "./discovery";

export { findScripts, isPathSafe } from "./scripts";

export { findClosestMatch, levenshtein } from "./match";

export { formatSkillListing, renderAvailableSkillsBlock } from "./content";

export {
  escapeRegex,
  keywordMatch,
  scoreSkill,
  searchSkills,
  tokenize,
} from "./search";
