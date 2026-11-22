import { AsyncLocalStorage } from "node:async_hooks";
import type { EnvironmentDeviceAuthorization } from "#contracts/environment-authorization/environment-authorization.contract.ts";
import type {
  EnvironmentRoute,
  EnvironmentStreamRoute,
  RouteInput,
  RouteSuccess,
  StreamValue,
} from "#contracts/environment-connection/environment-route.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import type { CommandProgress } from "#server/features/command-progress/command-progress.ts";
import type { GitLfs } from "#server/features/repository-lfs/git-lfs.ts";
import { rejectionFromGit } from "#server/repository/git-rejection.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";
import type {
  RepositoryCoordination,
  RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";

export interface ConnectionContext {
  readonly device: EnvironmentDeviceAuthorization;
  readonly origin: string;
}

export interface RouteContext extends ConnectionContext {
  readonly signal: AbortSignal;
}

export interface RequestScope {
  readonly procedure: string;
  readonly repositoryId?: string;
  readonly signal: AbortSignal;
}

export type RouteHandler =
  | {
      readonly route: EnvironmentRoute;
      readonly handle: (
        input: unknown,
        context: RouteContext,
      ) => Promise<unknown>;
    }
  | {
      readonly route: EnvironmentStreamRoute;
      readonly handle: (
        input: unknown,
        context: RouteContext,
      ) => AsyncIterable<unknown>;
    };

export interface EnvironmentFeature {
  readonly routes: readonly RouteHandler[];
}

const requests = new AsyncLocalStorage<RequestScope>();

export function currentRequest() {
  return requests.getStore();
}

export function inRequest<Value>(scope: RequestScope, run: () => Value) {
  return requests.run(scope, run);
}

export function uninterruptible<Value>(run: () => Promise<Value>) {
  const request = currentRequest();
  return request === undefined
    ? run()
    : inRequest({ ...request, signal: new AbortController().signal }, run);
}

export function requestScopedGit(git: GitCommandRunner): GitCommandRunner {
  const scoped = <Command extends { readonly signal?: AbortSignal }>(
    command: Command,
  ) => {
    const signal = command.signal ?? currentRequest()?.signal;
    return signal === undefined ? command : { ...command, signal };
  };
  return {
    run: (command) => git.run(scoped(command)),
    stream: (command) => git.stream(scoped(command)),
  };
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
  ) => Promise<RouteSuccess<Route>>,
): RouteHandler {
  return {
    route: definition,
    handle: (input, context) => handle(input as RouteInput<Route>, context),
  };
}

export function stream<Route extends EnvironmentStreamRoute>(
  definition: Route,
  handle: (
    input: RouteInput<Route>,
    context: RouteContext,
  ) => AsyncIterable<StreamValue<Route>>,
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

type ScopedRoute<Scope> = EnvironmentRoute & {
  readonly request: { readonly _zod: { readonly output: Scope } };
};

type RepositoryRoute = ScopedRoute<{ readonly repositoryId: string }>;

type WorktreeRoute = ScopedRoute<{
  readonly repositoryId: string;
  readonly worktreePath: string;
}>;

type RepositoryHandle<Route extends EnvironmentRoute> = (
  input: RouteInput<Route>,
  git: GitCommandRunner,
) => Promise<RouteSuccess<Route>>;

type CommandPolicy<Input> =
  | RepositoryWritePolicy
  | ((input: Input) => RepositoryWritePolicy);

export function repositoryRoutes({
  access,
  coordination,
  git,
  progress,
}: RepositoryDependencies) {
  return {
    repository: <Route extends RepositoryRoute>(
      definition: Route,
      handle: (
        input: RouteInput<Route>,
        repository: RepositoryCatalogEntry,
      ) => Promise<RouteSuccess<Route>>,
    ) =>
      route(definition, async (input) => {
        const repository = await access.repository(input.repositoryId);
        return rejectingGitFailures(() => handle(input, repository));
      }),
    query: <Route extends WorktreeRoute>(
      definition: Route,
      handle: RepositoryHandle<Route>,
    ) =>
      route(definition, async (input) => {
        await access.requireWorktree(input);
        return rejectingGitFailures(() => handle(input, git));
      }),
    command: <Route extends WorktreeRoute>(
      definition: Route,
      policy: CommandPolicy<RouteInput<Route>>,
      handle: RepositoryHandle<Route>,
    ) =>
      route(definition, async (input) => {
        await access.requireWorktree(input);
        const report = progress.reporter([input.repositoryId], definition._tag);
        return coordination.run(
          input.worktreePath,
          typeof policy === "function" ? policy(input) : policy,
          () =>
            rejectingGitFailures(() =>
              handle(input, {
                run: (command) => git.run({ ...command, progress: report }),
                stream: git.stream,
              }),
            ),
        );
      }),
  };
}

async function rejectingGitFailures<Value>(run: () => Promise<Value>) {
  try {
    return await run();
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw rejectionFromGit(error.detail);
  }
}
