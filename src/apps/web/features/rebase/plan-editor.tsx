import { useEffect, useRef, useState } from "react";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { PlanList } from "#web/features/rebase/plan-list.tsx";
import { useChangedFileCount } from "#web/features/rebase/rebase-actions.ts";
import {
  type LoadedPlan,
  loadPlan,
  messageOwner,
  messageSources,
  moveRow,
  type PlanHistory,
  type PlanMessages,
  type PlanRow,
  planCount,
  planProblem,
  planSteps,
  type RebasePlanTarget,
  setAction,
} from "#web/features/rebase/rebase-plan.ts";
import { useEnvironmentQueries } from "#web/platform/query/environment-query.ts";
import type { RepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export function PlanEditor({
  scope,
  history,
  head,
  target,
  blocked,
  close,
}: {
  readonly scope: RepositoryScope;
  readonly history: PlanHistory;
  readonly head: string;
  readonly target: RebasePlanTarget;
  readonly blocked: string | undefined;
  readonly close: () => void;
}) {
  const [loaded, setLoaded] = useState<LoadedPlan>({ _tag: "Loading" });
  const [rows, setRows] = useState<readonly PlanRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [edits, setEdits] = useState<PlanMessages>({});
  const errorToast = useErrorToast();
  const subject = useRef<HTMLInputElement>(null);
  const changed = useChangedFileCount(true);
  const command = useCommand(RepositoryOperationsApi.start, {
    answers: (value, { repositoryId, worktreePath }) => [
      answer(
        RepositoryOperationsApi.read,
        { repositoryId, worktreePath },
        value.operation,
      ),
    ],
  });
  useEffect(() => {
    let live = true;
    void loadPlan(history, head, target).then((result) => {
      if (!live) return;
      setLoaded(result);
      if (result._tag === "Ready") setRows(result.rows);
    });
    return () => {
      live = false;
    };
  }, [history, head, target]);

  const messages = usePlanMessages(scope, rows, edits);
  const owner = messageOwner(rows, selected);
  const ownerCommit = owner === undefined ? undefined : rows[owner]?.commit;
  const message =
    ownerCommit === undefined ? undefined : messages.values[ownerCommit];
  const problem = planProblem(rows, messages.values);
  const status =
    blocked ??
    (command.running
      ? "Rebasing…"
      : messages.loading
        ? "Loading messages…"
        : changed === undefined
          ? "Checking changes…"
          : undefined);
  const select = (index: number) =>
    setSelected(Math.max(0, Math.min(rows.length - 1, index)));
  const editMessage = (next: string) => {
    if (ownerCommit !== undefined) setEdits({ ...edits, [ownerCommit]: next });
  };
  const start = async () => {
    if (loaded._tag !== "Ready" || status !== undefined || problem) return;
    const result = await command.run({
      expectedHead: head,
      operation: {
        _tag: "Rebase",
        onto: { ref: target.from ? null : target.ref, commit: loaded.onto },
        stash: (changed ?? 0) > 0,
        plan: planSteps(rows, messages.values),
      },
    });
    if (result._tag !== "Ok") errorToast.failure("rebase", result);
    else if (result.value.outcome !== "Stopped") close();
  };

  if (loaded._tag !== "Ready")
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {loaded._tag === "Loading" ? "Loading commits…" : loaded.text}
      </p>
    );
  const [messageSubject = "", ...messageBody] = (message ?? "").split("\n");
  return (
    <section
      aria-label="Rebase plan"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void start();
        } else if (
          event.key === "Escape" &&
          !command.running &&
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLTextAreaElement)
        ) {
          event.preventDefault();
          close();
        }
      }}
    >
      <header className="flex min-h-10 shrink-0 items-center gap-2 border-border border-b px-3">
        <h2 className="font-semibold">
          {target.from
            ? "From here"
            : `Onto ${target.ref ?? target.commit.slice(0, 8)}`}
        </h2>
        <span className="text-muted-foreground">
          {rows.filter((row) => !row.merge).length} → {planCount(rows)}
        </span>
      </header>
      <PlanList
        rows={rows}
        selected={selected}
        invalid={problem?.index}
        subjects={Object.fromEntries(
          Object.entries(messages.values).flatMap(([commit, text]) =>
            edits[commit] === undefined ? [] : [[commit, text?.split("\n")[0]]],
          ),
        )}
        disabled={command.running}
        select={select}
        move={(from, to) => {
          const next = moveRow(rows, from, to);
          setRows(next);
          if (next !== rows) select(to);
        }}
        apply={(index, action) => setRows(setAction(rows, index, action))}
        openMessage={() => subject.current?.focus()}
      />
      {ownerCommit === undefined ? null : (
        <section
          aria-label="Message"
          className="flex shrink-0 flex-col gap-2 border-border border-t p-3"
        >
          <Input
            ref={subject}
            aria-label="Message subject"
            value={messageSubject}
            disabled={message === undefined}
            maxLength={2000}
            onChange={(event) =>
              editMessage([event.target.value, ...messageBody].join("\n"))
            }
          />
          <textarea
            aria-label="Message body"
            className="h-24 w-full resize-none rounded-md border border-input bg-input/20 p-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            value={messageBody.join("\n").replace(/^\n/, "")}
            disabled={message === undefined}
            maxLength={28000}
            onChange={(event) =>
              editMessage(
                event.target.value
                  ? `${messageSubject}\n\n${event.target.value}`
                  : messageSubject,
              )
            }
          />
        </section>
      )}
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-border border-t px-3 py-2">
        {problem === undefined ? null : (
          <p role="alert" className="basis-full text-xs text-destructive">
            {problem.text}
          </p>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {status ??
            ((changed ?? 0) > 0
              ? `Stashes ${changed} ${changed === 1 ? "file" : "files"}`
              : null)}
        </span>
        <Button size="xs" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={status !== undefined || problem !== undefined}
          onClick={() => void start()}
        >
          Start rebase
        </Button>
      </footer>
    </section>
  );
}

function usePlanMessages(
  scope: RepositoryScope,
  rows: readonly PlanRow[],
  edits: PlanMessages,
) {
  const owners = rows.flatMap((_, index) =>
    messageOwner(rows, index) === index ? [index] : [],
  );
  const inspected = useEnvironmentQueries(
    CommitInspectionApi.inspect,
    [...new Set(owners.flatMap((owner) => messageSources(rows, owner)))].map(
      (oid) => ({
        repositoryId: scope.repositoryId,
        worktreePath: scope.worktreePath,
        oid,
      }),
    ),
    { changes: "none" },
  );
  const original = new Map(
    inspected.flatMap((query) =>
      query.data === undefined ? [] : [[query.data.oid, query.data.message]],
    ),
  );
  const values: PlanMessages = Object.fromEntries(
    owners.map((owner) => {
      const commit = rows[owner]?.commit ?? "";
      const parts = messageSources(rows, owner).map((oid) =>
        original.get(oid)?.trim(),
      );
      return [
        commit,
        edits[commit] ??
          (parts.every((part) => part !== undefined)
            ? parts.join("\n\n")
            : undefined),
      ];
    }),
  );
  return {
    values,
    loading: owners.some(
      (owner) => values[rows[owner]?.commit ?? ""] === undefined,
    ),
  };
}
