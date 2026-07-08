import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareSemver, fetchLatestVersion, getInstalledVersion, isStale } from "../src/cli/registry";

describe("cli registry helpers", () => {
  test("getInstalledVersion returns the bundled version or null on read failure", () => {
    const version = getInstalledVersion(
      {
        readFileSync: () => JSON.stringify({ version: "1.2.3" }),
      },
      "/tmp/package.json",
    );
    assert.equal(version, "1.2.3");

    assert.equal(
      getInstalledVersion(
        {
          readFileSync: () => {
            throw new Error("missing");
          },
        },
        "/tmp/package.json",
      ),
      null,
    );

    assert.equal(
      getInstalledVersion(
        {
          readFileSync: () => JSON.stringify({ version: 42 }),
        },
        "/tmp/package.json",
      ),
      null,
    );
  });

  test("compareSemver handles equal, older, newer, and unparsable input", () => {
    assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
    assert.equal(compareSemver("1.2.3", "1.2.4"), -1);
    assert.equal(compareSemver("1.3.0", "1.2.9"), 1);
    assert.equal(compareSemver("not-a-version", "1.2.3"), null);
  });

  test("isStale returns tri-state freshness", () => {
    assert.equal(isStale("1.2.3", "1.2.4"), true);
    assert.equal(isStale("1.2.3", "1.2.3"), false);
    assert.equal(isStale("1.2.4", "1.2.3"), false);
    assert.equal(isStale("bad", "1.2.3"), null);
  });

  test("fetchLatestVersion returns the registry version or null on failure", async () => {
    const okFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: "9.9.9" }),
    });
    assert.equal(await fetchLatestVersion(okFetch), "9.9.9");

    const badPayloadFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ nope: true }),
    });
    assert.equal(await fetchLatestVersion(badPayloadFetch), null);

    const errorFetch = async () => {
      throw new Error("network down");
    };
    assert.equal(await fetchLatestVersion(errorFetch), null);
  });
});
