import { Effect, type Scope } from "effect";
import type { Rpc, RpcGroup } from "effect/rpc";
import type { EnvironmentDeviceAuthorization } from "#contracts/environment-authorization/environment-authorization.contract.ts";
import type {
  EnvironmentRoute,
  RouteFailure,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";
import type { EnvironmentRpc } from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type {
  GitCommandRunner,
  GitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import type { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization.ts";
import { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";
import type {
  RepositoryCoordination,
  RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";

export interface RouteContext {
  readonly device: EnvironmentDeviceAuthorization;
  readonly origin: string;
}

export type EnvironmentTransportError =
  | EnvironmentAuthorizationError
  | EnvironmentStorageError;

export interface RouteHandler {
  readonly route: EnvironmentRoute;
  readonly handle: (
    input: unknown,
    context: RouteContext,
  ) => Effect.Effect<unknown, unknown>;
}

export type EnvironmentRpcHandlersFor<Group extends RpcGroup.Any> = {
  readonly [Current in RpcGroup.Rpcs<Group> as Current["_tag"]]: Rpc.ToHandlerFn<
    Current,
    Scope.Scope
  >;
};

type StreamRpcHandlers = Partial<
  EnvironmentRpcHandlersFor<typeof EnvironmentRpc>
>;

export interface EnvironmentFeature {
  readonly routes: readonly RouteHandler[];
  readonly rpc?: () => StreamRpcHandlers;
}

export type EnvironmentFeatures = Required<EnvironmentFeature>;

export function combineEnvironmentFeatures(
  features: readonly EnvironmentFeature[],
): EnvironmentFeatures {
  return {
    routes: features.flatMap((feature) => feature.routes),
    rpc: () => Object.assign({}, ...features.map((feature) => feature.rpc?.())),
  };
}

export function route<Route extends EnvironmentRoute>(
  definition: Route,
  handle: (
    input: RouteInput<Route>,
    context: RouteContext,
  ) => Effect.Effect<
    RouteSuccess<Route>,
    RouteFailure<Route> | EnvironmentTransportError
  >,
): RouteHandler {
  return {
    route: definition,
    handle: (input, context) =>
      handle(input as RouteInput<Route>, context).pipe(
        Effect.catchIf(isTransportError, Effect.die),
      ),
  };
}

export interface RepositoryDependencies {
  readonly access: RepositoryAccess;
  readonly coordination: RepositoryCoordination;
  readonly git: GitCommandRunner;
}

interface WorktreeScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
}

type RepositoryRoute<Input, Success, Failure> = EnvironmentRoute & {
  readonly payloadSchema: { readonly Type: Input };
  readonly successSchema: { readonly Type: Success };
  readonly errorSchema: { readonly Type: Failure | RepositoryRejected };
};

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
        Effect.fail(
          identityMissing.test(error.detail)
            ? repositoryRejected(
                "IdentityMissing",
                "Add your name and email to commit.",
              )
            : repositoryRejected("GitFailed", error.detail),
        ),
      ),
    );
  return {
    query: <Input extends WorktreeScope, Success, Failure>(
      definition: RepositoryRoute<Input, Success, Failure>,
      handle: RepositoryHandle<Input, Success, Failure>,
    ) =>
      route(definition, (input) =>
        access
          .requireWorktree(input)
          .pipe(Effect.andThen(handled(handle, input))),
      ),
    command: <Input extends WorktreeScope, Success, Failure>(
      definition: RepositoryRoute<Input, Success, Failure>,
      policy: CommandPolicy<Input>,
      handle: RepositoryHandle<Input, Success, Failure>,
    ) =>
      route(definition, (input) =>
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

const identityMissing =
  /Please tell me who you are|unable to auto-detect email address|empty ident name/;

function isTransportError(error: unknown): error is EnvironmentTransportError {
  return (
    error instanceof EnvironmentStorageError ||
    hasTag(error, "EnvironmentAuthorizationError")
  );
}

function isGitFailed(error: unknown): error is GitFailed {
  return hasTag(error, "GitFailed");
}

function hasTag(error: unknown, tag: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === tag
  );
}
