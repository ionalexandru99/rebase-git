import type { RouteInput, RouteSuccess } from "@rebase/contracts";
import {
  type EnvironmentRouteFailure,
  environmentRouteFailure,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import { type SkipToken, skipToken, useQuery } from "@tanstack/react-query";
import type { EnvironmentChangeScope } from "#web/platform/query/environment-query-meta";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

export interface EnvironmentQueryOptions {
  readonly enabled?: boolean;
  readonly changes: EnvironmentChangeScope;
  readonly refetchInterval?: number;
  readonly refetchOnWindowFocus?: boolean | "always";
}

export function environmentQueryKey<
  Route extends RequestableEnvironmentHttpRoute,
>(
  environmentId: string | undefined,
  repositoryId: string | null,
  route: Route,
  input: RouteInput<Route> | null,
) {
  return [
    "environment",
    environmentId ?? null,
    repositoryId,
    route.path,
    input,
  ] as const;
}

export function useEnvironmentQuery<
  Route extends RequestableEnvironmentHttpRoute,
>(
  route: Route,
  input: RouteInput<Route> | SkipToken,
  options: EnvironmentQueryOptions,
) {
  const { environmentId, requests, connected } = useEnvironment();
  const repositoryId = input === skipToken ? null : inputRepositoryId(input);
  return useQuery<RouteSuccess<Route>, EnvironmentRouteFailure<Route>>({
    queryKey: environmentQueryKey(
      environmentId,
      repositoryId,
      route,
      input === skipToken ? null : input,
    ),
    queryFn:
      input === skipToken
        ? skipToken
        : async ({ signal }) => {
            try {
              return await requests(route, input, { signal });
            } catch (error) {
              throw environmentRouteFailure(route, error);
            }
          },
    enabled:
      connected && environmentId !== undefined && (options.enabled ?? true),
    meta: { changes: options.changes, repositoryId },
    ...(options.refetchInterval === undefined
      ? {}
      : { refetchInterval: options.refetchInterval }),
    ...(options.refetchOnWindowFocus === undefined
      ? {}
      : { refetchOnWindowFocus: options.refetchOnWindowFocus }),
  });
}

function inputRepositoryId(input: unknown) {
  return typeof input === "object" &&
    input !== null &&
    "repositoryId" in input &&
    typeof input.repositoryId === "string"
    ? input.repositoryId
    : null;
}
