import {
  EnvironmentDirectory,
  ListEnvironmentDirectory,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const directory = {
  breadcrumbs: [
    { name: "home", path: "/home" },
    { name: "alex", path: "/home/alex" },
  ],
  entries: [
    {
      kind: "Folder",
      modifiedAt: "2026-08-25T10:00:00.000Z",
      name: "rebase-git",
      path: "/home/alex/rebase-git",
      type: "directory",
    },
    {
      kind: "Markdown",
      modifiedAt: "2026-08-25T09:00:00.000Z",
      name: "notes.md",
      path: "/home/alex/notes.md",
      type: "file",
    },
  ],
  parentPath: "/home",
  path: "/home/alex",
  truncated: false,
};

describe("Environment filesystem contract", () => {
  it("round-trips a bounded directory listing", () => {
    expect(Schema.decodeUnknownSync(EnvironmentDirectory)(directory)).toEqual(
      directory,
    );
  });

  it("supports opening the Environment home directory", () => {
    expect(Schema.decodeUnknownSync(ListEnvironmentDirectory)({})).toEqual({});
  });

  it("rejects oversized paths and directory listings", () => {
    expect(() =>
      Schema.decodeUnknownSync(ListEnvironmentDirectory)({
        path: "x".repeat(4_097),
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EnvironmentDirectory)({
        ...directory,
        entries: Array.from({ length: 501 }, () => directory.entries[0]),
      }),
    ).toThrow();
  });
});
