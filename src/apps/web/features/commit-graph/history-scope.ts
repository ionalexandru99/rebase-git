import type {
  LocalBranch,
  RepositoryHistoryRefTarget,
  RepositoryRefs,
  RepositoryRefTarget,
} from "@rebase/contracts";
import {
  automaticHistoryScope,
  type HistoryScope,
  type ResolvedHistoryScope,
} from "#web/features/commit-graph/history-scope.contract";
import {
  resolveAutomaticHistoryRoots,
  resolveAutomaticHistorySelections,
} from "#web/features/repository-history/automatic-history-roots";

export type {
  HistoryScope,
  ResolvedHistoryScope,
} from "#web/features/commit-graph/history-scope.contract";
export { automaticHistoryScope } from "#web/features/commit-graph/history-scope.contract";

export function resolveHistoryScope(
  scope: HistoryScope,
  refs: RepositoryRefs,
  activeWorktreePath: string,
): ResolvedHistoryScope {
  if (scope._tag === "Automatic") {
    const selections = resolveAutomaticHistorySelections(
      refs,
      activeWorktreePath,
    );
    return resolved(
      scope,
      selections,
      resolveAutomaticHistoryRoots(refs, activeWorktreePath),
      refs,
    );
  }

  const selections = uniqueSelections(
    scope.selections.filter((selection) => selectionExists(selection, refs)),
  );
  if (selections.length === 0) {
    return resolveHistoryScope(automaticHistoryScope, refs, activeWorktreePath);
  }
  const reconciled: HistoryScope = { _tag: "Custom", selections };
  return resolved(
    reconciled,
    selections,
    selections.flatMap((selection) => selectionRoots(selection, refs)),
    refs,
  );
}

export function toggleHistoryRef(
  scope: HistoryScope,
  target: RepositoryRefTarget,
  refs: RepositoryRefs,
  activeWorktreePath: string,
): HistoryScope {
  const current = resolveHistoryScope(scope, refs, activeWorktreePath);
  const targetKey = historyRefKey(target);
  const retained = current.selections.filter(
    (selection) =>
      !selectionTargets(selection, refs).some(
        (candidate) => historyRefKey(candidate) === targetKey,
      ),
  );
  const next =
    retained.length === current.selections.length
      ? [...current.selections, target]
      : retained;
  return next.length === 0
    ? automaticHistoryScope
    : { _tag: "Custom", selections: uniqueSelections(next) };
}

export function historyRefKey(target: RepositoryRefTarget): string {
  switch (target._tag) {
    case "LocalBranch":
      return `branch\0${target.name}`;
    case "RemoteBranch":
      return `remote-branch\0${target.remote}\0${target.name}`;
    case "Tag":
      return `tag\0${target.name}`;
  }
}

export function historyScopesEqual(left: HistoryScope, right: HistoryScope) {
  if (left._tag !== right._tag) return false;
  if (left._tag === "Automatic" || right._tag === "Automatic") return true;
  return (
    left.selections.length === right.selections.length &&
    left.selections.every((selection, index) => {
      const candidate = right.selections[index];
      return (
        candidate !== undefined &&
        historyRefKey(selection) === historyRefKey(candidate)
      );
    })
  );
}

function resolved(
  scope: HistoryScope,
  selections: readonly RepositoryRefTarget[],
  roots: readonly RepositoryHistoryRefTarget[],
  refs: RepositoryRefs,
): ResolvedHistoryScope {
  return {
    roots: uniqueRoots(roots),
    scope,
    selectedRefKeys: new Set(
      selections.flatMap((selection) =>
        selectionTargets(selection, refs).map(historyRefKey),
      ),
    ),
    selections,
  };
}

function selectionExists(selection: RepositoryRefTarget, refs: RepositoryRefs) {
  switch (selection._tag) {
    case "LocalBranch":
      return refs.branches.some((branch) => branch.name === selection.name);
    case "RemoteBranch":
      return refs.remoteBranches.some(
        (branch) =>
          branch.remote === selection.remote && branch.name === selection.name,
      );
    case "Tag":
      return refs.tags.some((tag) => tag.name === selection.name);
  }
}

function selectionTargets(
  selection: RepositoryRefTarget,
  refs: RepositoryRefs,
): readonly RepositoryRefTarget[] {
  switch (selection._tag) {
    case "LocalBranch": {
      const branch = refs.branches.find(
        (candidate) => candidate.name === selection.name,
      );
      const upstream = findUpstream(branch, refs);
      return upstream === undefined
        ? [selection]
        : [selection, upstream.target];
    }
    case "RemoteBranch":
      return [
        selection,
        ...trackingBranches(selection, refs).map(
          (branch): RepositoryRefTarget => ({
            _tag: "LocalBranch",
            name: branch.name,
          }),
        ),
      ];
    case "Tag":
      return [selection];
  }
}

function selectionRoots(
  selection: RepositoryRefTarget,
  refs: RepositoryRefs,
): readonly RepositoryHistoryRefTarget[] {
  switch (selection._tag) {
    case "LocalBranch": {
      const branch = refs.branches.find(
        (candidate) => candidate.name === selection.name,
      );
      if (branch === undefined) return [];
      return [branchRoot(branch), findUpstream(branch, refs)?.root].filter(
        isDefined,
      );
    }
    case "RemoteBranch": {
      const remoteBranch = refs.remoteBranches.find(
        (branch) =>
          branch.remote === selection.remote && branch.name === selection.name,
      );
      return [
        remoteBranch?.target === undefined
          ? undefined
          : {
              name: `${remoteBranch.remote}/${remoteBranch.name}`,
              oid: remoteBranch.target,
              type: "remote-branch" as const,
            },
        ...trackingBranches(selection, refs).map(branchRoot),
      ].filter(isDefined);
    }
    case "Tag": {
      const tag = refs.tags.find(
        (candidate) => candidate.name === selection.name,
      );
      return tag?.target === undefined
        ? []
        : [{ name: tag.name, oid: tag.target, type: "tag" }];
    }
  }
}

function trackingBranches(
  selection: Extract<RepositoryRefTarget, { readonly _tag: "RemoteBranch" }>,
  refs: RepositoryRefs,
) {
  const upstreamName = `${selection.remote}/${selection.name}`;
  return refs.branches.filter(
    (branch) => branch.upstream?.name === upstreamName,
  );
}

function findUpstream(branch: LocalBranch | undefined, refs: RepositoryRefs) {
  if (branch?.upstream === undefined) return undefined;
  const separator = branch.upstream.name.indexOf("/");
  if (separator <= 0 || separator === branch.upstream.name.length - 1) {
    return undefined;
  }
  const remote = branch.upstream.name.slice(0, separator);
  const name = branch.upstream.name.slice(separator + 1);
  const upstream = refs.remoteBranches.find(
    (candidate) => candidate.remote === remote && candidate.name === name,
  );
  if (upstream?.target === undefined) return undefined;
  return {
    root: {
      name: `${remote}/${name}`,
      oid: upstream.target,
      type: "remote-branch" as const,
    },
    target: {
      _tag: "RemoteBranch" as const,
      name,
      remote,
    },
  };
}

function branchRoot(branch: LocalBranch) {
  return branch.target === undefined
    ? undefined
    : { name: branch.name, oid: branch.target, type: "branch" as const };
}

function uniqueSelections(selections: readonly RepositoryRefTarget[]) {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const key = historyRefKey(selection);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRoots(roots: readonly RepositoryHistoryRefTarget[]) {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = `${root.type}\0${root.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
