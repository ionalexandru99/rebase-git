import type { RepositoryRefs } from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveAutomaticHistoryRoots } from "#web/features/repository-history/automatic-history-roots";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const commits = Array.from({ length: 8 }, (_, index) =>
  index.toString(16).repeat(40),
);
const mainCommit = commits[1] ?? "1".repeat(40);

describe("Automatic history roots", () => {
  it("snapshots the active branch and upstream, then its remote default", () => {
    expect(resolveAutomaticHistoryRoots(refs(), "/repo")).toEqual([
      branch("topic", 1),
      remoteBranch("upstream", "topic", 2),
      branch("main", 3),
      remoteBranch("upstream", "main", 4),
    ]);
  });

  it("prefers origin when the active branch has no upstream", () => {
    const current = refs({
      branches: [
        { name: "topic", target: commits[1], worktreePath: "/repo" },
        {
          name: "stable",
          target: commits[5],
          upstream: upstream("origin/stable"),
        },
      ],
    });

    expect(resolveAutomaticHistoryRoots(current, "/repo")).toEqual([
      branch("topic", 1),
      branch("stable", 5),
      remoteBranch("origin", "stable", 6),
    ]);
  });

  it("uses an unambiguous remote default and a detached active HEAD", () => {
    const current = refs({
      branches: [
        {
          name: "main",
          target: commits[3],
          upstream: upstream("fork/main"),
        },
      ],
      remoteBranches: [
        { name: "trunk", remote: "company", target: commits[7] },
      ],
      remoteDefaultBranches: [{ name: "trunk", remote: "company" }],
      worktrees: [{ head: { commit: mainCommit }, main: true, path: "/repo" }],
    });

    expect(resolveAutomaticHistoryRoots(current, "/repo")).toEqual([
      { name: "HEAD", oid: mainCommit, type: "head" },
      remoteBranch("company", "trunk", 7),
    ]);
  });

  it("returns no roots for an unborn or unavailable worktree", () => {
    expect(
      resolveAutomaticHistoryRoots(
        refs({ branches: [], remoteDefaultBranches: [], worktrees: [] }),
        "/repo",
      ),
    ).toEqual([]);
  });
});

function refs(overrides: Partial<RepositoryRefs> = {}): RepositoryRefs {
  return {
    branches: [
      {
        name: "topic",
        target: commits[1],
        upstream: upstream("upstream/topic"),
        worktreePath: "/repo",
      },
      {
        name: "main",
        target: commits[3],
        upstream: upstream("upstream/main"),
      },
    ],
    remoteBranches: [
      { name: "topic", remote: "upstream", target: commits[2] },
      { name: "main", remote: "upstream", target: commits[4] },
      { name: "stable", remote: "origin", target: commits[6] },
    ],
    remoteDefaultBranches: [
      { name: "main", remote: "upstream" },
      { name: "stable", remote: "origin" },
    ],
    repositoryId,
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      {
        head: { branch: "topic", commit: mainCommit },
        main: true,
        path: "/repo",
      },
    ],
    ...overrides,
  };
}

function upstream(name: string) {
  return { ahead: 0, behind: 0, gone: false, name };
}

function branch(name: string, commit: number) {
  return { name, oid: commits[commit], type: "branch" };
}

function remoteBranch(remote: string, name: string, commit: number) {
  return {
    name: `${remote}/${name}`,
    oid: commits[commit],
    type: "remote-branch",
  };
}
