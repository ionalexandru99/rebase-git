import type { RepositoryRejected } from "@rebase/contracts";
import { Effect } from "effect";
import {
  type ResultHttpRoute,
  resultRoute,
} from "#server/adapters/environment-transport/http/environment-http-route-handler";
import {
  type RepositoryInfrastructureError,
  rejectAccess,
  rejectCoordination,
  rejectInfrastructure,
} from "#server/adapters/environment-transport/http/repository-rejection";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import {
  RepositoryCoordination,
  type RepositoryWritePolicy,
} from "#server/domain/repository-coordination.contract";

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
  NoInfer<Failure> | RepositoryRejected | RepositoryInfrastructureError
>;

type CommandPolicy<Input> =
  | RepositoryWritePolicy
  | ((input: Input) => RepositoryWritePolicy);

export function query<Input extends WorktreeScope, Success, Failure>(
  route: RepositoryHttpRoute<Input, Success, Failure>,
  handle: RepositoryHandle<Input, Success, Failure>,
) {
  return Effect.gen(function* () {
    const access = yield* RepositoryAccess;
    const git = yield* GitCommands;
    return resultRoute(route, (input) =>
      access
        .requireWorktree(input)
        .pipe(
          Effect.mapError(rejectAccess),
          Effect.andThen(
            handle(input, git).pipe(Effect.mapError(rejectInfrastructure)),
          ),
        ),
    );
  });
}

export function command<Input extends WorktreeScope, Success, Failure>(
  route: RepositoryHttpRoute<Input, Success, Failure>,
  policy: CommandPolicy<Input>,
  handle: RepositoryHandle<Input, Success, Failure>,
) {
  return Effect.gen(function* () {
    const access = yield* RepositoryAccess;
    const git = yield* GitCommands;
    const coordination = yield* RepositoryCoordination;
    return resultRoute(route, (input) =>
      access
        .requireWorktree(input)
        .pipe(
          Effect.mapError(rejectAccess),
          Effect.andThen(
            coordination.run(
              input.worktreePath,
              typeof policy === "function" ? policy(input) : policy,
              handle(input, git).pipe(Effect.mapError(rejectInfrastructure)),
            ),
          ),
          Effect.mapError(rejectCoordination),
        ),
    );
  });
}
