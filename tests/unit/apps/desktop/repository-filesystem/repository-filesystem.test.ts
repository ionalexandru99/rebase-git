import { describe, expect, it, vi } from "vite-plus/test";
import {
  createRepositoryFilesystem,
  requireAbsoluteRepositoryPath,
} from "#desktop/features/repository-filesystem/repository-filesystem";
import type { RepositoryFilesystemPlatform } from "#desktop/features/repository-filesystem/repository-filesystem.contract";

describe("repository filesystem", () => {
  it("reveals a repository path", async () => {
    const platform = new TestRepositoryFilesystemPlatform();
    const filesystem = createRepositoryFilesystem(platform);

    await filesystem.revealRepository("/work/rebase-git");

    expect(platform.showItemInFolder).toHaveBeenCalledWith("/work/rebase-git");
  });

  it("accepts a non-empty absolute reveal path", () => {
    expect(requireAbsoluteRepositoryPath("/work/rebase-git")).toBe(
      "/work/rebase-git",
    );
  });

  it.each(["", "   ", "work/rebase-git", "./rebase-git", undefined, null, 42])(
    "rejects an invalid reveal path: %j",
    (path) => {
      expect(() => requireAbsoluteRepositoryPath(path)).toThrow(
        "a non-empty absolute path",
      );
    },
  );
});

class TestRepositoryFilesystemPlatform implements RepositoryFilesystemPlatform {
  readonly showItemInFolder = vi.fn();
}
