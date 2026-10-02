import { describe, expect, it } from "vite-plus/test";
import { repositoryInitials } from "#web/features/repository-catalog/repository-badge.tsx";

describe("repository badge", () => {
  it("shows the first letters of the first two name parts", () => {
    expect(repositoryInitials("rebase-git")).toBe("RG");
  });
});
