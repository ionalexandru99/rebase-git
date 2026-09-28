import { Toast } from "@base-ui/react/toast";
import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import {
  activeHead,
  type RefSource,
  type RefSourceTarget,
  refSource,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { HistoryRange } from "#web/features/repository-history/history-graph.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export interface RebaseActions {
  readonly actionFor: (target: RefSourceTarget) => Action<"rebase"> | undefined;
  readonly inspect: (target: RefSourceTarget) => void;
  readonly moving: (target: RefSourceTarget) => readonly string[];
}

export function useRebaseActions(
  history: Pick<RepositoryHistory, "ask"> | undefined,
): RebaseActions {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(scope, false).data;
  const notifications = Toast.useToastManager();
  const command = useCommand(RepositoryOperationsApi.start, {
    answers: (value, { repositoryId, worktreePath }) => [
      answer(
        RepositoryOperationsApi.read,
        { repositoryId, worktreePath },
        value.operation,
      ),
    ],
  });
  const [inspected, setInspected] = useState(false);
  const [range, setRange] = useState<{
    readonly key: string;
    readonly value: HistoryRange | undefined;
  }>();
  const changes = useEnvironmentQuery(
    RepositoryChangesApi.read,
    scope === undefined || !inspected
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          amend: false,
        },
    { changes: "index", keepPrevious: true },
  );
  const changed =
    changes.data === undefined
      ? undefined
      : new Set(
          [...changes.data.staged, ...changes.data.unstaged]
            .filter(({ status }) => status !== "?")
            .map(({ path }) => path),
        ).size;
  const head =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath);
  const upstream = upstreamCommit(refs, head?.branch);
  const sourceOf = (target: RefSourceTarget) =>
    refs === undefined ? undefined : refSource(refs, target);
  const rangeKey = (source: RefSource) =>
    head === undefined
      ? undefined
      : `${source.commit}:${head.commit}:${upstream ?? ""}`;
  const known = (source: RefSource) =>
    range !== undefined && range.key === rangeKey(source)
      ? range.value
      : undefined;

  const inspect = (target: RefSourceTarget) => {
    setInspected(true);
    const source = sourceOf(target);
    const key = source === undefined ? undefined : rangeKey(source);
    if (
      history === undefined ||
      source === undefined ||
      head === undefined ||
      key === undefined ||
      range?.key === key
    )
      return;
    void history
      .ask({
        _tag: "Range",
        head: head.commit,
        onto: source.commit,
        ...(upstream === undefined ? {} : { upstream }),
      })
      .then(
        (value) => setRange({ key, value }),
        () => setRange({ key, value: undefined }),
      );
  };

  const start = async (source: RefSource, stash: boolean) => {
    if (head === undefined) return;
    const result = await command.run({
      expectedHead: head.commit,
      operation: {
        _tag: "Rebase",
        onto: { ref: source.ref, commit: source.commit },
        stash,
      },
    });
    if (result._tag !== "Ok" && result._tag !== "Cancelled")
      notifications.add({ title: describeFailure(result) });
  };

  const actionFor = (target: RefSourceTarget): Action<"rebase"> | undefined => {
    const source = sourceOf(target);
    if (
      source === undefined ||
      head === undefined ||
      scope?.writable !== true ||
      source.commit === head.commit
    )
      return undefined;
    const planned = known(source);
    const reason =
      head.branch === undefined
        ? "Detached HEAD"
        : operation !== undefined && operation.kind !== "idle"
          ? `${operationKindLabel(operation.kind)} in progress`
          : command.running
            ? "Rebasing…"
            : planned?.based
              ? "Already on it"
              : changed === undefined
                ? "Checking changes…"
                : undefined;
    const detail =
      planned === undefined ? undefined : rebaseHint(planned, changed);
    return {
      id: "rebase",
      label: `Rebase onto ${source.label}`,
      enabled: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
      ...(detail === undefined ? {} : { detail }),
      run: () => void start(source, (changed ?? 0) > 0),
    };
  };

  const moving = (target: RefSourceTarget) => {
    const source = sourceOf(target);
    return source === undefined ? [] : (known(source)?.moving ?? []);
  };

  return { actionFor, inspect, moving };
}

function upstreamCommit(
  refs: RepositoryRefs | undefined,
  branch: string | undefined,
) {
  const upstream = refs?.branches.find(({ name }) => name === branch)?.upstream;
  if (upstream === undefined || upstream.gone) return undefined;
  return refs?.remoteBranches.find(
    ({ name, remote }) => `${remote}/${name}` === upstream.name,
  )?.target;
}

function rebaseHint(range: HistoryRange, changed: number | undefined) {
  return [
    range.count === 0
      ? "fast-forward"
      : `${range.count} ${range.count === 1 ? "commit" : "commits"}`,
    range.pushed > 0 ? `${range.pushed} pushed` : undefined,
    (changed ?? 0) > 0
      ? `stashes ${changed} ${changed === 1 ? "file" : "files"}`
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}
