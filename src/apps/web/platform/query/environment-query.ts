import type {
  EnvironmentRoute,
  RouteFailure,
  RouteInput,
  RouteSuccess,
} from "@rebase/contracts";
import {
  hashKey,
  keepPreviousData,
  type Query,
  type QueryClient,
  type SkipToken,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { useEnvironment } from "#web/platform/query/environment-context";
import type { EnvironmentChangeScope } from "#web/platform/query/environment-query-meta";
import {
  type RequestFailure,
  requestFailure,
} from "#web/platform/query/request-failure";

export type QueryFailure<Route extends EnvironmentRoute> = RequestFailure<
  RouteFailure<Route>
>;

export interface EnvironmentQueryOptions<Data> {
  readonly enabled?: boolean;
  readonly changes: EnvironmentChangeScope;
  readonly persist?: boolean;
  readonly version?: string;
  readonly staleTime?: number;
  readonly gcTime?: number;
  readonly select?: (data: Data) => Data;
  readonly refetchInterval?: number;
  readonly refetchOnWindowFocus?: boolean | "always";
  readonly refetchOnMount?: boolean;
  readonly keepPrevious?: boolean;
}

export function environmentQueryKey<Route extends EnvironmentRoute>(
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
    route._tag,
    input,
    ...(version === undefined ? [] : [version]),
  ] as const;
}

export function isRouteQuery(
  query: Query,
  route: EnvironmentRoute,
  environmentId?: string,
) {
  const [, queryEnvironmentId, , tag] = query.queryKey;
  return (
    tag === route._tag &&
    (environmentId === undefined || queryEnvironmentId === environmentId)
  );
}

export function useEnvironmentQuery<Route extends EnvironmentRoute>(
  route: Route,
  input: RouteInput<Route> | SkipToken,
  {
    enabled = true,
    changes,
    persist = false,
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
  const query = useQuery<RouteSuccess<Route>, QueryFailure<Route>>({
    ...queryOptions,
    queryKey,
    queryFn:
      input === skipToken
        ? skipToken
        : async ({ signal }) => {
            try {
              return await requests(route, input, { signal });
            } catch (error) {
              throw requestFailure(error);
            }
          },
    enabled: active,
    meta: { changes, repositoryId, persist },
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

export function inputRepositoryId(input: unknown) {
  return typeof input === "object" &&
    input !== null &&
    "repositoryId" in input &&
    typeof input.repositoryId === "string"
    ? input.repositoryId
    : null;
}
