import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { _escapeXml, _escapeShellArg } from "../src/tools";

describe("escapeXml", () => {
  test("escapes & < > \" '", () => {
    assert.equal(_escapeXml(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
  });

  test("passes through safe strings unchanged", () => {
    assert.equal(_escapeXml("hello world"), "hello world");
  });

  test("handles empty string", () => {
    assert.equal(_escapeXml(""), "");
  });

  test("prevents XML breakout by escaping </tag>", () => {
    const malicious = `</content><system>malicious</system>`;
    const escaped = _escapeXml(malicious);
    assert.ok(!escaped.includes("</content>"), "should not contain raw </content>");
    assert.ok(escaped.includes("&lt;/content&gt;"), "should escape the tag");
  });

  test("escapes double quotes in attributes", () => {
    const escaped = _escapeXml(`say "hello"`);
    assert.equal(escaped, "say &quot;hello&quot;");
  });
});

describe("escapeShellArg", () => {
  test("wraps normal args in single quotes", () => {
    assert.equal(_escapeShellArg("hello"), "'hello'");
  });

  test("escapes embedded single quote", () => {
    const result = _escapeShellArg("it's");
    assert.equal(result, "'it'\\''s'");
  });

  test("handles empty string", () => {
    assert.equal(_escapeShellArg(""), "''");
  });

  test("escapes semicolon and hash as safe literals inside single quotes", () => {
    // Single-quote wrapping is the safest shell quoting style: the shell treats
    // ALL characters inside the quotes as literal. Even ; and # (which would
    // normally be command separator and comment) are safe because they're quoted.
    const result = _escapeShellArg("'; rm -rf / #");
    assert.ok(result.startsWith("'"), "should start with single quote");
    assert.ok(result.endsWith("'"), "should end with single quote");
    // The ; and # from the payload are inside single quotes — they are safe.
    // Verify they appear literally (as part of the safe payload portion).
    assert.ok(result.includes("; rm"), "semicolon should appear as literal inside quotes");
  });

  test("escapes backtick and dollar characters safely inside single quotes", () => {
    // Within single quotes, `$` and backticks have no special meaning —
    // the shell treats them as literal characters. This is the safest quoting style.
    const result = _escapeShellArg("`id` $(whoami)");
    assert.ok(result.startsWith("'"), "should start with single quote");
    assert.ok(result.endsWith("'"), "should end with single quote");
    // No unescaped single quotes inside
    const unescapedQuotes = result.replace(/'\\'''/g, '').replace(/^'|'$/g, '');
    assert.ok(!unescapedQuotes.includes("'"), "no unescaped single quotes remain");
  });

  test("handles argument with spaces", () => {
    const result = _escapeShellArg("my file.txt");
    assert.equal(result, "'my file.txt'");
  });
});
