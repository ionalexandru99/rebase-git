import { describe, expect, it } from "vite-plus/test";
import { branchNameProblem } from "#web/features/branch-management/index";

const branches = [{ name: "main" }, { name: "fix/refs-watcher" }];

describe("branch name", () => {
  it("accepts a new name and the branch's own name", () => {
    expect(branchNameProblem("feature/cache", branches)).toBeUndefined();
    expect(branchNameProblem("main", branches, "main")).toBeUndefined();
  });

  it("rejects names Git cannot store as a branch", () => {
    for (const name of [
      "-x",
      "HEAD",
      "@",
      "a..b",
      "a b",
      "tab\tname",
      "x.lock",
      ".hidden/x",
      "feature/",
      "a//b",
      "a@{1}",
      "what?",
      "back\\slash",
    ])
      expect(branchNameProblem(name, branches)).toBe(
        `${name} is not a valid branch name.`,
      );
  });

  it("explains names that clash with an existing branch or folder", () => {
    expect(branchNameProblem("main", branches)).toBe("main already exists.");
    expect(branchNameProblem("fix/refs-watcher/v2", branches)).toBe(
      "fix/refs-watcher is a branch, not a folder.",
    );
    expect(branchNameProblem("fix", branches)).toBe(
      "fix is a folder of branches.",
    );
  });
});
