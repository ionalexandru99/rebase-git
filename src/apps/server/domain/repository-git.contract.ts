import { Data } from "effect";
import type {
  GitCommandFailureReason,
  GitCommandOutput,
} from "#server/domain/git-command.contract";

export class RepositoryGitError extends Data.TaggedError("RepositoryGitError")<{
  readonly cause?: unknown;
  readonly detail: string;
  readonly reason: GitCommandFailureReason;
}> {}

export class RepositoryGitExitError extends Data.TaggedError(
  "RepositoryGitExitError",
)<{ readonly output: GitCommandOutput }> {}
