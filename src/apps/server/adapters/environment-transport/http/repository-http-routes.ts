import { type RepositoryRejected, repositoryRejected } from "@rebase/contracts";
import { Effect } from "effect";
import {
  type ResultHttpRoute,
  resultRoute,
} from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type {
  GitCommandRunner,
  GitFailed,
} from "#server/adapters/local-git/git-commands";
import type { RepositoryAccess } from "#server/repository/repository-access";
import type {
  RepositoryCoordination,
  RepositoryWritePolicy,
} from "#server/repository/repository-coordination";

export interface RepositoryDependencies {
  readonly access: RepositoryAccess;
  readonly coordination: RepositoryCoordination;
  readonly git: GitCommandRunner;
}

interface WorktreeScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
}

type RepositoryHttpRoute<Input, Success, Failure> = ResultHttpRoute<
  Input,
  Success,
  Failure | RepositoryRejected
>;

type RepositoryHandle<Input, Success, Failure> = (
  input: Input,
  git: GitCommandRunner,
) => Effect.Effect<
  NoInfer<Success>,
  NoInfer<Failure> | RepositoryRejected | GitFailed
>;

type CommandPolicy<Input> =
  | RepositoryWritePolicy
  | ((input: Input) => RepositoryWritePolicy);

export function repositoryRoutes({
  access,
  coordination,
  git,
}: RepositoryDependencies) {
  const handled = <Input, Success, Failure>(
    handle: RepositoryHandle<Input, Success, Failure>,
    input: Input,
  ) =>
    handle(input, git).pipe(
      Effect.catchIf(isGitFailed, (error) =>
        Effect.fail(repositoryRejected("GitFailed", error.detail)),
      ),
    );
  return {
    query: <Input extends WorktreeScope, Success, Failure>(
      route: RepositoryHttpRoute<Input, Success, Failure>,
      handle: RepositoryHandle<Input, Success, Failure>,
    ) =>
      resultRoute(route, (input) =>
        access
          .requireWorktree(input)
          .pipe(Effect.andThen(handled(handle, input))),
      ),
    command: <Input extends WorktreeScope, Success, Failure>(
      route: RepositoryHttpRoute<Input, Success, Failure>,
      policy: CommandPolicy<Input>,
      handle: RepositoryHandle<Input, Success, Failure>,
    ) =>
      resultRoute(route, (input) =>
        access
          .requireWorktree(input)
          .pipe(
            Effect.andThen(
              coordination.run(
                input.worktreePath,
                typeof policy === "function" ? policy(input) : policy,
                handled(handle, input),
              ),
            ),
          ),
      ),
  };
}

function isGitFailed(error: unknown): error is GitFailed {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "GitFailed"
  );
}
