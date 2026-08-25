import type { EnvironmentDirectoryEntry } from "@rebase/contracts";
import { RepositoryCatalogRejected } from "@rebase/web/features/repository-catalog";
import { describe, expect, it } from "vite-plus/test";
import {
  filterDirectoryEntries,
  modifiedDateLabel,
  repositorySelectionError,
} from "#web/features/repository-folder-picker/repository-folder-picker-state";

const entries = [
  {
    kind: "Folder",
    name: "rebase-git",
    path: "/rebase-git",
    type: "directory",
  },
  { kind: "Markdown", name: "notes.md", path: "/notes.md", type: "file" },
] satisfies readonly EnvironmentDirectoryEntry[];

describe("repository folder picker state", () => {
  it("filters the current directory without changing its ordering", () => {
    expect(filterDirectoryEntries(entries, "BASE")).toEqual([entries[0]]);
    expect(filterDirectoryEntries(entries, " ")).toBe(entries);
  });

  it("uses compact modified-date labels", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(modifiedDateLabel("2026-08-25T08:00:00.000Z", now)).toBe("Today");
    expect(modifiedDateLabel("2026-08-24T08:00:00.000Z", now)).toBe(
      "Yesterday",
    );
  });

  it("explains Git validation only after selection", () => {
    expect(
      repositorySelectionError(
        new RepositoryCatalogRejected({
          failure: {
            _tag: "RepositoryPathRejected",
            reason: "NotRepository",
          },
          status: 422,
        }),
      ),
    ).toBe("This folder is not a Git repository.");
  });
});
