import { useState } from "react";
import type { RouteFailure } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  type MergeMode,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { fileName } from "#web/features/file-diff/components/file-row-name.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import {
  activeHead,
  type RefSource,
  type RefSourceTarget,
  refSource,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { HistoryRelation } from "#web/features/repository-history/history-graph.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import {
  type FailureMessages,
  gitMessage,
} from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export interface MergeActions {
  readonly actionFor: (target: RefSourceTarget) => MergeAction | undefined;
  readonly inspect: (target: RefSourceTarget) => void;
}

type MergeAction = Action<"merge" | `merge.${MergeMode}`>;

const modes: readonly { readonly mode: MergeMode; readonly label: string }[] = [
  { mode: "merge", label: "Merge" },
  { mode: "ff-only", label: "Fast-forward only" },
  { mode: "no-ff", label: "Always create a merge commit" },
  { mode: "squash", label: "Squash into staged changes" },
];

export function useMergeActions(
  history: Pick<RepositoryHistory, "ask"> | undefined,
): MergeActions {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(scope, false).data;
  const panel = useWorkspacePanel();
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
  const [relation, setRelation] = useState<{
    readonly key: string;
    readonly value: HistoryRelation | undefined;
  }>();
  const head =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath);
  const sourceOf = (target: RefSourceTarget) =>
    refs === undefined ? undefined : refSource(refs, target);
  const relationKey = (source: RefSource) =>
    head === undefined ? undefined : `${source.commit}:${head.commit}`;

  const inspect = (target: RefSourceTarget) => {
    const source = sourceOf(target);
    const key = source === undefined ? undefined : relationKey(source);
    if (
      history === undefined ||
      source === undefined ||
      head === undefined ||
      key === undefined ||
      relation?.key === key
    )
      return;
    void history
      .ask({ _tag: "Relation", from: source.commit, to: head.commit })
      .then(
        (value) => setRelation({ key, value }),
        () => setRelation({ key, value: undefined }),
      );
  };

  const start = async (source: RefSource, mode: MergeMode) => {
    if (head?.branch === undefined) return;
    const branch = head.branch;
    const result = await command.run({
      expectedHead: head.commit,
      operation: {
        _tag: "Merge",
        source: { ref: source.ref, commit: source.commit },
        mode,
      },
    });
    if (result._tag === "Ok" && result.value.outcome === "Staged")
      panel.execute({ type: "open", kind: "changes" });
    errorToast.failure(
      "merge",
      result,
      mergeFailureMessages(source.label, branch),
    );
  };

  const actionFor = (target: RefSourceTarget): MergeAction | undefined => {
    const source = sourceOf(target);
    if (
      source === undefined ||
      head === undefined ||
      scope?.writable !== true ||
      source.commit === head.commit
    )
      return undefined;
    const known =
      relation !== undefined && relation.key === relationKey(source)
        ? relation.value
        : undefined;
    const reason =
      head.branch === undefined
        ? "Detached HEAD"
        : operation !== undefined && operation.kind !== "idle"
          ? `${operationKindLabel(operation.kind)} in progress`
          : command.running
            ? "Merging…"
            : known?.ahead === 0
              ? "Up to date"
              : undefined;
    const branch = head.branch ?? "HEAD";
    return {
      id: "merge",
      label: `Merge into ${branch}`,
      group: "operation",
      enabled: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
      run: () => undefined,
      submenu: {
        actions: modes.map(({ mode, label }) => {
          const blocked =
            mode === "ff-only" && known !== undefined && known.behind > 0;
          const detail =
            mode !== "merge" || known === undefined
              ? undefined
              : known.behind === 0
                ? "fast-forward"
                : "merge commit";
          return {
            id: `merge.${mode}`,
            label,
            enabled: !blocked,
            ...(blocked ? { reason: "Diverged" } : {}),
            ...(detail === undefined ? {} : { detail }),
            run: () => void start(source, mode),
          };
        }),
      },
    };
  };

  return { actionFor, inspect };
}

function mergeFailureMessages(
  source: string,
  branch: string,
): FailureMessages<RouteFailure<typeof RepositoryOperationsApi.start>> {
  return {
    OperationFailed: ({ reason, detail, paths = [] }) => {
      switch (reason) {
        case "WouldOverwrite":
          return paths.length === 1
            ? `Local changes to ${fileName(paths[0] ?? "")} block the merge.`
            : "Local changes block the merge.";
        case "NotFastForward":
          return `${branch} can't fast-forward to ${source}.`;
        case "Unrelated":
          return `${source} has no history in common with ${branch}.`;
        case "Stale":
          return `${source} or ${branch} moved.`;
        default:
          return gitMessage(detail);
      }
    },
  };
}
