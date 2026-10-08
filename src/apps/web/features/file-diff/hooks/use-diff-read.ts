import { type SkipToken, skipToken } from "@tanstack/react-query";
import { useState } from "react";
import type {
  EnvironmentRoute,
  RouteInput,
} from "#contracts/environment-connection/environment-route.contract.ts";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import {
  type EnvironmentQueryOptions,
  useEnvironmentFetch,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query.ts";
import {
  describeFailure,
  type TaggedFailure,
} from "#web/platform/query/request-failure.ts";

interface DiffRoute extends EnvironmentRoute {
  readonly payloadSchema: EnvironmentRoute["payloadSchema"] & {
    readonly Type: { readonly whole?: boolean | undefined };
  };
  readonly successSchema: EnvironmentRoute["successSchema"] & {
    readonly Type: ChangeDiff;
  };
  readonly errorSchema: EnvironmentRoute["errorSchema"] & {
    readonly Type: TaggedFailure;
  };
}

export interface DiffRead {
  readonly value: ChangeDiff | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
  readonly expanded: boolean;
  readonly expand: (expanded: boolean) => void;
  readonly loadWhole: (() => Promise<ChangeDiff>) | undefined;
}

export function useDiffRead<Route extends DiffRoute>(
  route: Route,
  input: RouteInput<Route> | SkipToken,
  options: EnvironmentQueryOptions<ChangeDiff>,
): DiffRead {
  const [expandedRevision, setExpandedRevision] = useState<string | null>(null);
  const read = useEnvironmentQuery(route, input, options);
  const fetchDiff = useEnvironmentFetch(route, options);
  const revision = read.data?.revision ?? null;
  const expanded = revision !== null && revision === expandedRevision;
  const whole = useEnvironmentQuery(
    route,
    input !== skipToken && expanded && read.data?.kind === "partial"
      ? { ...input, whole: true }
      : skipToken,
    { ...options, keepPrevious: false },
  );
  const failed = whole.isError ? whole : read;
  return {
    value: whole.data ?? read.data,
    loading: read.isLoading || whole.isLoading,
    error: failed.isError ? describeFailure(failed.error) : null,
    retry: () => void failed.refetch(),
    expanded,
    expand: (next) => setExpandedRevision(next ? revision : null),
    loadWhole:
      input === skipToken
        ? undefined
        : () => fetchDiff({ ...input, whole: true }),
  };
}
