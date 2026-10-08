import { useRef, useState } from "react";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import {
  type PlanStep,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { ConfirmNotice } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import { useChangedFileCount } from "#web/features/rebase/rebase-actions.ts";
import {
  type ReadyPlan,
  type Rewrite,
  type RewritePlan,
  rewritePlan,
} from "#web/features/rebase/rewrite-plan.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useEnvironmentQueries } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

interface PendingDrop {
  readonly branch: string;
  readonly plan: ReadyPlan;
}

export type RewriteCommits = ReturnType<typeof useRewriteCommits>;

export function useRewriteCommits(
  history: Pick<RepositoryHistory, "ask"> | undefined,
) {
  const repository = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(repository, false).data;
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
  const [plans, setPlans] = useState<
    Partial<Record<Rewrite, RewritePlan | undefined>>
  >({});
  const [pending, setPending] = useState<PendingDrop>();
  const request = useRef(0);
  const changed = useChangedFileCount(plans.drop !== undefined);
  const message = useSquashMessage(plans.squash);
  const head =
    refs === undefined || repository === undefined
      ? undefined
      : activeHead(refs, repository.worktreePath);
  const upstream = refs?.branches.find(
    ({ name }) => name === head?.branch,
  )?.upstream;

  const open = (
    oids: readonly string[],
    scope: HistoryScopeQuery | undefined,
  ) => {
    const current = ++request.current;
    setPlans({});
    if (history === undefined || scope === undefined || head === undefined)
      return;
    const plan = (rewrite: Rewrite) =>
      rewritePlan(
        history,
        scope,
        head.commit,
        rewrite,
        oids,
        upstream === undefined || upstream.gone ? Infinity : upstream.ahead,
      );
    void Promise.all([plan("drop"), plan("squash")]).then(
      ([drop, squash]) => {
        if (current === request.current) setPlans({ drop, squash });
      },
      () => undefined,
    );
  };

  const start = async (plan: ReadyPlan, steps: readonly PlanStep[]) => {
    const result = await command.run({
      expectedHead: plan.head,
      operation: {
        _tag: "Rebase",
        onto: { ref: null, commit: plan.onto },
        stash: (changed ?? 0) > 0,
        plan: steps,
      },
    });
    errorToast.failure("rebase", result);
  };

  const actions = (): readonly Action[] => {
    if (head === undefined) return [];
    const branch = head.branch;
    const blocked = (plan: RewritePlan) =>
      repository?.writable !== true
        ? "Read only"
        : branch === undefined
          ? "Detached HEAD"
          : operation !== undefined && operation.kind !== "idle"
            ? `${operationKindLabel(operation.kind)} in progress`
            : command.running
              ? "Rebasing…"
              : plan._tag === "Blocked"
                ? plan.reason
                : changed === undefined
                  ? "Checking changes…"
                  : undefined;
    const availability = (reason: string | undefined) => ({
      group: "operation" as const,
      enabled: reason === undefined && command.canRun,
      ...(reason === undefined ? {} : { reason }),
    });
    const { drop, squash } = plans;
    const count = drop?.selected.length ?? 0;
    const squashed = squash?.selected.length ?? 0;
    return [
      ...(squash === undefined
        ? []
        : [
            {
              id: "squash",
              label:
                squashed === 1
                  ? "Squash into parent"
                  : `Squash ${squashed} commits`,
              ...availability(blocked(squash) ?? message.reason),
              run: () => {
                if (squash._tag === "Ready" && message.text !== undefined)
                  void start(
                    squash,
                    squash.steps.map((step, index) =>
                      index === 0 ? { ...step, message: message.text } : step,
                    ),
                  );
              },
            },
          ]),
      ...(drop === undefined
        ? []
        : [
            {
              id: "drop",
              label: count === 1 ? "Drop commit" : `Drop ${count} commits`,
              ...availability(blocked(drop)),
              run: () => {
                if (drop._tag === "Ready" && branch !== undefined)
                  setPending({ branch, plan: drop });
              },
            },
          ]),
    ];
  };

  const confirm = async () => {
    if (pending === undefined) return;
    await start(pending.plan, pending.plan.steps);
    setPending(undefined);
  };

  return {
    open,
    actions,
    pending,
    running: command.running,
    confirm: () => void confirm(),
    cancel: () => setPending(undefined),
  };
}

function useSquashMessage(plan: RewritePlan | undefined) {
  const repository = useRepositoryScope();
  const sources =
    plan?._tag === "Ready"
      ? plan.steps.slice(
          0,
          plan.steps.findLastIndex(({ action }) => action === "squash") + 1,
        )
      : [];
  const inspected = useEnvironmentQueries(
    CommitInspectionApi.inspect,
    repository === undefined
      ? []
      : sources.map(({ commit }) => ({
          repositoryId: repository.repositoryId,
          worktreePath: repository.worktreePath,
          oid: commit,
        })),
    { changes: "none" },
  );
  const messages = inspected.flatMap(({ data }) =>
    data === undefined ? [] : [data.message.trim()],
  );
  return messages.length > 0 && messages.length === sources.length
    ? { text: messages.join("\n\n"), reason: undefined }
    : {
        text: undefined,
        reason: inspected.some(({ isError }) => isError)
          ? "Message unavailable"
          : "Loading message…",
      };
}

export function DropConfirmation({ drop }: { readonly drop: RewriteCommits }) {
  const { pending } = drop;
  if (pending === undefined) return null;
  const { branch, plan } = pending;
  const count = plan.selected.length;
  return (
    <ConfirmNotice
      notice="rebase"
      action={count === 1 ? "Drop commit" : `Drop ${count} commits`}
      busy={drop.running ? "Dropping" : undefined}
      onCancel={drop.cancel}
      onConfirm={drop.confirm}
      title={
        count === 1
          ? "Drop this commit?"
          : `Drop ${count} commits from ${branch}?`
      }
    >
      {plan.pushed ? (
        <p>
          {count === 1 ? "It was" : "Some were"} already pushed, so you'll need
          to force-push afterwards.
        </p>
      ) : null}
    </ConfirmNotice>
  );
}
