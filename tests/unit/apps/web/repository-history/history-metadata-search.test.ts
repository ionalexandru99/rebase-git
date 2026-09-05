import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it } from "vitest";
import { matchingHistoryMetadata } from "#web/features/repository-history/search/history-metadata-search";
import {
  decodeHistorySearchCursor,
  encodeHistorySearchCursor,
} from "#web/features/repository-history/search/history-search-cursor";

const identity = {
  name: "Alex I.",
  email: "alex@example.test",
  timestampSeconds: 12,
  timezoneOffsetMinutes: 120,
};
const commit: RepositoryCommit = {
  author: identity,
  committer: identity,
  oid: "abcdef".padEnd(40, "0"),
  parents: [],
  subject: "Fix graph layout",
};
const refs = [
  { name: "feature/graph-search", oid: commit.oid, type: "branch" as const },
];

describe("history metadata matching", () => {
  it.each([
    "ABCDEF",
    " GRAPH layout ",
    "alex@example",
    "Alex I.",
    "graph-search",
    "alex layout",
    "feature/graph-search example",
  ])("matches %s across stored metadata", (text) => {
    expect(matchingHistoryMetadata(text, refs)(commit)).toBe(true);
  });

  it.each(["", "   ", "unknown", "graph missing"])(
    "does not match %s",
    (text) => {
      expect(matchingHistoryMetadata(text, refs)(commit)).toBe(false);
    },
  );

  it("matches ref names only at their stored target", () => {
    expect(
      matchingHistoryMetadata("graph-search", [
        {
          ...refs[0],
          name: "feature/graph-search",
          type: "branch",
          oid: "f".repeat(40),
        },
      ])(commit),
    ).toBe(false);
  });
});

describe("history search continuation", () => {
  it("retains its repository, normalized query and OID position", () => {
    const cursor = encodeHistorySearchCursor(
      "environment",
      "repository",
      "Alex  graph",
      commit.oid,
    );
    expect(
      decodeHistorySearchCursor(
        "environment",
        "repository",
        " alex graph ",
        cursor,
      ),
    ).toEqual(commit.oid);
  });

  it.each([
    ["other", "repository", "graph"],
    ["environment", "other", "graph"],
    ["environment", "repository", "different"],
  ])("rejects reuse for %s/%s/%s", (environmentId, repositoryId, text) => {
    const cursor = encodeHistorySearchCursor(
      "environment",
      "repository",
      "graph",
      commit.oid,
    );
    expect(() =>
      decodeHistorySearchCursor(environmentId, repositoryId, text, cursor),
    ).toThrow("does not match");
  });

  it("rejects a legacy date-ordered cursor instead of skipping primary-key results", () => {
    const cursor = encodeURIComponent(
      JSON.stringify([1, "environment", "repository", "graph", 12, commit.oid]),
    );
    expect(() =>
      decodeHistorySearchCursor("environment", "repository", "graph", cursor),
    ).toThrow("does not match");
  });

  it("rejects malformed continuation data", () => {
    expect(() =>
      decodeHistorySearchCursor(
        "environment",
        "repository",
        "graph",
        "%broken",
      ),
    ).toThrow("does not match");
  });
});
