import { Data } from "effect";
import type { GitCommandOutput } from "#server/domain/git-command.contract";

export class RepositoryGitError extends Data.TaggedError("RepositoryGitError")<{
  readonly detail: string;
}> {}

export class RepositoryGitExitError extends Data.TaggedError(
  "RepositoryGitExitError",
)<{ readonly output: GitCommandOutput }> {}
