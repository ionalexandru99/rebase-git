import { currentTransportLimits } from "@rebase/contracts";
import { fitRepositoryRefs } from "@rebase/server/features/repository-refs/git/fit-repository-refs";
import {
  localBranchFromRecord,
  parseForEachRef,
  remoteBranchFromRecord,
} from "@rebase/server/features/repository-refs/git/parse-for-each-ref";
import { parseWorktreeList } from "@rebase/server/features/repository-refs/git/parse-worktree-list";
import { checkoutFailure } from "@rebase/server/features/repository-refs/git/repository-refs-failures";
import { describe, expect, it } from "vite-plus/test";

const commit = "a".repeat(40);

describe("git ref parsing", () => {
  it("reads tracking, worktree, and upstream details from for-each-ref records", () => {
    const stdout = [
      record("refs/heads/main", "origin/main", "behind 2", "/repo"),
      record("refs/heads/feature", "origin/feature", "ahead 3, behind 1", ""),
      record("refs/heads/orphan", "origin/orphan", "gone", ""),
      record("refs/heads/local", "", "", "/repo/../worktrees/local"),
    ].join("\n");

    const branches = parseForEachRef(`${stdout}\n`).map(localBranchFromRecord);

    expect(branches).toEqual([
      {
        name: "main",
        upstream: { ahead: 0, behind: 2, gone: false, name: "origin/main" },
        worktreePath: "/repo",
      },
      {
        name: "feature",
        upstream: { ahead: 3, behind: 1, gone: false, name: "origin/feature" },
      },
      {
        name: "orphan",
        upstream: { ahead: 0, behind: 0, gone: true, name: "origin/orphan" },
      },
      { name: "local", worktreePath: "/repo/../worktrees/local" },
    ]);
  });

  it("splits remote branches on the remote name and skips symbolic refs", () => {
    const records = parseForEachRef(
      [
        record(
          "refs/remotes/origin/HEAD",
          "",
          "",
          "",
          "refs/remotes/origin/main",
        ),
        record("refs/remotes/origin/feature/REB-1/nested", "", "", ""),
        record("refs/remotes/upstream/main", "", "", ""),
      ].join("\n"),
    );

    expect(records.map(remoteBranchFromRecord)).toEqual([
      undefined,
      { name: "feature/REB-1/nested", remote: "origin" },
      { name: "main", remote: "upstream" },
    ]);
  });

  it("reads worktrees from the NUL separated porcelain listing", () => {
    const stdout = [
      "worktree /repo",
      `HEAD ${commit}`,
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/spike",
      `HEAD ${commit}`,
      "detached",
      "",
      "worktree /bare.git",
      "bare",
      "",
    ].join("\0");

    expect(parseWorktreeList(stdout)).toEqual([
      { head: { branch: "main", commit }, main: true, path: "/repo" },
      { head: { commit }, main: false, path: "/repo/.worktrees/spike" },
    ]);
  });

  it("maps git checkout errors to typed failures", () => {
    expect(
      checkoutFailure(
        "fatal: 'feature' is already checked out at '/repo/.worktrees/feature'",
        "feature",
      ).failure,
    ).toEqual({
      _tag: "BranchCheckedOutElsewhere",
      name: "feature",
      worktreePath: "/repo/.worktrees/feature",
    });
    expect(
      checkoutFailure(
        "error: pathspec 'missing' did not match any file(s) known to git",
        "missing",
      ).failure,
    ).toEqual({ _tag: "RefMissing", name: "missing" });
    expect(
      checkoutFailure(
        "error: Your local changes to the following files would be overwritten by checkout:\n\tREADME.md",
        "main",
      ).failure,
    ).toMatchObject({ _tag: "CheckoutRejected", reason: "LocalChanges" });
  });

  it("keeps oversized ref listings within the HTTP response limit", () => {
    const fitted = fitRepositoryRefs({
      branches: Array.from({ length: 5 }, (_, index) => ({
        name: `branch-${index}`,
      })),
      remoteBranches: Array.from({ length: 30_000 }, (_, index) => ({
        name: `feature/${index}-${"x".repeat(40)}`,
        remote: "origin",
      })),
      repositoryId: "00000000-0000-4000-8000-000000000001",
      tags: [{ name: "v1.0.0" }],
      truncated: { branches: false, remoteBranches: false, tags: false },
      worktrees: [
        { head: { branch: "main", commit }, main: true, path: "/repo" },
      ],
    });

    expect(fitted.branches).toHaveLength(5);
    expect(fitted.remoteBranches.length).toBeLessThan(30_000);
    expect(fitted.truncated).toMatchObject({
      branches: false,
      remoteBranches: true,
    });
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(
      currentTransportLimits.maxHttpResponseBytes,
    );
  });
});

function record(
  name: string,
  upstream: string,
  track: string,
  worktreePath: string,
  symref = "",
) {
  return [name, commit, upstream, track, worktreePath, symref].join("\0");
}
