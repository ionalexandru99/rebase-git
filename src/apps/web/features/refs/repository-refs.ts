import {
  type RepositoryRefs,
  RepositoryRefsApi,
  type RepositoryRefTarget,
} from "@rebase/contracts";
import { type Query, type QueryClient, skipToken } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { RepositoryHistoryObservation } from "#web/features/repository-history/repository-history-reader";
import {
  isRouteQuery,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { describeFailure } from "#web/platform/query/request-failure";
import { useCommand } from "#web/platform/query/use-command";

export interface RepositoryRefsRead {
  readonly refs: RepositoryRefs | undefined;
  readonly restored: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

export type RepositoryRefActivation =
  | { readonly _tag: "AlreadyCurrent" }
  | { readonly _tag: "Checkout"; readonly target: RepositoryRefTarget }
  | { readonly _tag: "SwitchWorktree"; readonly worktreePath: string };

export interface RefActivation {
  readonly select: (target: RepositoryRefTarget) => void;
  readonly checkingOut: boolean;
  readonly error: string | null;
}

export function useRepositoryRefs(
  repositoryId: string | undefined,
): RepositoryRefsRead {
  const query = useEnvironmentQuery(
    RepositoryRefsApi.read,
    repositoryId === undefined ? skipToken : { repositoryId },
    { changes: "refs", persist: true, gcTime: Number.POSITIVE_INFINITY },
  );
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  return {
    refs: query.data,
    restored: query.data !== undefined && query.dataUpdatedAt === 0,
    loading:
      query.data === undefined && !query.isError && repositoryId !== undefined,
    error: query.isError ? describeFailure(query.error) : null,
    retry,
  };
}

export function useScopedRepositoryRefs() {
  const scope = useRepositoryScope();
  return useRepositoryRefs(scope?.repositoryId);
}

export function useHistoryRefRefresh(
  reader: RepositoryHistoryObservation | undefined,
  connected: boolean,
  refresh: () => void,
) {
  useEffect(() => {
    if (reader === undefined || !connected) return;
    let completedRevision = reader.getSnapshot().historyRevision;
    return reader.subscribe(() => {
      const snapshot = reader.getSnapshot();
      if (
        snapshot.synchronization !== "complete" ||
        snapshot.historyRevision === completedRevision
      )
        return;
      completedRevision = snapshot.historyRevision;
      refresh();
    });
  }, [connected, reader, refresh]);
}

export function forgetRepositoryRefs(
  queryClient: QueryClient,
  environmentId: string,
  logicalRepositoryId: string,
) {
  forget(
    queryClient,
    (query) =>
      isRouteQuery(query, RepositoryRefsApi.read, environmentId) &&
      (query.meta?.repositoryId === logicalRepositoryId ||
        (query.state.data as RepositoryRefs | undefined)
          ?.logicalRepositoryId === logicalRepositoryId),
  );
}

export function forgetAllRepositoryRefs(queryClient: QueryClient) {
  forget(queryClient, (query) => isRouteQuery(query, RepositoryRefsApi.read));
}

function forget(
  queryClient: QueryClient,
  predicate: (query: Query) => boolean,
) {
  queryClient.removeQueries({ predicate, type: "inactive" });
  void queryClient.resetQueries({ predicate });
}

export function useRefActivation({
  refs,
  restored,
}: RepositoryRefsRead): RefActivation {
  const scope = useRepositoryScope();
  const checkout = useCommand(RepositoryRefsApi.checkout);
  const { run } = checkout;
  const checkingOut = useRef(false);
  const select = useCallback(
    (target: RepositoryRefTarget) => {
      if (
        scope === undefined ||
        refs === undefined ||
        restored ||
        checkingOut.current
      )
        return;
      const activation = resolveRefActivation(refs, scope.worktreePath, target);
      if (activation._tag === "SwitchWorktree")
        scope.switchWorktree(activation.worktreePath);
      else if (activation._tag === "Checkout") {
        checkingOut.current = true;
        void run({ target: activation.target }).finally(() => {
          checkingOut.current = false;
        });
      }
    },
    [run, refs, restored, scope],
  );
  return {
    select,
    checkingOut: checkout.running,
    error:
      checkout.failure === undefined
        ? null
        : describeFailure(checkout.failure, {
            CheckoutRejected: ({ reason }) =>
              reason === "StashFailed"
                ? "Local changes could not be stashed."
                : "Local changes would be overwritten.",
          }),
  };
}

export function resolveRefActivation(
  refs: RepositoryRefs,
  activeWorktreePath: string,
  target: RepositoryRefTarget,
): RepositoryRefActivation {
  if (target._tag === "RemoteBranch") {
    return refs.branches.some(
      (branch) =>
        branch.name === target.name &&
        (branch.upstream === undefined ||
          branch.upstream.name === `${target.remote}/${target.name}`),
    )
      ? resolveRefActivation(refs, activeWorktreePath, {
          _tag: "LocalBranch",
          name: target.name,
        })
      : { _tag: "Checkout", target };
  }
  if (target._tag === "Tag") return { _tag: "Checkout", target };

  const branch = refs.branches.find(
    (candidate) => candidate.name === target.name,
  );
  if (
    branch?.worktreePath !== undefined &&
    branch.worktreePath !== activeWorktreePath
  ) {
    return { _tag: "SwitchWorktree", worktreePath: branch.worktreePath };
  }
  return activeHead(refs, activeWorktreePath)?.branch === target.name
    ? { _tag: "AlreadyCurrent" }
    : { _tag: "Checkout", target };
}

export function activeHead(refs: RepositoryRefs, activeWorktreePath: string) {
  return refs.worktrees.find((worktree) => worktree.path === activeWorktreePath)
    ?.head;
}

export function resolveActiveWorktreePath(
  refs: RepositoryRefs,
  preferredPath: string,
): string {
  if (refs.worktrees.some((worktree) => worktree.path === preferredPath)) {
    return preferredPath;
  }
  return (
    refs.worktrees.find((worktree) => worktree.main)?.path ??
    refs.worktrees[0]?.path ??
    preferredPath
  );
}
