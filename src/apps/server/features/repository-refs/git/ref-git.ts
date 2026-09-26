import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  isGitRejection,
  runRepositoryGit,
} from "#server/repository/access/index";

export const refCommand = {
  literalPathspecs: false,
  timeoutMilliseconds: 30_000,
};

export function requireValidRefName<Invalid>(
  git: GitCommandRunner,
  directory: string,
  fullRef: string,
  invalid: Invalid,
) {
  return runRepositoryGit(
    git,
    directory,
    ["check-ref-format", fullRef],
    refCommand,
  ).pipe(
    Effect.catchIf(isGitRejection, () => Effect.fail(invalid)),
    Effect.asVoid,
  );
}

export function readRefTarget(
  git: GitCommandRunner,
  directory: string,
  revision: string,
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", revision],
    { ...refCommand, exitCodes: [0, 1] },
  ).pipe(Effect.map((output) => output.trim() || undefined));
}
