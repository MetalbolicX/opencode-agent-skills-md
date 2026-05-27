import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { levenshtein, findClosestMatch } from "./utils";

describe("levenshtein", () => {
  test("identical strings have distance 0", () => {
    assert.equal(levenshtein("hello", "hello"), 0);
  });

  test("completely different strings have high distance", () => {
    assert.equal(levenshtein("abc", "xyz"), 3);
  });

  test("single character difference", () => {
    assert.equal(levenshtein("cat", "bat"), 1);
  });

  test("insertion", () => {
    assert.equal(levenshtein("cat", "cats"), 1);
  });

  test("deletion", () => {
    assert.equal(levenshtein("cats", "cat"), 1);
  });

  test("substitution", () => {
    assert.equal(levenshtein("cat", "cut"), 1);
  });

  test("case sensitive", () => {
    assert.equal(levenshtein("Cat", "cat"), 1);
  });
});

describe("findClosestMatch", () => {
  test("returns null for empty candidate list", () => {
    assert.equal(findClosestMatch("test", []), null);
  });

  test("exact match returns the match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("pdf", candidates), "pdf");
  });

  test("prefix match - user types partial skill name", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("git", candidates), "git-helper");
  });

  test("prefix match - longer match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("brainstorm", candidates), "brainstorming");
  });

  test("typo correction via Levenshtein", () => {
    const candidates = ["pattern", "git-helper", "pdf"];
    assert.equal(findClosestMatch("patern", candidates), "pattern");
  });

  test("case insensitive matching", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    assert.equal(findClosestMatch("brainstorm", candidates), "Brainstorming");
  });

  test("case insensitive exact match", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    assert.equal(findClosestMatch("PDF", candidates), "PDF");
  });

  test("substring match", () => {
    const candidates = ["document-processor", "git-helper", "pdf-reader"];
    assert.equal(findClosestMatch("pdf", candidates), "pdf-reader");
  });

  test("no close matches below threshold returns null", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    assert.equal(findClosestMatch("xyzabc", candidates), null);
  });

  test("multiple similar candidates returns best match", () => {
    const candidates = ["test", "testing", "tests"];
    assert.equal(findClosestMatch("test", candidates), "test");
  });

  test("prefix matching beats substring matching", () => {
    const candidates = ["pdf-reader", "reader-pdf"];
    assert.equal(findClosestMatch("pdf", candidates), "pdf-reader");
  });

  test("handles hyphenated names", () => {
    const candidates = ["git-helper", "github-actions", "gitlab-ci"];
    assert.equal(findClosestMatch("git", candidates), "git-helper");
  });

  test("script path matching", () => {
    const candidates = ["build.sh", "scripts/deploy.sh", "tools/build.sh"];
    assert.equal(findClosestMatch("deploy", candidates), "scripts/deploy.sh");
  });

  test("typo in script name", () => {
    const candidates = ["build.sh", "deploy.sh", "test.sh"];
    assert.equal(findClosestMatch("biuld.sh", candidates), "build.sh");
  });
});
