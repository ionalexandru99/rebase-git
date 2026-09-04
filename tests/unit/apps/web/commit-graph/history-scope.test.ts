import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  automaticHistoryScope,
  historyRefKey,
  resolveHistoryScope,
  toggleHistoryRef,
} from "#web/features/commit-graph/history-scope";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const commits = Array.from({ length: 9 }, (_, index) =>
  index.toString(16).repeat(40),
);

describe("history scope", () => {
  it("resolves Automatic from the active and default branch groups", () => {
    const resolved = resolveHistoryScope(
      automaticHistoryScope,
      refs(),
      "/repo",
    );

    expect(resolved.scope).toEqual(automaticHistoryScope);
    expect(resolved.selections).toEqual([local("topic"), local("main")]);
    expect(resolved.roots).toEqual([
      root("branch", "topic", 1),
      root("remote-branch", "upstream/topic", 2),
      root("branch", "main", 3),
      root("remote-branch", "upstream/main", 4),
    ]);
  });

  it("turns an Automatic edit into Custom without losing the other groups", () => {
    const custom = toggleHistoryRef(
      automaticHistoryScope,
      local("release"),
      refs(),
      "/repo",
    );
    const resolved = resolveHistoryScope(custom, refs(), "/repo");

    expect(custom).toEqual({
      _tag: "Custom",
      selections: [local("topic"), local("main"), local("release")],
    });
    expect(resolved.roots).toContainEqual(root("branch", "release", 5));
  });

  it("preserves a remote default when its local branch has no target", () => {
    const current = refs({
      branches: [
        {
          name: "topic",
          target: commits[1],
          upstream: upstream("upstream/topic"),
          worktreePath: "/repo",
        },
        { name: "main" },
      ],
    });

    const custom = toggleHistoryRef(
      automaticHistoryScope,
      tag("v1.0.0"),
      current,
      "/repo",
    );

    expect(custom).toEqual({
      _tag: "Custom",
      selections: [local("topic"), remote("upstream", "main"), tag("v1.0.0")],
    });
    expect(resolveHistoryScope(custom, current, "/repo").roots).toContainEqual(
      root("remote-branch", "upstream/main", 4),
    );
  });

  it("treats a local branch and its current upstream as one group", () => {
    const custom = {
      _tag: "Custom",
      selections: [local("topic")],
    } as const;
    const initial = resolveHistoryScope(custom, refs(), "/repo");

    expect(initial.selectedRefKeys).toEqual(
      new Set([
        historyRefKey(local("topic")),
        historyRefKey(remote("upstream", "topic")),
      ]),
    );

    const moved = refs({
      branches: [
        {
          name: "topic",
          target: commits[6],
          upstream: upstream("fork/topic"),
          worktreePath: "/repo",
        },
      ],
      remoteBranches: [{ name: "topic", remote: "fork", target: commits[7] }],
      remoteDefaultBranches: [],
    });

    expect(resolveHistoryScope(custom, moved, "/repo").roots).toEqual([
      root("branch", "topic", 6),
      root("remote-branch", "fork/topic", 7),
    ]);
  });

  it("selects a remote branch with every local branch tracking it", () => {
    const custom = {
      _tag: "Custom",
      selections: [remote("upstream", "main")],
    } as const;
    const resolved = resolveHistoryScope(custom, refs(), "/repo");

    expect(resolved.roots).toEqual([
      root("remote-branch", "upstream/main", 4),
      root("branch", "main", 3),
      root("branch", "release", 5),
    ]);
    expect(resolved.selectedRefKeys).toEqual(
      new Set([
        historyRefKey(remote("upstream", "main")),
        historyRefKey(local("main")),
        historyRefKey(local("release")),
      ]),
    );
  });

  it("removes missing selections and returns to Automatic when none remain", () => {
    const current = {
      _tag: "Custom",
      selections: [local("deleted"), tag("missing")],
    } as const;

    expect(resolveHistoryScope(current, refs(), "/repo").scope).toEqual(
      automaticHistoryScope,
    );
  });

  it("keeps detached HEAD in Automatic without inventing a persisted ref", () => {
    const current = refs({
      branches: [],
      remoteBranches: [],
      remoteDefaultBranches: [],
      worktrees: [
        {
          head: { commit: commits[8] ?? "8".repeat(40) },
          main: true,
          path: "/repo",
        },
      ],
    });
    const resolved = resolveHistoryScope(
      automaticHistoryScope,
      current,
      "/repo",
    );

    expect(resolved.selections).toEqual([]);
    expect(resolved.roots).toEqual([root("head", "HEAD", 8)]);
  });

  it("removes a selected group through any ref represented by that group", () => {
    const current = {
      _tag: "Custom",
      selections: [local("topic"), tag("v1.0.0")],
    } as const;

    expect(
      toggleHistoryRef(current, remote("upstream", "topic"), refs(), "/repo"),
    ).toEqual({ _tag: "Custom", selections: [tag("v1.0.0")] });
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
      {
        name: "release",
        target: commits[5],
        upstream: upstream("upstream/main"),
      },
    ],
    remoteBranches: [
      { name: "topic", remote: "upstream", target: commits[2] },
      { name: "main", remote: "upstream", target: commits[4] },
    ],
    remoteDefaultBranches: [{ name: "main", remote: "upstream" }],
    repositoryId,
    tags: [{ name: "v1.0.0", target: commits[8] }],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      {
        head: { branch: "topic", commit: commits[1] ?? "1".repeat(40) },
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

function local(name: string): RepositoryRefTarget {
  return { _tag: "LocalBranch", name };
}

function remote(remoteName: string, name: string): RepositoryRefTarget {
  return { _tag: "RemoteBranch", name, remote: remoteName };
}

function tag(name: string): RepositoryRefTarget {
  return { _tag: "Tag", name };
}

function root(
  type: "branch" | "head" | "remote-branch" | "tag",
  name: string,
  commit: number,
) {
  return { name, oid: commits[commit], type };
}
