import { Data } from "effect";
import type { GitCommandFailureReason } from "#server/domain/git-command.contract";

export class RepositoryGitError extends Data.TaggedError("RepositoryGitError")<{
  readonly cause?: unknown;
  readonly detail: string;
  readonly exitCode?: number;
  readonly reason: GitCommandFailureReason;
}> {}
