import { describe, expect, it } from "vite-plus/test";
import { requireAbsoluteRepositoryPath } from "#desktop/features/repository-filesystem/repository-filesystem";

describe("repository filesystem", () => {
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
