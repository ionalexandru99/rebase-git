import { skipToken } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import type { CommitFile } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import {
  FileHistoryApi,
  type FileHistoryEntry,
  fileHistoryPage,
  maximumFileHistory,
} from "#contracts/file-history/file-history.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { CommitRefPill } from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import {
  RestoreConfirmation,
  useRestoreFiles,
} from "#web/features/commit-inspection/restore-files.tsx";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import { useDiffPreferences } from "#web/features/file-diff/hooks/use-diff-preferences.ts";
import { isFileHistoryInput } from "#web/features/file-history/file-history.ts";
import { HistoryList } from "#web/features/file-history/file-history-list.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
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

const CommitDiff = lazy(
  () => import("#web/features/commit-inspection/components/commit-diff.tsx"),
);

export function FileHistoryPanel({
  onSelectCommit,
  onOpenDetails,
}: {
  readonly onSelectCommit?: (oid: string) => void;
  readonly onOpenDetails?: (oid: string) => void;
}) {
  const feature = usePanelFeature();
  const scope = useRepositoryScope();
  const path = isFileHistoryInput(feature?.input) ? feature.input.path : null;
  if (path === null || scope === undefined) return null;
  return (
    <DiffWorkerPool>
      <FileHistory
        key={path}
        scope={scope}
        path={path}
        onSelectCommit={onSelectCommit}
        onOpenDetails={onOpenDetails}
      />
    </DiffWorkerPool>
  );
}

function FileHistory({
  scope,
  path,
  onSelectCommit,
  onOpenDetails,
}: {
  readonly scope: RepositoryScope;
  readonly path: string;
  readonly onSelectCommit: ((oid: string) => void) | undefined;
  readonly onOpenDetails: ((oid: string) => void) | undefined;
}) {
  const feature = usePanelFeature();
  const { refs } = useScopedRepositoryRefs();
  const head =
    refs === undefined ? undefined : activeHead(refs, scope.worktreePath);
  const branch = head?.branch ?? head?.commit.slice(0, 8);
  const active = feature?.active !== false;
  const [limit, setLimit] = useState(fileHistoryPage);
  const target = {
    repositoryId: scope.repositoryId,
    worktreePath: scope.worktreePath,
  };
  const history = useEnvironmentQuery(
    FileHistoryApi.read,
    { ...target, path, limit },
    { changes: "refs", enabled: active, keepPrevious: true },
  );
  const entries = history.data?.entries ?? [];
  const [selectedOid, setSelectedOid] = useState<string>();
  const entry =
    entries.find((candidate) => candidate.oid === selectedOid) ?? entries[0];
  const diff = useEnvironmentQuery(
    CommitInspectionApi.inspectDiff,
    entry === undefined
      ? skipToken
      : {
          ...target,
          oid: entry.oid,
          ...(entry.parentOid === null ? {} : { parentOid: entry.parentOid }),
          path: entry.path,
          ...(entry.previousPath === null
            ? {}
            : { previousPath: entry.previousPath }),
        },
    { changes: "none", enabled: active },
  );
  const [preferences, choosePreferences] = useDiffPreferences();
  const restore = useRestoreFiles(
    target,
    entry === undefined
      ? undefined
      : {
          oid: entry.oid,
          parentOid: entry.parentOid,
          files: [commitFile(entry)],
        },
    scope.connected && scope.writable,
  );
  const errorToast = useErrorToast();
  const select = (next: FileHistoryEntry) => {
    setSelectedOid(next.oid);
    onSelectCommit?.(next.oid);
  };
  const index = entry === undefined ? -1 : entries.indexOf(entry);
  const newer = entries[index - 1];
  const older = entries[index + 1];
  const complete = history.data?.complete ?? true;
  const loadMore = () => {
    if (!complete && !history.isFetching)
      setLimit((current) =>
        Math.min(maximumFileHistory, current + fileHistoryPage),
      );
  };
  const actionsFor = (row: FileHistoryEntry): readonly Action[] => [
    {
      id: "openDetails",
      label: "Open details",
      enabled: onOpenDetails !== undefined,
      run: () => onOpenDetails?.(row.oid),
    },
    ...restore.actionsFor([row.path], row.path),
    submenu({ id: "copy", label: "Copy", group: "edit" }, [
      {
        id: "copySha",
        label: "SHA",
        enabled: true,
        run: () =>
          void writeClipboardText(row.oid).catch(() =>
            errorToast.show("copySha"),
          ),
      },
      {
        id: "copySubject",
        label: "Subject",
        enabled: true,
        run: () =>
          void writeClipboardText(row.subject).catch(() =>
            errorToast.show("copySubject"),
          ),
      },
    ]),
  ];
  const latest = entries[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    <section aria-label="File history" className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-border border-b px-4 pt-3 pb-3">
        <h2
          className={`truncate font-semibold text-[1.05rem] ${latest?.status === "D" ? "text-rose-600 line-through dark:text-rose-400" : ""}`}
        >
          {name}
        </h2>
        <p className="truncate text-[.8rem] text-muted-foreground">
          {path.slice(0, path.length - name.length)}
        </p>
        {branch === undefined || history.data === undefined ? null : (
          <div className="mt-2 flex items-center gap-2 text-[.8rem] text-muted-foreground">
            <span>
              {entries.length === 0
                ? "No commits on"
                : `${entries.length.toLocaleString()}${complete ? "" : "+"} ${entries.length === 1 ? "commit" : "commits"} in`}
            </span>
            <CommitRefPill
              label={{
                name: branch,
                type: head?.branch === undefined ? "commit" : "branch",
              }}
            />
          </div>
        )}
      </header>
      {history.isError ? (
        <div role="alert" className="p-3 text-sm">
          {describeFailure(history.error)}{" "}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void history.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : history.data === undefined ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading history…
        </p>
      ) : entry === undefined ? null : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel id="history-diff" defaultSize="70%" minSize="12rem">
            <Suspense
              fallback={
                <p className="p-4 text-sm text-muted-foreground">
                  Loading diff viewer…
                </p>
              }
            >
              <CommitDiff
                key={entry.oid}
                file={commitFile(entry)}
                steps={{
                  previous: newer ? () => select(newer) : undefined,
                  next: older ? () => select(older) : undefined,
                }}
                diff={{
                  value: diff.data,
                  loading: diff.isLoading,
                  error: diff.isError ? describeFailure(diff.error) : null,
                  retry: () => void diff.refetch(),
                }}
                preview={false}
                preferences={preferences}
                choosePreferences={choosePreferences}
              />
            </Suspense>
          </ResizablePanel>
          <ResizableHandle aria-label="Resize commit list" />
          <ResizablePanel
            id="history-commits"
            defaultSize="21rem"
            groupResizeBehavior="preserve-pixel-size"
            minSize="12.5rem"
            maxSize="26rem"
          >
            <HistoryList
              entries={entries}
              active={entry}
              complete={complete}
              onSelect={select}
              onLoadMore={loadMore}
              actionsFor={actionsFor}
              onMenuClose={restore.endPreview}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      <RestoreConfirmation restore={restore} />
    </section>
  );
}

function commitFile(entry: FileHistoryEntry): CommitFile {
  return {
    path: entry.path,
    previousPath: entry.previousPath,
    status: entry.status,
    lines: entry.lines,
  };
}
