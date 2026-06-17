import assert from "node:assert/strict";
import { homedir } from "node:os";
import * as path from "node:path";
import { describe, test } from "node:test";

/**
 * PR 3 of `trigger-aware-skill-discovery` — External Skill Normalization.
 *
 * The 21 SKILL.md files under `~/.claude/skills/` MUST match the canonical
 * frontmatter shape defined in `sdd/trigger-aware-skill-discovery/spec`:
 *   - `name` matches `/^[\p{Ll}\p{N}-]+$/u` (lowercase alnum + hyphens)
 *   - file begins with `^---\n` on line 1 (no leading blank line)
 *   - `description` is non-empty
 *   - existing `trigger` text is preserved
 *
 * Before PR 3:
 *   - `docsify-docs-editor` had an invalid uppercase name → dropped silently
 *   - `good-comments` started with a blank line → dropped silently
 *   - the other 19 were discoverable but missing `license` / `metadata`
 *
 * This test is the safety net for the normalization pass. It loads the
 * real `~/.claude/skills/` directory (override with
 * `OPENCODE_AGENT_SKILLS_TEST_CLAUDE_USER` to point at a fixture copy)
 * and asserts every skill is discoverable AND its trigger text is preserved.
 *
 * The expected count is 21 because that is the inventory the spec says
 * must be normalized. If the count changes, the test forces a review of
 * the canonical-skill list.
 */
const CLAUDE_USER_SKILLS_DIR = process.env.OPENCODE_AGENT_SKILLS_TEST_CLAUDE_USER
  ?? path.join(homedir(), ".claude", "skills");

const EXPECTED_SKILL_COUNT = 21;
const NAME_REGEX = /^[\p{Ll}\p{N}-]+$/u;

/**
 * Expected `trigger` text per skill, captured from the frontmatter before
 * normalization. The values are the string the parser sees after YAML
 * unescaping (so single-quoted YAML strings come back without their quotes).
 * The blockers (`docsify-docs-editor`, `good-comments`) DID have triggers
 * even before the fix — they were just invisible to discovery.
 */
const EXPECTED_TRIGGERS: Record<string, string> = {
  "ast-grep": "ast-grep, structural search, AST pattern, find code pattern, refactor with AST, code search",
  "code-review": "User requests a code review via phrases such as 'review this code', 'check my PR', 'look over this function', or 'give me feedback on this implementation'.",
  "conceptual-grill": "User mentions \"grill me with no codebase\", \"stress-test this concept\", or requests architectural validation without providing code context.",
  "diagnose": "User says \"diagnose this\", \"debug this\", reports a bug, says something is broken/throwing/failing, or describes a performance regression.",
  "doc-comments": "Activated explicitly by requests for documentation or type hints, or proactively when provided code lacks metadata, uses weak typing ('any'), or features complex, undocumented logic.",
  "docsify-docs-editor": "Activation occurs when a user initiates a documentation audit, scaffolding request, or precise edit targeting Docsify markdown files (README, setup, api-reference, architecture, quick-reference, tutorials).",
  "element-reference": "User writes @<file>::<element> patterns for precise code references",
  "good-comments": "Triggered when a user provides source code and requests documentation, comment improvement, or explanation of business logic, edge cases, and architectural decisions.",
  "grill-me": "Activated when the user explicitly requests 'grill me', asks for a rigorous design review, or needs help resolving complex architectural decision trees.",
  "handoff": "The user requests to pause, switch tasks, pass work to another agent, or explicitly asks for a handoff.",
  "mermaid-diagram-generator": "Activated when a user explicitly requests a diagram, chart, graph, or visual representation of processes, data, or system structures.",
  "opencode-choice": "User asks 'should I use a command, skill, or agent', 'when to use command vs agent vs skill', or is unsure which OpenCode extension fits their need.",
  "production-readiness-review": "User requests a \"production readiness review\" or asks if the codebase is \"production-ready\".",
  "readme-refactor": "User requests to update, refactor, rewrite, or polish a README file.",
  "refactor-skill": "User provides a raw prompt, workflow, or unstructured instructions and requests a modular, production-ready skill format.",
  "rename-refactoring": "Activates upon explicit user request to clean up variable names, or automatically as a self-correction step when detecting ambiguous or contextually mismatched identifiers (e.g., 'data', 'temp', 'obj').",
  "review": "review a branch, PR, work-in-progress changes, or \"review since X\"",
  "ubiquitous-language": "User wants to define domain terms, build a glossary, harden terminology, create a ubiquitous language, or mentions \"domain model\" or \"DDD\".",
  "write-a-skill": "User wants to create, write, or build a new agent skill.",
};

describe("External skill normalization (PR 3)", () => {
  test(`discovers exactly ${EXPECTED_SKILL_COUNT} skills under the user-level Claude skills directory`, async () => {
    const { discoverAllSkills } = await import("../../src/core");
    const skills = await discoverAllSkills("/tmp", [
      { path: CLAUDE_USER_SKILLS_DIR, label: "claude-user", maxDepth: 3 },
    ]);
    assert.equal(
      skills.size,
      EXPECTED_SKILL_COUNT,
      `expected ${EXPECTED_SKILL_COUNT} discoverable skills, got ${skills.size}. ` +
      `Missing: ${Array.from({ length: EXPECTED_SKILL_COUNT }, (_, i) => `?`).join(",")}. ` +
      `Found: ${Array.from(skills.keys()).join(", ")}`,
    );
  });

  test("every discovered skill has a name matching the lowercase kebab-case regex", async () => {
    const { discoverAllSkills } = await import("../../src/core");
    const skills = await discoverAllSkills("/tmp", [
      { path: CLAUDE_USER_SKILLS_DIR, label: "claude-user", maxDepth: 3 },
    ]);
    for (const [name, skill] of skills) {
      assert.match(
        name,
        NAME_REGEX,
        `skill name "${name}" must match ${NAME_REGEX} (skill at ${skill.path})`,
      );
      assert.equal(skill.name, name, `Map key and skill.name must agree for ${name}`);
    }
  });

  test("every discovered skill has a non-empty description", async () => {
    const { discoverAllSkills } = await import("../../src/core");
    const skills = await discoverAllSkills("/tmp", [
      { path: CLAUDE_USER_SKILLS_DIR, label: "claude-user", maxDepth: 3 },
    ]);
    for (const [name, skill] of skills) {
      assert.ok(
        typeof skill.description === "string" && skill.description.length > 0,
        `${name} must have a non-empty description`,
      );
    }
  });

  test("docsify-docs-editor is discoverable (was invisible due to uppercase name)", async () => {
    const { discoverAllSkills } = await import("../../src/core");
    const skills = await discoverAllSkills("/tmp", [
      { path: CLAUDE_USER_SKILLS_DIR, label: "claude-user", maxDepth: 3 },
    ]);
    assert.ok(
      skills.has("docsify-docs-editor"),
      "docsify-docs-editor should be discoverable after the name normalization",
    );
  });

  test("good-comments is discoverable (was invisible due to leading blank line)", async () => {
    const { discoverAllSkills } = await import("../../src/core");
    const skills = await discoverAllSkills("/tmp", [
      { path: CLAUDE_USER_SKILLS_DIR, label: "claude-user", maxDepth: 3 },
    ]);
    assert.ok(
      skills.has("good-comments"),
      "good-comments should be discoverable after removing the leading blank line",
    );
  });

  test("every skill that previously had a trigger still has the same trigger after normalization", async () => {
    const { discoverAllSkills } = await import("../../src/core");
    const skills = await discoverAllSkills("/tmp", [
      { path: CLAUDE_USER_SKILLS_DIR, label: "claude-user", maxDepth: 3 },
    ]);
    for (const [name, expectedTrigger] of Object.entries(EXPECTED_TRIGGERS)) {
      const skill = skills.get(name);
      assert.ok(skill, `${name} must be discoverable to check its trigger`);
      assert.equal(
        skill!.trigger,
        expectedTrigger,
        `${name} trigger text must be preserved verbatim by the normalization pass`,
      );
    }
  });
});
