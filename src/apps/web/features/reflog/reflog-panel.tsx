import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  isReflogRef,
  type ReflogRef,
  RepositoryReflogApi,
  type ResetDiscardsChanges,
  type ResetMode,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import type {
  RepositoryRefs,
  RepositoryWorktree,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { ErrorNotification } from "#web/features/notifications/components/error-notification.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import {
  ReflogList,
  type ReflogRow,
  short,
} from "#web/features/reflog/reflog-list.tsx";
import { createRefActions } from "#web/features/refs/ref-actions.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

type Head = RepositoryWorktree["head"];

interface PendingDiscard {
  readonly target: string;
  readonly expectedHead: string;
  readonly failure: ResetDiscardsChanges;
}

const head: ReflogRef = { _tag: "Head" };
const listedDiscards = 3;

export function ReflogPanel({
  onShowInGraph,
  onOpenDetails,
}: {
  readonly onShowInGraph?: (oid: string) => Promise<void>;
  readonly onOpenDetails?: (oid: string) => void;
}) {
  const scope = useRepositoryScope();
  const feature = usePanelFeature();
  const requested = isReflogRef(feature?.input) ? feature.input : head;
  const [ref, setRef] = useState<ReflogRef>(requested);
  useEffect(() => setRef(requested), [requested]);
  const { refs } = useScopedRepositoryRefs();
  const current =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath);
  const reflog = useEnvironmentQuery(
    RepositoryReflogApi.read,
    scope === undefined
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          ref,
        },
    { changes: "refs", enabled: feature?.active !== false },
  );
  const operation = useOperation(scope, false).data;
  const reset = useReflogReset(current);
  const [graphError, setGraphError] = useState<string>();

  const showInGraph = (oid: string) => {
    if (onShowInGraph === undefined) return;
    setGraphError(undefined);
    onShowInGraph(oid).catch((reason: unknown) =>
      setGraphError(
        reason instanceof Error
          ? reason.message
          : "The commit could not be shown in the graph.",
      ),
    );
  };

  const blocked = moveBlocked(scope, ref, refs, current, operation?.kind);
  const actionsFor = (row: ReflogRow) =>
    reflogActions(row, {
      scope,
      current,
      blocked,
      showInGraph: onShowInGraph === undefined ? undefined : showInGraph,
      openDetails: onOpenDetails,
      move: reset.move,
    });

  const error = reset.error ?? graphError;
  return (
    <section aria-label="Reflog" className="flex h-full min-h-0 flex-col">
      <ReflogScopes
        current={current}
        onChange={setRef}
        requested={requested}
        selected={ref}
      />
      <ReflogList
        actionsFor={actionsFor}
        entries={reflog.data?.entries}
        onShowInGraph={showInGraph}
        status={reflog.status}
        truncated={reflog.data?.truncated ?? false}
      />
      {reset.pending === undefined ? null : (
        <DiscardConfirmation
          busy={reset.running}
          onCancel={reset.cancel}
          onConfirm={reset.confirm}
          pending={reset.pending}
          title={`Move ${headLabel(current)} to ${short(reset.pending.target)} and discard changes?`}
        />
      )}
      {error === undefined ? null : <ErrorNotification message={error} />}
    </section>
  );
}

function ReflogScopes({
  current,
  requested,
  selected,
  onChange,
}: {
  readonly current: Head | undefined;
  readonly requested: ReflogRef;
  readonly selected: ReflogRef;
  readonly onChange: (ref: ReflogRef) => void;
}) {
  const options = [
    head,
    ...(current?.branch === undefined
      ? []
      : [{ _tag: "LocalBranch", name: current.branch } as const]),
    requested,
  ].filter(
    (option, index, all) =>
      all.findIndex((other) => refKey(other) === refKey(option)) === index,
  );
  return (
    <div className="flex h-11 shrink-0 items-center border-border border-b px-3">
      <div
        aria-label="Reflog scope"
        className="flex min-w-0 gap-1"
        role="radiogroup"
      >
        {options.map((option) => (
          <Button
            aria-checked={refKey(option) === refKey(selected)}
            className="min-w-0 aria-checked:bg-sidebar-accent aria-checked:text-sidebar-accent-foreground"
            key={refKey(option)}
            onClick={() => onChange(option)}
            role="radio"
            size="xs"
            variant="ghost"
          >
            <span className="truncate">
              {option._tag === "Head" ? "HEAD" : option.name}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function useReflogReset(current: Head | undefined) {
  const reset = useCommand(RepositoryReflogApi.reset);
  const [pending, setPending] = useState<PendingDiscard>();
  const [error, setError] = useState<string>();
  const run = async (
    target: string,
    mode: ResetMode,
    expectedHead: string,
    discard?: string,
  ) => {
    setError(undefined);
    const result = await reset.run({
      target,
      mode,
      expectedHead,
      ...(discard === undefined ? {} : { discard }),
    });
    const failure = result._tag === "Rejected" ? result.failure : undefined;
    setPending(
      failure?._tag === "ResetDiscardsChanges"
        ? { target, expectedHead, failure }
        : undefined,
    );
    if (result._tag === "Ok" || failure?._tag === "ResetDiscardsChanges")
      return;
    setError(
      describeFailure(result, {
        HeadMoved: (moved) =>
          `${headLabel(current)} moved to ${short(moved.head)} before the reset ran. Nothing changed.`,
        RefMissing: () => "That commit no longer exists.",
      }),
    );
  };
  return {
    pending,
    error,
    running: reset.running,
    move: (target: string, mode: ResetMode) => {
      if (current !== undefined) void run(target, mode, current.commit);
    },
    confirm: () => {
      if (pending !== undefined)
        void run(
          pending.target,
          "hard",
          pending.expectedHead,
          pending.failure.fingerprint,
        );
    },
    cancel: () => setPending(undefined),
  };
}

function moveBlocked(
  scope: RepositoryScope | undefined,
  ref: ReflogRef,
  refs: RepositoryRefs | undefined,
  current: Head | undefined,
  operation: string | undefined,
) {
  if (!scope?.writable) return "Read only";
  if (operation !== undefined && operation !== "idle")
    return `${operationLabel(operation)} in progress`;
  if (current === undefined) return "No commits yet";
  if (ref._tag === "Head" || current.branch === ref.name) return undefined;
  return refs?.branches.find((branch) => branch.name === ref.name)
    ?.worktreePath === undefined
    ? "Not checked out"
    : "In another worktree";
}

function reflogActions(
  row: ReflogRow,
  context: {
    readonly scope: RepositoryScope | undefined;
    readonly current: Head | undefined;
    readonly blocked: string | undefined;
    readonly showInGraph: ((oid: string) => void) | undefined;
    readonly openDetails: ((oid: string) => void) | undefined;
    readonly move: (target: string, mode: ResetMode) => void;
  },
): readonly Action[] {
  const { scope, current, showInGraph, openDetails } = context;
  const readable = scope?.readable ?? false;
  const reason =
    context.blocked ??
    (row.oid === current?.commit ? "Already here" : undefined);
  const subject =
    current?.branch === undefined ? "Move HEAD here" : "Move branch here";
  const move = (mode: ResetMode, label: string): Action => ({
    id: `reset.${mode}`,
    label: `${subject}, ${label}`,
    group: "edit",
    detail: mode,
    enabled: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
    run: () => context.move(row.oid, mode),
  });
  return [
    {
      id: "showInGraph",
      label: "Show in graph",
      keys: ["Enter"],
      enabled: showInGraph !== undefined && readable,
      run: () => showInGraph?.(row.oid),
    },
    {
      id: "openDetails",
      label: "Open details",
      enabled: openDetails !== undefined && readable,
      run: () => openDetails?.(row.oid),
    },
    ...createRefActions(row.oid, {
      connected: scope?.connected ?? false,
      writable: scope?.writable ?? false,
    })
      .filter((action) => action.id === "branch.createHere")
      .map((action): Action => ({ ...action, group: "create" })),
    move("soft", "keep changes staged"),
    move("mixed", "keep changes unstaged"),
    move("hard", "discard changes…"),
    {
      id: "copySha",
      label: "Copy commit SHA",
      enabled: true,
      run: () => void writeClipboardText(row.oid),
    },
    {
      id: "copySubject",
      label: "Copy commit subject",
      enabled: true,
      run: () => void writeClipboardText(row.subject),
    },
  ];
}

function DiscardConfirmation({
  pending,
  title,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly pending: PendingDiscard;
  readonly title: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const { paths, count } = pending.failure;
  const hidden = count - Math.min(count, listedDiscards);
  return (
    <PersistentNotification>
      <Confirmation
        action="Discard and move"
        busy={busy}
        className="px-3 py-2"
        key={pending.failure.fingerprint}
        onCancel={onCancel}
        onConfirm={onConfirm}
        title={title}
      >
        <p>
          {count === 1
            ? "Uncommitted edits in 1 file will be lost."
            : `Uncommitted edits in ${count} files will be lost.`}{" "}
          The reflog can't bring them back.
        </p>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {paths.slice(0, listedDiscards).map((path) => (
            <li className="truncate font-mono text-foreground" key={path}>
              {path}
            </li>
          ))}
        </ul>
        {hidden === 0 ? null : <p className="mt-0.5">and {hidden} more</p>}
        <p className="mt-1.5">Files not listed are kept.</p>
      </Confirmation>
    </PersistentNotification>
  );
}

function refKey(ref: ReflogRef) {
  return ref._tag === "Head" ? "HEAD" : `refs/heads/${ref.name}`;
}

function headLabel(current: Head | undefined) {
  return current?.branch ?? "HEAD";
}

function operationLabel(kind: string) {
  return kind === "am"
    ? "Patch"
    : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}
