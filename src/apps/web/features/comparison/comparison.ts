import {
  type ComparisonSide,
  isComparisonSide,
} from "#contracts/repository-comparison/compare-revisions.contract.ts";
import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import type { RepositoryHead } from "#contracts/repository-refs/repository-refs.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export interface CompareInput {
  readonly _tag: "Compare";
  readonly from: ComparisonSide;
  readonly to: ComparisonSide;
}

export function isCompareInput(input: unknown): input is CompareInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "_tag" in input &&
    input._tag === "Compare" &&
    "from" in input &&
    isComparisonSide(input.from) &&
    "to" in input &&
    isComparisonSide(input.to)
  );
}

export function compareTab(input: unknown) {
  if (!isCompareInput(input)) return undefined;
  return {
    key: `${sideKey(input.from)}...${sideKey(input.to)}`,
    title: sideName(input.to),
    context: sideName(input.from),
  };
}

function sideKey(side: ComparisonSide) {
  return `${side._tag}/${sideName(side)}`;
}

export function sideName(side: ComparisonSide) {
  switch (side._tag) {
    case "RemoteBranch":
      return `${side.remote}/${side.name}`;
    case "Commit":
      return side.oid.slice(0, 8);
    default:
      return side.name;
  }
}

export function sideLabel(
  side: ComparisonSide,
): Pick<RepositoryHistoryRefTarget, "name" | "type"> {
  const type =
    side._tag === "LocalBranch"
      ? "branch"
      : side._tag === "RemoteBranch"
        ? "remote-branch"
        : side._tag === "Tag"
          ? "tag"
          : "commit";
  return { name: sideName(side), type };
}

export interface CompareActions {
  readonly actionFor: (
    target: ComparisonSide | string,
  ) => Action<"compare"> | undefined;
  readonly pairFor: (
    oids: readonly string[],
  ) => Action<"compareTwo"> | undefined;
}

export function useCompareActions(
  history: Pick<RepositoryHistory, "ask"> | undefined,
  open: (input: CompareInput) => void,
): CompareActions {
  const scope = useRepositoryScope();
  const errorToast = useErrorToast();
  const { refs } = useScopedRepositoryRefs();
  const head =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath);
  const compare = (from: ComparisonSide, to: ComparisonSide) =>
    open({ _tag: "Compare", from, to });
  return {
    actionFor: (target) => {
      const to: ComparisonSide =
        typeof target === "string" ? { _tag: "Commit", oid: target } : target;
      if (head === undefined || isCurrent(to, head)) return undefined;
      return {
        id: "compare",
        label: "Compare with current",
        enabled: true,
        run: () =>
          compare(
            head.branch === undefined
              ? { _tag: "Commit", oid: head.commit }
              : { _tag: "LocalBranch", name: head.branch },
            to,
          ),
      };
    },
    pairFor: (oids) => {
      if (oids.length !== 2 || history === undefined) return undefined;
      return {
        id: "compareTwo",
        label: "Compare these two",
        enabled: true,
        run: () =>
          void history.ask({ _tag: "Commits", oids }).then(
            (commits) => {
              const [older, newer] = [...commits].sort(
                (left, right) =>
                  left.committer.timestampSeconds -
                  right.committer.timestampSeconds,
              );
              if (older !== undefined && newer !== undefined)
                compare(
                  { _tag: "Commit", oid: older.oid },
                  { _tag: "Commit", oid: newer.oid },
                );
            },
            () => errorToast.show("compare"),
          ),
      };
    },
  };
}

function isCurrent(side: ComparisonSide, head: RepositoryHead) {
  return side._tag === "Commit"
    ? side.oid === head.commit
    : side._tag === "LocalBranch" && side.name === head.branch;
}
