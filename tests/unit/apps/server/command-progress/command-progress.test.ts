import { describe, expect, it } from "vite-plus/test";
import { readGitProgress } from "#server/features/command-progress/command-progress.ts";

describe("Git progress", () => {
  it("maps fetch phases onto one rising percent across chunks and remote lines", () => {
    const read = readGitProgress();

    expect(read("remote: Enumerating objects: 9, done.\n")).toBeUndefined();
    expect(read("remote: Counting objects: 100% (9/9), done.\n")).toBe(5);
    expect(read("remote: Compressing objects:  50% (2/4)\rremote: Comp")).toBe(
      10,
    );
    expect(read("ressing objects: 100% (4/4), done.\n")).toBe(15);
    expect(read("Receiving objects:  50% (4/9)\r")).toBe(52);
    expect(
      read(
        "Receiving objects: 100% (9/9), done.\nResolving deltas:  50% (1/2)\r",
      ),
    ).toBe(95);
    expect(read("Counting objects: 100% (9/9)\r")).toBeUndefined();
    expect(read("Resolving deltas: 100% (2/2), done.\n")).toBe(100);
  });

  it("reads rebase steps as the share of commits already applied", () => {
    const read = readGitProgress();

    expect(read("Rebasing (1/4)\r")).toBe(0);
    expect(read("Rebasing (3/4)\r")).toBe(50);
  });
});
