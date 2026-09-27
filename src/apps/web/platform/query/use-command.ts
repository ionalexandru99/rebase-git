import type {
  EnvironmentRoute,
  RouteFailure,
  RouteInput,
  RouteSuccess,
} from "@rebase/contracts";
import {
  hashKey,
  type Query,
  type QueryClient,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import { type RefObject, useCallback, useRef } from "react";
import {
  type EnvironmentRequests,
  useEnvironment,
} from "#web/platform/query/environment-context";
import { invalidatedByChange } from "#web/platform/query/environment-invalidation";
import {
  environmentQueryKey,
  inputRepositoryId,
} from "#web/platform/query/environment-query";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import {
  type RequestFailure,
  requestFailure,
} from "#web/platform/query/request-failure";

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
  readonly before?: () => Promise<boolean>;
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
  { target: explicitTarget, before, answers }: CommandOptions<Route> = {},
) {
  const scope = useRepositoryScope();
  const environment = useEnvironment();
  const queryClient = useQueryClient();
  const scoped = targetsRepository(route);
  const target = scoped ? (explicitTarget ?? scope) : undefined;
  const key = commandKey(route, target);
  const running = useRef<AbortController | undefined>(undefined);
  const mutation = useMutation<CommandResult<Route>, never, RouteInput<Route>>({
    mutationKey: key,
    mutationFn: async (input) => {
      const ready = await prepare(before);
      if (ready !== undefined) return ready;
      const result = await request(environment.requests, route, input, running);
      await settle(queryClient, environment.environmentId, input, result, {
        repositoryId: scoped ? inputRepositoryId(input) : null,
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
  target: CommandTarget | undefined,
) {
  return [
    "command",
    route._tag,
    ...(target === undefined ? [] : [target.repositoryId, target.worktreePath]),
  ];
}

function targetsRepository(route: EnvironmentRoute) {
  const request = route.payloadSchema as { readonly fields?: object };
  return (
    request.fields !== undefined &&
    "repositoryId" in request.fields &&
    "worktreePath" in request.fields
  );
}

async function prepare(
  before: (() => Promise<boolean>) | undefined,
): Promise<RequestFailure<never> | undefined> {
  if (before === undefined) return undefined;
  const ready = await before().catch(() => undefined);
  if (ready === undefined) return { _tag: "Unanswered" };
  return ready ? undefined : { _tag: "Cancelled" };
}

async function request<Route extends EnvironmentRoute>(
  requests: EnvironmentRequests,
  route: Route,
  input: RouteInput<Route>,
  running: RefObject<AbortController | undefined>,
): Promise<CommandResult<Route>> {
  const controller = new AbortController();
  running.current = controller;
  try {
    const value = await requests(route, input, { signal: controller.signal });
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
    answers,
  }: {
    readonly repositoryId: string | null;
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
    !answered.has(query.queryHash) && readsFrom(query, repositoryId);
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
    const queryKey = environmentQueryKey(
      environmentId,
      inputRepositoryId(input),
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
    answered.add(hashKey(queryKey));
  }
  return answered;
}

function readsFrom(query: Query, repositoryId: string | null) {
  return repositoryId === null
    ? query.meta?.repositoryId === null
    : invalidatedByChange(query.meta, [repositoryId]);
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
