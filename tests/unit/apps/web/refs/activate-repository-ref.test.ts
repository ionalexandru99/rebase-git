import { describe, expect, it } from "vite-plus/test";
import {
  mainAndTopicWorktrees,
  mainPath,
  repositoryRefs,
  topicPath,
  upstream,
} from "#tests-support/fixtures";
import {
  resolveActiveWorktreePath,
  resolveRefActivation,
} from "#web/features/refs/repository-refs";

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

function refs() {
  return repositoryRefs({
    branches: [
      {
        name: "main",
        upstream: upstream("origin/main", { behind: 2 }),
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
    tags: [{ name: "v1.0.0" }],
    worktrees: mainAndTopicWorktrees(),
  });
}
