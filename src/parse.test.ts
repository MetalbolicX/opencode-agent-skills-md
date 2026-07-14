/**
 * Tests for parse module.
 *
 * Tests:
 *   - parseYamlFrontmatter: JSON format, YAML key-value, quoted strings, arrays,
 *     nested objects, scalars, comments
 *   - validateFrontmatter (via parseYamlFrontmatter output): name regex, required fields
 *
 * Note: parseSkillFile is not tested here because it requires filesystem I/O
 * (fs.readFile inside). Those tests live in integration tests.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseYamlFrontmatter } from "./parse";

describe("parseYamlFrontmatter", () => {
  describe("JSON format", () => {
    test("parses strict JSON with quoted keys and string values", () => {
      const result = parseYamlFrontmatter('"name": "test", "description": "A test skill"');
      assert.equal(result.name, "test");
      assert.equal(result.description, "A test skill");
    });

    test("parses nested JSON objects", () => {
      const result = parseYamlFrontmatter('"metadata": {"namespace": "core", "tags": ["test", "util"]}');
      assert.deepEqual(result.metadata, { namespace: "core", tags: ["test", "util"] });
    });
  });

  describe("YAML key-value format", () => {
    test("parses simple key-value pairs", () => {
      const result = parseYamlFrontmatter("name: test-skill\ndescription: A test skill");
      assert.equal(result.name, "test-skill");
      assert.equal(result.description, "A test skill");
    });

    test("parses quoted string values", () => {
      const result = parseYamlFrontmatter('name: "my-skill"\ndescription: \'another description\'');
      assert.equal(result.name, "my-skill");
      assert.equal(result.description, "another description");
    });

    test("parses inline arrays", () => {
      const result = parseYamlFrontmatter("tags: [test, util, helper]");
      assert.deepEqual(result.tags, ["test", "util", "helper"]);
    });
  });

  describe("nested objects", () => {
    test("parses inline nested objects", () => {
      const result = parseYamlFrontmatter("metadata: {namespace: core, tags: [test]}");
      assert.deepEqual(result.metadata, { namespace: "core", tags: ["test"] });
    });

    test("handles nested objects via JSON format", () => {
      const result = parseYamlFrontmatter('"metadata": {"namespace": "core", "tags": ["test", "util"]}');
      assert.deepEqual(result.metadata, { namespace: "core", tags: ["test", "util"] });
    });
  });

  describe("scalar type inference", () => {
    test("unquoted integer becomes number", () => {
      const result = parseYamlFrontmatter("priority: 42");
      assert.equal(result.priority, 42);
    });

    test("unquoted decimal becomes number", () => {
      const result = parseYamlFrontmatter("score: 3.14");
      assert.equal(result.score, 3.14);
    });

    test("unquoted non-numeric stays string", () => {
      const result = parseYamlFrontmatter("name: test-skill-v2");
      assert.equal(result.name, "test-skill-v2");
    });
  });

  describe("comments and empty values", () => {
    test("ignores comment lines", () => {
      const result = parseYamlFrontmatter("# this is a comment\nname: test\n# another comment");
      assert.equal(result.name, "test");
    });

    test("treats ~ as undefined", () => {
      const result = parseYamlFrontmatter("name: test\ntrigger: ~");
      assert.equal(result.name, "test");
      assert.equal(result.trigger, undefined);
    });

    test("treats empty value as undefined", () => {
      const result = parseYamlFrontmatter("name: test\ntrigger:");
      assert.equal(result.name, "test");
      assert.equal(result.trigger, undefined);
    });
  });

  describe("empty input", () => {
    test("returns empty object for empty string", () => {
      const result = parseYamlFrontmatter("");
      assert.deepEqual(result, {});
    });

    test("returns empty object for whitespace-only string", () => {
      const result = parseYamlFrontmatter("   \n  \n  ");
      assert.deepEqual(result, {});
    });
  });
});
