import {
  type CreateRepositoryTag,
  type DeleteRepositoryTag,
  type RefMissing,
  type RepositoryRejected,
  type RepositoryTag,
  type RepositoryTagDeleted,
  repositoryRejected,
  type TagRejected,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  readRefTarget,
  refCommand,
  requireValidRefName,
} from "#server/features/repository-refs/git/ref-git";
import {
  isGitRejection,
  runRepositoryGit,
} from "#server/repository/access/index";

export function createTag(
  git: GitCommandRunner,
  { name, target, worktreePath }: CreateRepositoryTag,
): Effect.Effect<
  RepositoryTag,
  TagRejected | RepositoryRejected | RepositoryGitError
> {
  return Effect.gen(function* () {
    yield* requireValidTagName(git, worktreePath, name);
    yield* runRepositoryGit(
      git,
      worktreePath,
      ["tag", name, target],
      refCommand,
    ).pipe(Effect.mapError(tagWriteFailed));
    return { name, target };
  });
}

export function deleteTag(
  git: GitCommandRunner,
  { name, worktreePath }: DeleteRepositoryTag,
): Effect.Effect<RepositoryTagDeleted, RefMissing | RepositoryGitError> {
  return Effect.gen(function* () {
    const target = yield* requireTagTarget(git, worktreePath, name);
    yield* runRepositoryGit(
      git,
      worktreePath,
      ["tag", "--delete", "--", name],
      refCommand,
    );
    return { name, target };
  });
}

function requireValidTagName(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  const invalid: TagRejected = { _tag: "TagRejected", reason: "InvalidName" };
  if (name.startsWith("-")) return Effect.fail(invalid);
  return requireValidRefName(git, directory, tagRef(name), invalid);
}

function requireTagTarget(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  return readRefTarget(git, directory, `${tagRef(name)}^{}`).pipe(
    Effect.flatMap((target) =>
      target === undefined
        ? Effect.fail<RefMissing>({ _tag: "RefMissing", name })
        : Effect.succeed(target),
    ),
  );
}

function tagRef(name: string) {
  return `refs/tags/${name}`;
}

function tagWriteFailed(
  error: RepositoryGitError,
): TagRejected | RepositoryRejected {
  return isGitRejection(error) && /already exists/.test(error.detail)
    ? { _tag: "TagRejected", reason: "Exists" }
    : repositoryRejected("GitFailed", error.detail);
}
