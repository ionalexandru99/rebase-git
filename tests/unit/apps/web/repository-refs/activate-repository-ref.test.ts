import type { RepositoryRefs } from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveActiveWorktreePath,
  resolveRefActivation,
} from "#web/features/repository-refs/index";

const commit = "a".repeat(40);
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";

describe("repository ref activation", () => {
  it("switches worktrees for branches held elsewhere and checks out the rest", () => {
    const current = refs();

    expect(
      resolveRefActivation(current, mainPath, {
        _tag: "LocalBranch",
        name: "topic",
      }),
    ).toEqual({ _tag: "SwitchWorktree", worktreePath: topicPath });
    expect(
      resolveRefActivation(current, mainPath, {
        _tag: "LocalBranch",
        name: "main",
      }),
    ).toEqual({ _tag: "AlreadyCurrent" });
    expect(
      resolveRefActivation(current, mainPath, {
        _tag: "RemoteBranch",
        name: "topic",
        remote: "origin",
      }),
    ).toEqual({ _tag: "SwitchWorktree", worktreePath: topicPath });
    expect(
      resolveRefActivation(current, mainPath, {
        _tag: "RemoteBranch",
        name: "main",
        remote: "upstream",
      }),
    ).toEqual({
      _tag: "Checkout",
      target: { _tag: "RemoteBranch", name: "main", remote: "upstream" },
    });
    expect(
      resolveRefActivation(current, mainPath, {
        _tag: "RemoteBranch",
        name: "release",
        remote: "upstream",
      }),
    ).toEqual({
      _tag: "Checkout",
      target: { _tag: "RemoteBranch", name: "release", remote: "upstream" },
    });
    expect(
      resolveRefActivation(current, topicPath, { _tag: "Tag", name: "v1.0.0" }),
    ).toEqual({ _tag: "Checkout", target: { _tag: "Tag", name: "v1.0.0" } });
  });

  it("falls back to the main worktree when the preferred path disappeared", () => {
    expect(resolveActiveWorktreePath(refs(), topicPath)).toBe(topicPath);
    expect(resolveActiveWorktreePath(refs(), "/gone")).toBe(mainPath);
  });
});

function refs(): RepositoryRefs {
  return {
    branches: [
      {
        name: "main",
        upstream: { ahead: 0, behind: 2, gone: false, name: "origin/main" },
        worktreePath: mainPath,
      },
      { name: "feature" },
      { name: "topic", worktreePath: topicPath },
    ],
    remoteBranches: [
      { name: "feature", remote: "origin" },
      { name: "topic", remote: "origin" },
      { name: "release", remote: "upstream" },
    ],
    repositoryId: "00000000-0000-4000-8000-000000000001",
    tags: [{ name: "v1.0.0" }],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit }, main: true, path: mainPath },
      { head: { branch: "topic", commit }, main: false, path: topicPath },
    ],
  };
}
