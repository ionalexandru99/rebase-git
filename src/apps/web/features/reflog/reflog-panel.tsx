import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  isReflogRef,
  type ReflogRef,
  RepositoryReflogApi,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import type {
  RepositoryRefs,
  RepositoryWorktree,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { ErrorNotification } from "#web/features/notifications/components/error-notification.tsx";
import {
  ReflogList,
  type ReflogRow,
} from "#web/features/reflog/reflog-list.tsx";
import { createRefActions } from "#web/features/refs/ref-actions.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { ResetActions } from "#web/features/reset/reset-actions.tsx";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/platform/query/repository-scope.tsx";

type Head = RepositoryWorktree["head"];

const head: ReflogRef = { _tag: "Head" };

export function ReflogPanel({
  reset,
  onShowInGraph,
  onOpenDetails,
}: {
  readonly reset?: ResetActions | undefined;
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

  const blocked = otherBranch(ref, refs, current);
  const actionsFor = (row: ReflogRow) =>
    reflogActions(row, {
      scope,
      blocked,
      showInGraph: onShowInGraph === undefined ? undefined : showInGraph,
      openDetails: onOpenDetails,
      reset,
    });

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
      {graphError === undefined ? null : (
        <ErrorNotification message={graphError} />
      )}
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

function otherBranch(
  ref: ReflogRef,
  refs: RepositoryRefs | undefined,
  current: Head | undefined,
) {
  if (ref._tag === "Head" || current?.branch === ref.name) return undefined;
  return refs?.branches.find((branch) => branch.name === ref.name)
    ?.worktreePath === undefined
    ? "Not checked out"
    : "In another worktree";
}

function reflogActions(
  row: ReflogRow,
  context: {
    readonly scope: RepositoryScope | undefined;
    readonly blocked: string | undefined;
    readonly showInGraph: ((oid: string) => void) | undefined;
    readonly openDetails: ((oid: string) => void) | undefined;
    readonly reset: ResetActions | undefined;
  },
): readonly Action[] {
  const { scope, blocked, showInGraph, openDetails } = context;
  const readable = scope?.readable ?? false;
  const reset = context.reset?.actionFor(row.oid);
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
    ...(reset === undefined
      ? []
      : [
          blocked === undefined
            ? reset
            : { ...reset, enabled: false, reason: blocked },
        ]),
    ...createRefActions(row.oid, {
      connected: scope?.connected ?? false,
      writable: scope?.writable ?? false,
    }).filter((action) => action.id === "branch.createHere"),
    submenu({ id: "copy", label: "Copy", group: "edit" }, [
      {
        id: "copySha",
        label: "SHA",
        enabled: true,
        run: () => void writeClipboardText(row.oid),
      },
      {
        id: "copySubject",
        label: "Subject",
        enabled: true,
        run: () => void writeClipboardText(row.subject),
      },
    ]),
  ];
}

function refKey(ref: ReflogRef) {
  return ref._tag === "Head" ? "HEAD" : `refs/heads/${ref.name}`;
}
