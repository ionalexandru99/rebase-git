import type {
  LocalBranch,
  RepositoryRefs,
  RepositoryWorktree,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryRefsError } from "#server/domain/repository-refs.contract";
import { fitRepositoryRefs } from "#server/features/repository-refs/git/fit-repository-refs";
import {
  forEachRefFormat,
  localBranchFromRecord,
  parseForEachRef,
  remoteBranchFromRecord,
  remoteDefaultBranchFromRecord,
  tagFromRecord,
} from "#server/features/repository-refs/git/parse-for-each-ref";
import { readRemoteMetadata } from "#server/features/repository-refs/git/read-remote-metadata";
import { gitFailed } from "#server/features/repository-refs/git/repository-refs-failures";
import {
  canonicalizeWorktrees,
  readWorktrees,
  runRepositoryGit,
} from "#server/repository/access/index";

const readTimeoutMilliseconds = 15_000;
const maximumRefsOutputBytes = 16 * 1_048_576;

export function readRepositoryRefs(
  git: GitCommandRunner,
  repository: {
    readonly id: string;
    readonly logicalRepositoryId?: string;
    readonly path: string;
  },
): Effect.Effect<RepositoryRefs, RepositoryRefsError> {
  return Effect.gen(function* () {
    const output = yield* Effect.all(
      {
        branches: listRefs(
          git,
          repository.path,
          "refs/heads",
          "-committerdate",
        ),
        remoteBranches: listRefs(
          git,
          repository.path,
          "refs/remotes",
          "refname",
        ),
        tags: listRefs(git, repository.path, "refs/tags", "-creatordate"),
        worktrees: readWorktrees(git, repository.path).pipe(
          Effect.mapError(gitFailed),
        ),
        remoteMetadata: readRemoteMetadata(git, repository.path),
      },
      { concurrency: "unbounded" },
    );
    const worktrees = yield* canonicalizeWorktrees(output.worktrees);
    return fitRepositoryRefs({
      remoteProviders: output.remoteMetadata.remoteProviders,
      ...(output.remoteMetadata.githubRepository === undefined
        ? {}
        : { githubRepository: output.remoteMetadata.githubRepository }),
      branches: canonicalizeBranchWorktrees(
        output.branches.flatMap(withDefined(localBranchFromRecord)),
        output.worktrees,
        worktrees,
      ),
      logicalRepositoryId: repository.logicalRepositoryId ?? repository.id,
      remoteBranches: output.remoteBranches.flatMap(
        withDefined(remoteBranchFromRecord),
      ),
      remoteDefaultBranches: output.remoteBranches.flatMap(
        withDefined(remoteDefaultBranchFromRecord),
      ),
      repositoryId: repository.id,
      tags: output.tags.flatMap(withDefined(tagFromRecord)),
      truncated: { branches: false, remoteBranches: false, tags: false },
      worktrees,
    });
  });
}

function listRefs(
  git: GitCommandRunner,
  directory: string,
  pattern: string,
  sort: string,
) {
  return runRepositoryGit(
    git,
    directory,
    ["for-each-ref", `--format=${forEachRefFormat}`, `--sort=${sort}`, pattern],
    {
      maxOutputBytes: maximumRefsOutputBytes,
      timeoutMilliseconds: readTimeoutMilliseconds,
    },
  ).pipe(Effect.mapError(gitFailed), Effect.map(parseForEachRef));
}

function canonicalizeBranchWorktrees(
  branches: readonly LocalBranch[],
  rawWorktrees: readonly RepositoryWorktree[],
  canonicalWorktrees: readonly RepositoryWorktree[],
) {
  const canonicalByRawPath = new Map(
    rawWorktrees.map((worktree, index) => [
      worktree.path,
      canonicalWorktrees[index]?.path ?? worktree.path,
    ]),
  );
  return branches.map((branch) =>
    branch.worktreePath === undefined
      ? branch
      : {
          ...branch,
          worktreePath:
            canonicalByRawPath.get(branch.worktreePath) ?? branch.worktreePath,
        },
  );
}

function withDefined<Input, Output>(
  convert: (input: Input) => Output | undefined,
) {
  return (input: Input) => {
    const output = convert(input);
    return output === undefined ? [] : [output];
  };
}
