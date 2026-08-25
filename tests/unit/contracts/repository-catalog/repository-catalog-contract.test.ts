import {
  RememberRepository,
  RepositoryCatalog,
  RepositoryCatalogEntry,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const repository = {
  addedAt: "2026-08-24T20:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  lastOpenedAt: "2026-08-24T20:01:00.000Z",
  name: "rebase-git",
  path: "/home/alex/rebase-git",
};

describe("repository catalog contract", () => {
  it("accepts a bounded repository entry", () => {
    expect(
      Schema.decodeUnknownSync(RepositoryCatalogEntry)(repository),
    ).toEqual(repository);
  });

  it("rejects malformed ids, dates, and oversized paths", () => {
    expect(() =>
      Schema.decodeUnknownSync(RepositoryCatalogEntry)({
        ...repository,
        id: "repository",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RepositoryCatalogEntry)({
        ...repository,
        lastOpenedAt: "yesterday",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RememberRepository)({ path: "x".repeat(4_097) }),
    ).toThrow();
  });

  it("bounds the repository collection", () => {
    expect(() =>
      Schema.decodeUnknownSync(RepositoryCatalog)({
        repositories: Array.from({ length: 10_001 }, () => repository),
      }),
    ).toThrow();
  });
});
