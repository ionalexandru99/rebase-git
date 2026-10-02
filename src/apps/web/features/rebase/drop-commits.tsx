import { useRef, useState } from "react";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import {
  type PlanStep,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import {
  Confirmation,
  ConfirmationList,
} from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import { useChangedFileCount } from "#web/features/rebase/rebase-actions.ts";
import { maximumPlanCommits } from "#web/features/rebase/rebase-plan.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

type DropPlan =
  | {
      readonly _tag: "Blocked";
      readonly dropped: readonly RepositoryCommit[];
      readonly reason: string;
    }
  | {
      readonly _tag: "Ready";
      readonly dropped: readonly RepositoryCommit[];
      readonly head: string;
      readonly onto: string;
      readonly steps: readonly PlanStep[];
      readonly pushed: boolean;
    };

interface PendingDrop {
  readonly branch: string;
  readonly plan: Extract<DropPlan, { readonly _tag: "Ready" }>;
}

export type DropCommits = ReturnType<typeof useDropCommits>;

export async function dropPlan(
  history: Pick<RepositoryHistory, "ask">,
  scope: HistoryScopeQuery,
  head: string,
  oids: readonly string[],
  unpushed: number,
): Promise<DropPlan | undefined> {
  const [rows, found] = await Promise.all([
    history.ask({ _tag: "Locate", scope, oids }),
    history.ask({ _tag: "Commits", oids }),
  ]);
  const row = new Map(oids.map((oid, index) => [oid, rows[index]]));
  if (
    found.length !== oids.length ||
    found.some((commit) => row.get(commit.oid) === undefined)
  )
    return undefined;
  const dropped = [...found].sort(
    (left, right) => (row.get(left.oid) ?? 0) - (row.get(right.oid) ?? 0),
  );
  const oldest = dropped.at(-1);
  if (oldest === undefined) return undefined;
  const onto = oldest.parents[0];
  const range = await history.ask({
    _tag: "Range",
    head,
    onto: onto ?? oldest.oid,
  });
  if (range === undefined || !range.based) return undefined;
  const moving = new Set(onto === undefined ? [oldest.oid] : []);
  for (const oid of range.moving) moving.add(oid);
  if (
    range.count <= range.moving.length &&
    dropped.some(({ oid }) => !moving.has(oid))
  )
    return undefined;
  if (onto === undefined)
    return { _tag: "Blocked", dropped, reason: "Root commit" };
  if (dropped.some(({ parents }) => parents.length > 1))
    return { _tag: "Blocked", dropped, reason: "Merge commit" };
  if (range.count > maximumPlanCommits)
    return {
      _tag: "Blocked",
      dropped,
      reason: `${maximumPlanCommits.toLocaleString("en-US")} commits at most`,
    };
  const commits = new Map(
    (await history.ask({ _tag: "Commits", oids: range.moving })).map(
      (commit) => [commit.oid, commit],
    ),
  );
  if ([...commits.values()].some(({ parents }) => parents.length > 1))
    return { _tag: "Blocked", dropped, reason: "Merges in range" };
  const chain: RepositoryCommit[] = [];
  for (let oid = head; oid !== onto; ) {
    const commit = commits.get(oid);
    const parent = commit?.parents[0];
    if (commit === undefined || parent === undefined) return undefined;
    chain.push(commit);
    oid = parent;
  }
  const selected = new Set(oids);
  return {
    _tag: "Ready",
    dropped,
    head,
    onto,
    pushed: chain.findLastIndex(({ oid }) => selected.has(oid)) >= unpushed,
    steps: chain.toReversed().map(({ oid }) => ({
      commit: oid,
      action: selected.has(oid) ? "drop" : "pick",
      message: null,
    })),
  };
}

export function useDropCommits(
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
  const [plan, setPlan] = useState<DropPlan>();
  const [pending, setPending] = useState<PendingDrop>();
  const request = useRef(0);
  const changed = useChangedFileCount(plan !== undefined);
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
    setPlan(undefined);
    if (history === undefined || scope === undefined || head === undefined)
      return;
    void dropPlan(
      history,
      scope,
      head.commit,
      oids,
      upstream === undefined || upstream.gone ? Infinity : upstream.ahead,
    ).then(
      (resolved) => {
        if (current === request.current) setPlan(resolved);
      },
      () => undefined,
    );
  };

  const action = (): Action | undefined => {
    if (plan === undefined || head === undefined) return undefined;
    const reason =
      repository?.writable !== true
        ? "Read only"
        : head.branch === undefined
          ? "Detached HEAD"
          : operation !== undefined && operation.kind !== "idle"
            ? `${operationKindLabel(operation.kind)} in progress`
            : command.running
              ? "Dropping…"
              : plan._tag === "Blocked"
                ? plan.reason
                : changed === undefined
                  ? "Checking changes…"
                  : undefined;
    const count = plan.dropped.length;
    const branch = head.branch;
    return {
      id: "drop",
      label: count === 1 ? "Drop commit" : `Drop ${count} commits`,
      group: "operation",
      enabled: reason === undefined && command.canRun,
      ...(reason === undefined ? {} : { reason }),
      run: () => {
        if (plan._tag === "Ready" && branch !== undefined)
          setPending({ branch, plan });
      },
    };
  };

  const confirm = async () => {
    if (pending === undefined) return;
    const { plan: ready } = pending;
    const result = await command.run({
      expectedHead: ready.head,
      operation: {
        _tag: "Rebase",
        onto: { ref: null, commit: ready.onto },
        stash: (changed ?? 0) > 0,
        plan: ready.steps,
      },
    });
    setPending(undefined);
    errorToast.failure("rebase", result);
  };

  return {
    open,
    action,
    pending,
    running: command.running,
    confirm: () => void confirm(),
    cancel: () => setPending(undefined),
  };
}

export function DropConfirmation({ drop }: { readonly drop: DropCommits }) {
  const { pending } = drop;
  if (pending === undefined) return null;
  const { branch, plan } = pending;
  const [only] = plan.dropped;
  const count = plan.dropped.length;
  return (
    <PersistentNotification>
      <Confirmation
        action={count === 1 ? "Drop commit" : `Drop ${count} commits`}
        busy={drop.running}
        className="px-3 py-2"
        onCancel={drop.cancel}
        onConfirm={drop.confirm}
        title={
          count === 1 && only !== undefined
            ? `Drop ${commitLine(only)}?`
            : `Drop ${count} commits from ${branch}?`
        }
      >
        {count === 1 ? (
          <p>It is removed from {branch}.</p>
        ) : (
          <ConfirmationList items={plan.dropped.map(commitLine)} />
        )}
        {plan.pushed ? (
          <p className="mt-1.5">
            {count === 1 ? "It was" : "Some were"} already pushed, so you'll
            need to force-push afterwards.
          </p>
        ) : null}
      </Confirmation>
    </PersistentNotification>
  );
}

function commitLine(commit: RepositoryCommit) {
  return `${commit.oid.slice(0, 7)} ${commit.subject}`;
}
