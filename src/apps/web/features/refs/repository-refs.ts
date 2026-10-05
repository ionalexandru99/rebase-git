import { type Query, type QueryClient, skipToken } from "@tanstack/react-query";
import { useRef } from "react";
import {
  type RepositoryRefs,
  RepositoryRefsApi,
  type RepositoryRefTarget,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  isRouteQuery,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

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
  const retry = () => void refetch();
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
  const errorToast = useErrorToast();
  const { run } = checkout;
  const checkingOut = useRef(false);
  const select = (target: RepositoryRefTarget) => {
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
      void run({ target: activation.target })
        .then((result) =>
          errorToast.failure("checkout", result, {
            CheckoutRejected: ({ reason }) =>
              reason === "StashFailed"
                ? "Local changes could not be stashed."
                : "Local changes would be overwritten.",
          }),
        )
        .finally(() => {
          checkingOut.current = false;
        });
    }
  };
  return { select, checkingOut: checkout.running };
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
  const present = refs.worktrees.filter((worktree) => !worktree.missing);
  if (present.some((worktree) => worktree.path === preferredPath)) {
    return preferredPath;
  }
  return (
    present.find((worktree) => worktree.main)?.path ??
    present[0]?.path ??
    preferredPath
  );
}

export type RefSourceTarget = RepositoryRefTarget | string;

export interface RefSource {
  readonly label: string;
  readonly ref: string | null;
  readonly commit: string;
}

export function refSource(
  refs: RepositoryRefs,
  target: RefSourceTarget,
): RefSource | undefined {
  if (typeof target === "string") {
    const branch = refs.branches.find((local) => local.target === target);
    if (branch !== undefined)
      return { label: branch.name, ref: branch.name, commit: target };
    const remote = refs.remoteBranches.find((ref) => ref.target === target);
    if (remote !== undefined)
      return remoteSource(remote.remote, remote.name, target);
    return { label: target.slice(0, 8), ref: null, commit: target };
  }
  switch (target._tag) {
    case "LocalBranch": {
      const commit = refs.branches.find(
        ({ name }) => name === target.name,
      )?.target;
      return commit === undefined
        ? undefined
        : { label: target.name, ref: target.name, commit };
    }
    case "RemoteBranch": {
      const commit = refs.remoteBranches.find(
        ({ name, remote }) => name === target.name && remote === target.remote,
      )?.target;
      return commit === undefined
        ? undefined
        : remoteSource(target.remote, target.name, commit);
    }
    case "Tag": {
      const commit = refs.tags.find(({ name }) => name === target.name)?.target;
      return commit === undefined
        ? undefined
        : { label: target.name, ref: target.name, commit };
    }
  }
}

function remoteSource(remote: string, name: string, commit: string) {
  const ref = `${remote}/${name}`;
  return { label: ref, ref, commit };
}
