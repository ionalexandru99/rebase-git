import type { RouteInput, RouteSuccess } from "@rebase/contracts";
import {
  type EnvironmentRequestClient,
  type EnvironmentRouteFailure,
  environmentRouteFailure,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { type RefObject, useCallback, useRef } from "react";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

export class CommandCancelled extends Error {
  readonly _tag = "Cancelled";
}

export type CommandFailure<Route extends RequestableEnvironmentHttpRoute> =
  | EnvironmentRouteFailure<Route>
  | CommandCancelled;

export interface CommandScope {
  readonly repositoryId: string;
  readonly worktreePath?: string;
}

export type CommandOptions<Route extends RequestableEnvironmentHttpRoute> =
  Omit<
    UseMutationOptions<
      RouteSuccess<Route>,
      CommandFailure<Route>,
      RouteInput<Route>
    >,
    "mutationFn" | "mutationKey"
  > & { readonly repository?: CommandScope | undefined };

export function commandKey(
  route: RequestableEnvironmentHttpRoute,
  scope?: CommandScope,
) {
  return [
    "command",
    route.path,
    ...(scope === undefined ? [] : [scope.repositoryId]),
    ...(scope?.worktreePath === undefined ? [] : [scope.worktreePath]),
  ];
}

export function commandFailure<Route extends RequestableEnvironmentHttpRoute>(
  route: Route,
  error: unknown,
): CommandFailure<Route> {
  return error instanceof CommandCancelled
    ? error
    : environmentRouteFailure(route, error);
}

export function useCommand<Route extends RequestableEnvironmentHttpRoute>(
  route: Route,
  { repository, ...options }: CommandOptions<Route> = {},
) {
  const { requests } = useEnvironment();
  const running = useRef<AbortController | undefined>(undefined);
  const mutation = useMutation<
    RouteSuccess<Route>,
    CommandFailure<Route>,
    RouteInput<Route>
  >({
    ...options,
    mutationKey: commandKey(route, repository),
    mutationFn: (input) => runCommand(requests, route, input, running),
  });
  const cancel = useCallback(() => running.current?.abort(), []);
  return { ...mutation, cancel };
}

async function runCommand<Route extends RequestableEnvironmentHttpRoute>(
  requests: EnvironmentRequestClient,
  route: Route,
  input: RouteInput<Route>,
  running: RefObject<AbortController | undefined>,
) {
  const controller = new AbortController();
  running.current = controller;
  try {
    const value = await requests(route, input, { signal: controller.signal });
    if (controller.signal.aborted) throw new CommandCancelled();
    return value;
  } catch (error) {
    throw controller.signal.aborted
      ? new CommandCancelled()
      : environmentRouteFailure(route, error);
  } finally {
    if (running.current === controller) running.current = undefined;
  }
}
