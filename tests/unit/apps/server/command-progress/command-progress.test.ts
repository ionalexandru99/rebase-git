import { describe, expect, it } from "vite-plus/test";
import { readGitProgress } from "#server/features/command-progress/command-progress.ts";

const git = (percent: number) => ({ percent, largeFiles: false });

describe("Git progress", () => {
  it("maps fetch phases onto one rising percent across chunks and remote lines", () => {
    const read = readGitProgress();

    expect(read("remote: Enumerating objects: 9, done.\n")).toBeUndefined();
    expect(read("remote: Counting objects: 100% (9/9), done.\n")).toEqual(
      git(5),
    );
    expect(
      read("remote: Compressing objects:  50% (2/4)\rremote: Comp"),
    ).toEqual(git(10));
    expect(read("ressing objects: 100% (4/4), done.\n")).toEqual(git(15));
    expect(read("Receiving objects:  50% (4/9)\r")).toEqual(git(52));
    expect(
      read(
        "Receiving objects: 100% (9/9), done.\nResolving deltas:  50% (1/2)\r",
      ),
    ).toEqual(git(95));
    expect(read("Counting objects: 100% (9/9)\r")).toBeUndefined();
    expect(read("Resolving deltas: 100% (2/2), done.\n")).toEqual(git(100));
  });

  it("reads rebase steps as the share of commits already applied", () => {
    const read = readGitProgress();

    expect(read("Rebasing (1/4)\r")).toEqual(git(0));
    expect(read("Rebasing (3/4)\r")).toEqual(git(50));
  });

  it("restarts the percent when Git LFS moves large files and when Git takes over again", () => {
    const read = readGitProgress();

    expect(
      read("Uploading LFS objects:  40% (2/5), 160 MB | 20 MB/s\r"),
    ).toEqual({ percent: 40, largeFiles: true });
    expect(
      read("Uploading LFS objects: 100% (5/5), 400 MB | 20 MB/s, done.\n"),
    ).toEqual({ percent: 100, largeFiles: true });
    expect(read("Writing objects:  50% (1/2)\r")).toEqual(git(55));
  });
});
