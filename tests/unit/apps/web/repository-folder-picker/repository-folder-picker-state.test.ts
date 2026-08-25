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
    const now = new Date(2026, 7, 25, 12);
    const today = new Date(2026, 7, 25, 8).toISOString();
    const yesterday = new Date(2026, 7, 24, 8).toISOString();
    expect(modifiedDateLabel(today, now)).toBe("Today");
    expect(modifiedDateLabel(yesterday, now)).toBe("Yesterday");
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
