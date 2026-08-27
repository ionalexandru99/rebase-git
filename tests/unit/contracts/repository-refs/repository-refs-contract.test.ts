import {
  CheckoutRepositoryRef,
  RepositoryRefs,
  RepositoryRefsOperationFailure,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const commit = "0123456789abcdef0123456789abcdef01234567";
const refs = {
  branches: [
    {
      name: "main",
      upstream: { ahead: 1, behind: 0, gone: false, name: "origin/main" },
      worktreePath: "/home/alex/rebase-git",
    },
  ],
  remoteBranches: [{ name: "main", remote: "origin" }],
  repositoryId: "00000000-0000-4000-8000-000000000001",
  tags: [{ name: "v0.0.2" }],
  truncated: { branches: false, remoteBranches: false, tags: false },
  worktrees: [
    {
      head: { branch: "main", commit },
      main: true,
      path: "/home/alex/rebase-git",
    },
  ],
};

describe("repository refs contract", () => {
  it("accepts a bounded refs snapshot", () => {
    expect(Schema.decodeUnknownSync(RepositoryRefs)(refs)).toEqual(refs);
  });

  it("rejects malformed commits and oversized collections", () => {
    expect(() =>
      Schema.decodeUnknownSync(RepositoryRefs)({
        ...refs,
        worktrees: [{ ...refs.worktrees[0], head: { commit: "abc" } }],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RepositoryRefs)({
        ...refs,
        tags: Array.from({ length: 10_001 }, () => ({ name: "tag" })),
      }),
    ).toThrow();
  });

  it("discriminates checkout targets and failures by tag", () => {
    expect(
      Schema.decodeUnknownSync(CheckoutRepositoryRef)({
        repositoryId: refs.repositoryId,
        target: { _tag: "RemoteBranch", name: "main", remote: "origin" },
        worktreePath: "/home/alex/rebase-git",
      }).target,
    ).toEqual({ _tag: "RemoteBranch", name: "main", remote: "origin" });
    expect(() =>
      Schema.decodeUnknownSync(CheckoutRepositoryRef)({
        repositoryId: refs.repositoryId,
        target: { _tag: "Commit", name: commit },
        worktreePath: "/home/alex/rebase-git",
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(RepositoryRefsOperationFailure)({
        _tag: "BranchCheckedOutElsewhere",
        name: "feature",
        worktreePath: "/home/alex/feature",
      }),
    ).toMatchObject({ _tag: "BranchCheckedOutElsewhere" });
  });
});
