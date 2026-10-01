import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import type { RebasePlanTarget } from "#web/features/rebase/rebase-plan.ts";
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
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export type RebaseActionId = "rebase" | "rebase.onto" | "rebase.interactive";

interface RebaseChoice {
  readonly action: Action<RebaseActionId>;
  readonly alone: string;
}

export interface RebaseActions {
  readonly actionFor: (
    target: RefSourceTarget,
  ) => Action<RebaseActionId> | undefined;
  readonly inspect: (target: RefSourceTarget) => void;
  readonly moving: (target: RefSourceTarget) => readonly string[];
}

export function useRebaseActions(
  history: Pick<RepositoryHistory, "ask"> | undefined,
  openPlan?: (target: RebasePlanTarget) => void,
): RebaseActions {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(scope, false).data;
  const errorToast = useErrorToast();
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
  const changed = useChangedFileCount(inspected);
  const head =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath);
  const sourceOf = (target: RefSourceTarget) =>
    refs === undefined ? undefined : refSource(refs, target);
  const rangeKey = (source: RefSource) =>
    head === undefined ? undefined : `${source.commit}:${head.commit}`;
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
    errorToast.failure("rebase", result);
  };

  const ontoFor = (target: RefSourceTarget): RebaseChoice | undefined => {
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
    return {
      alone: "Rebase onto here",
      action: {
        id: "rebase.onto",
        label: "Onto here",
        enabled: reason === undefined,
        ...(reason === undefined ? {} : { reason }),
        run: () => void start(source, (changed ?? 0) > 0),
      },
    };
  };

  const interactiveFor = (
    target: RefSourceTarget,
  ): RebaseChoice | undefined => {
    const source = sourceOf(target);
    if (
      openPlan === undefined ||
      source === undefined ||
      head === undefined ||
      scope?.writable !== true
    )
      return undefined;
    const planned = known(source);
    const from =
      typeof target === "string" &&
      (source.ref === null || source.ref === head.branch) &&
      planned?.based === true;
    if (planned?.count === 0 && !from) return undefined;
    const reason =
      head.branch === undefined
        ? "Detached HEAD"
        : operation !== undefined && operation.kind !== "idle"
          ? `${operationKindLabel(operation.kind)} in progress`
          : undefined;
    const plan: RebasePlanTarget = {
      ref: from ? null : source.ref,
      commit: source.commit,
      from,
    };
    return {
      alone: from
        ? "Interactive rebase from here"
        : "Interactive rebase onto here",
      action: {
        id: "rebase.interactive",
        label: from ? "Interactive from here" : "Interactive onto here",
        enabled: reason === undefined,
        ...(reason === undefined ? {} : { reason }),
        run: () => openPlan(plan),
      },
    };
  };

  const actionFor = (
    target: RefSourceTarget,
  ): Action<RebaseActionId> | undefined => {
    const choices = [ontoFor(target), interactiveFor(target)].filter(
      (choice) => choice !== undefined,
    );
    const [only] = choices;
    if (only === undefined) return undefined;
    if (choices.length === 1)
      return { ...only.action, label: only.alone, group: "operation" };
    return submenu(
      { id: "rebase", label: "Rebase", group: "operation" },
      choices.map(({ action }) => action),
    );
  };

  const moving = (target: RefSourceTarget) => {
    const source = sourceOf(target);
    const planned = source === undefined ? undefined : known(source);
    if (source === undefined || planned === undefined) return [];
    return planned.based && typeof target === "string"
      ? [...planned.moving, source.commit]
      : planned.moving;
  };

  return { actionFor, inspect, moving };
}

export function useChangedFileCount(enabled: boolean) {
  const scope = useRepositoryScope();
  const changes = useEnvironmentQuery(
    RepositoryChangesApi.read,
    scope === undefined || !enabled
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          amend: false,
        },
    { changes: "index", keepPrevious: true },
  );
  return changes.data === undefined
    ? undefined
    : new Set(
        [...changes.data.staged, ...changes.data.unstaged]
          .filter(({ status }) => status !== "?")
          .map(({ path }) => path),
      ).size;
}
