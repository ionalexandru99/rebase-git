import type { RouteInput, RouteSuccess } from "@rebase/contracts";
import {
  type EnvironmentRouteFailure,
  environmentRouteFailure,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import {
  hashKey,
  keepPreviousData,
  type QueryClient,
  type SkipToken,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import type { EnvironmentChangeScope } from "#web/platform/query/environment-query-meta";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

export interface EnvironmentQueryOptions<Data> {
  readonly enabled?: boolean;
  readonly changes: EnvironmentChangeScope;
  readonly version?: string;
  readonly staleTime?: number;
  readonly gcTime?: number;
  readonly select?: (data: Data) => Data;
  readonly refetchInterval?: number;
  readonly refetchOnWindowFocus?: boolean | "always";
  readonly keepPrevious?: boolean;
}

export function environmentQueryKey<
  Route extends RequestableEnvironmentHttpRoute,
>(
  environmentId: string | undefined,
  repositoryId: string | null,
  route: Route,
  input: RouteInput<Route> | null,
  version?: string,
) {
  return [
    "environment",
    environmentId ?? null,
    repositoryId,
    route.path,
    input,
    ...(version === undefined ? [] : [version]),
  ] as const;
}

export function useEnvironmentQuery<
  Route extends RequestableEnvironmentHttpRoute,
>(
  route: Route,
  input: RouteInput<Route> | SkipToken,
  {
    enabled = true,
    changes,
    version,
    keepPrevious = false,
    ...queryOptions
  }: EnvironmentQueryOptions<RouteSuccess<Route>>,
) {
  const { environmentId, requests, connected } = useEnvironment();
  const repositoryId = input === skipToken ? null : inputRepositoryId(input);
  const queryKey = environmentQueryKey(
    environmentId,
    repositoryId,
    route,
    input === skipToken ? null : input,
    version,
  );
  const active = connected && environmentId !== undefined && enabled;
  const query = useQuery<RouteSuccess<Route>, EnvironmentRouteFailure<Route>>({
    ...queryOptions,
    queryKey,
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
    enabled: active,
    meta: { changes, repositoryId },
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });
  useCancelWhileInactive(useQueryClient(), hashKey(queryKey), active);
  return query;
}

function useCancelWhileInactive(
  queryClient: QueryClient,
  queryHash: string,
  active: boolean,
) {
  useEffect(() => {
    if (active) return;
    const query = queryClient.getQueryCache().get(queryHash);
    if (query !== undefined && !query.isActive())
      void query.cancel({ revert: true });
  }, [active, queryClient, queryHash]);
}

function inputRepositoryId(input: unknown) {
  return typeof input === "object" &&
    input !== null &&
    "repositoryId" in input &&
    typeof input.repositoryId === "string"
    ? input.repositoryId
    : null;
}
