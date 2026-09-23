import { RepositoryCatalog, RepositoryCatalogEntry } from "@rebase/contracts";
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

  it("bounds the repository collection", () => {
    expect(() =>
      Schema.decodeUnknownSync(RepositoryCatalog)({
        repositories: Array.from({ length: 10_001 }, () => repository),
      }),
    ).toThrow();
  });
});
