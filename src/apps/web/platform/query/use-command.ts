import {
  hashKey,
  type Query,
  type QueryClient,
  type QueryKey,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import { type RefObject, useCallback, useRef } from "react";
import type {
  EnvironmentRoute,
  RouteFailure,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";
import type { RepositoryChangeKind } from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  type EnvironmentRequests,
  useEnvironment,
} from "#web/platform/query/environment-context.tsx";
import { invalidatedByChange } from "#web/platform/query/environment-invalidation.ts";
import {
  environmentQueryKey,
  inputRepositoryId,
} from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import {
  type RequestFailure,
  requestFailure,
} from "#web/platform/query/request-failure.ts";

export interface CommandTarget {
  readonly repositoryId: string;
  readonly worktreePath: string;
}

export type CommandFailure<Route extends EnvironmentRoute> = RequestFailure<
  RouteFailure<Route>
>;

export type CommandResult<Route extends EnvironmentRoute> =
  | { readonly _tag: "Ok"; readonly value: RouteSuccess<Route> }
  | CommandFailure<Route>;

export type CommandInput<Route extends EnvironmentRoute> =
  RouteInput<Route> extends CommandTarget
    ? Omit<RouteInput<Route>, keyof CommandTarget>
    : RouteInput<Route>;

export interface CommandAnswer {
  readonly route: EnvironmentRoute;
  readonly input: unknown;
  readonly value: unknown;
  readonly version?: string;
}

type AnswerValue<Read extends EnvironmentRoute> =
  | RouteSuccess<Read>
  | ((current: RouteSuccess<Read> | undefined) => RouteSuccess<Read>);

export interface CommandOptions<Route extends EnvironmentRoute> {
  readonly target?: CommandTarget | undefined;
  readonly changes?: RepositoryChangeKind;
  readonly before?: (input: RouteInput<Route>) => Promise<boolean>;
  readonly progress?: (percent: number) => void;
  readonly answers?: (
    value: RouteSuccess<Route>,
    input: RouteInput<Route>,
  ) => readonly CommandAnswer[];
}

export interface CommandRun<Route extends EnvironmentRoute> {
  readonly input: RouteInput<Route>;
  readonly value: RouteSuccess<Route>;
  readonly submittedAt: number;
}

export interface CommandState<Route extends EnvironmentRoute> {
  readonly pending: boolean;
  readonly result: CommandResult<Route> | undefined;
  readonly input: RouteInput<Route> | undefined;
  readonly submittedAt: number;
}

export function answer<Read extends EnvironmentRoute>(
  route: Read,
  input: RouteInput<Read>,
  value: AnswerValue<Read>,
  version?: string,
): CommandAnswer {
  return { route, input, value, ...(version === undefined ? {} : { version }) };
}

export function useCommand<Route extends EnvironmentRoute>(
  route: Route,
  {
    target: explicitTarget,
    changes,
    before,
    progress,
    answers,
  }: CommandOptions<Route> = {},
) {
  const scope = useRepositoryScope();
  const environment = useEnvironment();
  const queryClient = useQueryClient();
  const scoped = targetsRepository(route);
  const target = scoped ? (explicitTarget ?? scope) : undefined;
  const key = commandKey(
    route,
    target ??
      (requestHas(route, "repositoryId") && scope !== undefined
        ? { repositoryId: scope.repositoryId }
        : undefined),
  );
  const running = useRef<AbortController | undefined>(undefined);
  const mutation = useMutation<CommandResult<Route>, never, RouteInput<Route>>({
    mutationKey: key,
    mutationFn: async (input) => {
      const ready = await prepare(before, input);
      if (ready !== undefined) return ready;
      const result = await request(
        environment.requests,
        route,
        input,
        running,
        progress,
      );
      await settle(queryClient, environment.environmentId, input, result, {
        repositoryId: scoped ? inputRepositoryId(input) : null,
        changes,
        answers,
      });
      return result;
    },
  });
  const runs = useMutationState({
    filters: { mutationKey: key },
    select: ({ state }): CommandState<Route> => ({
      pending: state.status === "pending",
      result: state.data as CommandResult<Route> | undefined,
      input: state.variables as RouteInput<Route> | undefined,
      submittedAt: state.submittedAt,
    }),
  });
  const { mutateAsync, reset } = mutation;
  const run = useCallback(
    (input: CommandInput<Route>) => {
      if (scoped && target === undefined)
        throw new Error(`${route._tag} needs a repository target.`);
      return mutateAsync(
        (target === undefined
          ? input
          : {
              ...(input as object),
              repositoryId: target.repositoryId,
              worktreePath: target.worktreePath,
            }) as RouteInput<Route>,
      );
    },
    [mutateAsync, route._tag, scoped, target],
  );
  const cancel = useCallback(() => running.current?.abort(), []);
  const result = mutation.data;
  const observed = scoped && target === undefined ? [] : runs;
  return {
    run,
    cancel,
    reset,
    canRun:
      environment.connected &&
      environment.environmentId !== undefined &&
      (!scoped || target !== undefined),
    running: observed.some(({ pending }) => pending),
    lastOk: lastOk(observed),
    latest: observed.at(-1),
    failure: result === undefined || result._tag === "Ok" ? undefined : result,
    input: mutation.variables,
  };
}

export type Command<Route extends EnvironmentRoute> = ReturnType<
  typeof useCommand<Route>
>;

function commandKey(
  route: EnvironmentRoute,
  target: Partial<CommandTarget> | undefined,
) {
  return [
    "command",
    route._tag,
    ...(target?.repositoryId === undefined ? [] : [target.repositoryId]),
    ...(target?.worktreePath === undefined ? [] : [target.worktreePath]),
  ];
}

function targetsRepository(route: EnvironmentRoute) {
  return requestHas(route, "repositoryId") && requestHas(route, "worktreePath");
}

function requestHas(route: EnvironmentRoute, field: string) {
  const request = route.payloadSchema as { readonly fields?: object };
  return request.fields !== undefined && field in request.fields;
}

async function prepare<Input>(
  before: ((input: Input) => Promise<boolean>) | undefined,
  input: Input,
): Promise<RequestFailure<never> | undefined> {
  if (before === undefined) return undefined;
  const ready = await before(input).catch(() => undefined);
  if (ready === undefined) return { _tag: "Unanswered" };
  return ready ? undefined : { _tag: "Cancelled" };
}

async function request<Route extends EnvironmentRoute>(
  requests: EnvironmentRequests,
  route: Route,
  input: RouteInput<Route>,
  running: RefObject<AbortController | undefined>,
  progress: ((percent: number) => void) | undefined,
): Promise<CommandResult<Route>> {
  const controller = new AbortController();
  running.current = controller;
  try {
    const value = await requests(route, input, {
      signal: controller.signal,
      ...(progress === undefined ? {} : { progress }),
    });
    return controller.signal.aborted
      ? { _tag: "Cancelled" }
      : { _tag: "Ok", value };
  } catch (error) {
    return controller.signal.aborted
      ? { _tag: "Cancelled" }
      : requestFailure(error);
  } finally {
    if (running.current === controller) running.current = undefined;
  }
}

async function settle<Route extends EnvironmentRoute>(
  queryClient: QueryClient,
  environmentId: string | undefined,
  input: RouteInput<Route>,
  result: CommandResult<Route>,
  {
    repositoryId,
    changes,
    answers,
  }: {
    readonly repositoryId: string | null;
    readonly changes: RepositoryChangeKind | undefined;
    readonly answers: CommandOptions<Route>["answers"];
  },
) {
  if (result._tag === "Cancelled") return;
  const answered =
    result._tag === "Ok" && answers !== undefined
      ? await writeAnswers(
          queryClient,
          environmentId,
          answers(result.value, input),
        )
      : new Set<string>();
  const waits = result._tag === "Ok" && answered.size === 0;
  const stale = (query: Query) =>
    !answered.has(query.queryHash) && readsFrom(query, repositoryId, changes);
  void queryClient.invalidateQueries(
    { predicate: (query) => stale(query) && query.meta?.changes === "index" },
    { cancelRefetch: false },
  );
  const rereads = queryClient.invalidateQueries(
    { predicate: (query) => stale(query) && query.meta?.changes !== "index" },
    { cancelRefetch: waits },
  );
  if (waits) await rereads;
}

async function writeAnswers(
  queryClient: QueryClient,
  environmentId: string | undefined,
  answers: readonly CommandAnswer[],
) {
  const answered = new Set<string>();
  for (const { route, input, value, version } of answers) {
    const repositoryId = inputRepositoryId(input);
    const queryKey = environmentQueryKey(
      environmentId,
      repositoryId,
      route,
      input,
      version,
    );
    if (
      typeof value === "function" &&
      queryClient.getQueryData(queryKey) === undefined
    )
      continue;
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData(queryKey, value);
    const hash = hashKey(queryKey);
    if (version !== undefined)
      dropOtherVersions(
        queryClient,
        environmentQueryKey(environmentId, repositoryId, route, input),
        hash,
      );
    answered.add(hash);
  }
  return answered;
}

function dropOtherVersions(
  queryClient: QueryClient,
  queryKey: QueryKey,
  kept: string,
) {
  queryClient.removeQueries({
    queryKey,
    predicate: (query) =>
      query.queryHash !== kept && query.getObserversCount() === 0,
  });
}

function readsFrom(
  query: Query,
  repositoryId: string | null,
  changes: RepositoryChangeKind | undefined,
) {
  return repositoryId === null
    ? query.meta?.repositoryId === null
    : invalidatedByChange(query.meta, [repositoryId], changes);
}

function lastOk<Route extends EnvironmentRoute>(
  runs: readonly CommandState<Route>[],
): CommandRun<Route> | undefined {
  const last = runs.findLast(({ result }) => result?._tag === "Ok");
  return last?.result?._tag === "Ok" && last.input !== undefined
    ? {
        input: last.input,
        value: last.result.value,
        submittedAt: last.submittedAt,
      }
    : undefined;
}
