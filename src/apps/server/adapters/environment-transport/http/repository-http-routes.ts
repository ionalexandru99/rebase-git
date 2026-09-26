import type { RouteFailure, RouteSuccess } from "@rebase/contracts";
import { Effect, type Schema } from "effect";
import { routeHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { ServableEnvironmentHttpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import {
  type RepositoryInfrastructureError,
  rejectCoordination,
  rejectInfrastructure,
  worktreeRejection,
} from "#server/adapters/environment-transport/http/repository-rejection";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryAccess,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import {
  RepositoryCoordination,
  type RepositoryWritePolicy,
} from "#server/domain/repository-coordination.contract";

interface WorktreeScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
}

interface RepositoryScope {
  readonly repositoryId: string;
  readonly worktreePath?: string;
}

type RepositoryHttpRoute<Scope> = ServableEnvironmentHttpRoute & {
  readonly request: Schema.ConstraintDecoder<Scope>;
};

type RepositoryHandle<Route extends RepositoryHttpRoute<RepositoryScope>> = (
  input: Route["request"]["Type"],
  git: GitCommandRunner,
) => Effect.Effect<
  RouteSuccess<Route>,
  RouteFailure<Route> | RepositoryInfrastructureError
>;

type CommandPolicy<Input> =
  | RepositoryWritePolicy
  | ((input: Input) => RepositoryWritePolicy);

export function query<Route extends RepositoryHttpRoute<RepositoryScope>>(
  route: Route,
  handle: RepositoryHandle<Route>,
) {
  return Effect.gen(function* () {
    const access = yield* RepositoryAccess;
    const git = yield* GitCommands;
    return routeHandler(route, (input: Route["request"]["Type"]) =>
      requireScope(access, input).pipe(
        Effect.andThen(
          handle(input, git).pipe(Effect.mapError(rejectInfrastructure)),
        ),
      ),
    );
  });
}

export function command<Route extends RepositoryHttpRoute<WorktreeScope>>(
  route: Route,
  policy: CommandPolicy<Route["request"]["Type"]>,
  handle: RepositoryHandle<Route>,
) {
  return Effect.gen(function* () {
    const access = yield* RepositoryAccess;
    const git = yield* GitCommands;
    const coordination = yield* RepositoryCoordination;
    return routeHandler(route, (input: Route["request"]["Type"]) =>
      access
        .requireWorktree(input)
        .pipe(
          Effect.mapError(worktreeRejection),
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

function requireScope(access: RepositoryAccessService, scope: RepositoryScope) {
  return scope.worktreePath === undefined
    ? Effect.void
    : access
        .requireWorktree({
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
        })
        .pipe(Effect.mapError(worktreeRejection));
}
