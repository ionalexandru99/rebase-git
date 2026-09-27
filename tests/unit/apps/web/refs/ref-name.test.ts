import { describe, expect, it } from "vite-plus/test";
import { refNameProblem } from "#web/features/refs/ref-kinds.ts";

const branches = [{ name: "main" }, { name: "fix/refs-watcher" }];

describe("ref name", () => {
  it("accepts a new name and the branch's own name", () => {
    expect(refNameProblem("branch", "feature/cache", branches)).toBeUndefined();
    expect(refNameProblem("branch", "main", branches, "main")).toBeUndefined();
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
      expect(refNameProblem("branch", name, branches)).toBe(
        `${name} is not a valid branch name.`,
      );
  });

  it("explains names that clash with an existing branch or folder", () => {
    expect(refNameProblem("branch", "main", branches)).toBe(
      "main already exists.",
    );
    expect(refNameProblem("branch", "fix/refs-watcher/v2", branches)).toBe(
      "fix/refs-watcher is a branch, not a folder.",
    );
    expect(refNameProblem("branch", "fix", branches)).toBe(
      "fix is a folder of branches.",
    );
  });

  it("words tag problems as tags", () => {
    expect(refNameProblem("tag", "", [])).toBe("Enter a tag name.");
    expect(refNameProblem("tag", "v1", [{ name: "v1/rc" }])).toBe(
      "v1 is a folder of tags.",
    );
  });
});
