import {
  createRepositoryFilesystem,
  type RepositoryFilesystemPlatform,
} from "@rebase/desktop";
import { describe, expect, it, vi } from "vite-plus/test";

describe("repository filesystem", () => {
  it("reveals a non-empty absolute repository path", async () => {
    const platform = new TestRepositoryFilesystemPlatform();
    const filesystem = createRepositoryFilesystem(platform);

    await filesystem.revealRepository("/work/rebase-git");

    expect(platform.showItemInFolder).toHaveBeenCalledWith("/work/rebase-git");
  });

  it.each(["", "   ", "work/rebase-git", "./rebase-git"])(
    "rejects an invalid reveal path: %j",
    async (path) => {
      const platform = new TestRepositoryFilesystemPlatform();
      const filesystem = createRepositoryFilesystem(platform);

      await expect(filesystem.revealRepository(path)).rejects.toThrow(
        "a non-empty absolute path",
      );
      expect(platform.showItemInFolder).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, 42])(
    "rejects a non-string reveal path: %j",
    async (path) => {
      const platform = new TestRepositoryFilesystemPlatform();
      const filesystem = createRepositoryFilesystem(platform);

      await expect(filesystem.revealRepository(path as never)).rejects.toThrow(
        "a non-empty absolute path",
      );
      expect(platform.showItemInFolder).not.toHaveBeenCalled();
    },
  );
});

class TestRepositoryFilesystemPlatform implements RepositoryFilesystemPlatform {
  readonly showItemInFolder = vi.fn();
}
