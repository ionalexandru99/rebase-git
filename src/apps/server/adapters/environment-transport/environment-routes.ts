import { Effect, type Stream } from "effect";
import type { z } from "zod";
import type { EnvironmentDeviceAuthorization } from "#contracts/environment-authorization/environment-authorization.contract.ts";
import type {
  EnvironmentRoute,
  EnvironmentStreamRoute,
  RouteFailure,
  RouteInput,
  RouteSuccess,
  StreamValue,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isIdentityMissing,
  isLfsMissing,
  lfsMissing,
  signingRejection,
} from "#server/adapters/local-git/git-commands.ts";
import type { CommandProgress } from "#server/features/command-progress/command-progress.ts";
import type { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization.ts";
import type { GitLfs } from "#server/features/repository-lfs/git-lfs.ts";
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

export type RouteHandler =
  | {
      readonly route: EnvironmentRoute;
      readonly handle: (
        input: unknown,
        context: RouteContext,
      ) => Effect.Effect<unknown, unknown>;
    }
  | {
      readonly route: EnvironmentStreamRoute;
      readonly handle: (
        input: unknown,
        context: RouteContext,
      ) => Stream.Stream<unknown, unknown>;
    };

export interface EnvironmentFeature {
  readonly routes: readonly RouteHandler[];
}

export function combineEnvironmentFeatures(
  features: readonly EnvironmentFeature[],
): EnvironmentFeature {
  return { routes: features.flatMap((feature) => feature.routes) };
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

export function stream<Route extends EnvironmentStreamRoute>(
  definition: Route,
  handle: (
    input: RouteInput<Route>,
    context: RouteContext,
  ) => Stream.Stream<StreamValue<Route>, RouteFailure<Route>>,
): RouteHandler {
  return {
    route: definition,
    handle: (input, context) => handle(input as RouteInput<Route>, context),
  };
}

export interface RepositoryDependencies {
  readonly access: RepositoryAccess;
  readonly coordination: RepositoryCoordination;
  readonly git: GitCommandRunner;
  readonly lfs: GitLfs;
  readonly progress: CommandProgress;
}

interface WorktreeScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
}

type RepositoryRoute<Input, Success, Failure> = EnvironmentRoute<
  string,
  z.ZodType<Input>,
  z.ZodType<Success>,
  z.ZodType<Failure | RepositoryRejected>
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
  progress,
}: RepositoryDependencies) {
  const handled = <Input, Success, Failure>(
    handle: RepositoryHandle<Input, Success, Failure>,
    input: Input,
    runner = git,
  ) =>
    handle(input, runner).pipe(
      Effect.catchIf(isGitFailed, (error) =>
        Effect.fail(
          isIdentityMissing(error.detail)
            ? repositoryRejected(
                "IdentityMissing",
                "Add your name and email to commit.",
              )
            : isLfsMissing(error.detail)
              ? lfsMissing()
              : (signingRejection(error.detail) ??
                repositoryRejected("GitFailed", error.detail)),
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
                handled(
                  handle,
                  input,
                  reportingProgress(
                    git,
                    progress.reporter([input.repositoryId], definition._tag),
                  ),
                ),
              ),
            ),
          ),
      ),
  };
}

function reportingProgress(
  git: GitCommandRunner,
  report: (output: string) => void,
): GitCommandRunner {
  return {
    run: (command) => git.run({ ...command, progress: report }),
    stream: git.stream,
  };
}

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
