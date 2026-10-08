import { IconCloudDownload, IconLock } from "@tabler/icons-react";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import type { ChangedFile } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type LfsLock,
  type LockAction,
  RepositoryLfsApi,
} from "#contracts/repository-lfs/repository-lfs.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

type LargeFile = Pick<ChangedFile, "path" | "status" | "lfs">;

const lockLabels: Record<LockAction, string> = {
  Lock: "Lock",
  Unlock: "Unlock",
  ForceUnlock: "Force unlock",
};

export const missingReason = "Needs Git LFS";

function useLargeFilesState() {
  const scope = useRepositoryScope();
  const input =
    scope === undefined
      ? undefined
      : { repositoryId: scope.repositoryId, worktreePath: scope.worktreePath };
  const read = useEnvironmentQuery(RepositoryLfsApi.read, input ?? skipToken, {
    changes: "index",
  });
  return { input, read: read.data };
}

export function useLargeFiles(files: readonly LargeFile[]) {
  const { input, read } = useLargeFilesState();
  const used =
    (read?.patterns.length ?? 0) > 0 || files.some((file) => file.lfs);
  const locks = useEnvironmentQuery(
    RepositoryLfsApi.locks,
    used && read?.installed === true && input !== undefined ? input : skipToken,
    { changes: "refs" },
  );
  const errorToast = useErrorToast();
  const setTracked = useCommand(RepositoryLfsApi.setTracked);
  const setLock = useCommand(RepositoryLfsApi.setLock);
  const lockOf = (path: string) =>
    locks.data?.find((lock) => lock.path === path);
  const track = (pattern: string, tracked: boolean) =>
    void setTracked
      .run({ pattern, tracked })
      .then((result) => errorToast.failure("trackLargeFiles", result));
  const lock = (path: string, action: LockAction) =>
    void setLock
      .run({ path, action })
      .then((result) => errorToast.failure("lockFile", result));
  const patternActions = (
    id: string,
    patterns: readonly string[],
    tracked: boolean,
  ): readonly Action[] =>
    patterns.map((pattern) => ({
      id: `${id}-${pattern}`,
      label: pattern,
      enabled: true,
      run: () => track(pattern, tracked),
    }));
  return {
    missing: used && read?.installed === false,
    blocked: (paths: readonly string[]) =>
      read?.installed === false &&
      files.some((file) => file.lfs && paths.includes(file.path)),
    lockOf,
    actions: (paths: readonly string[]): readonly Action[] => {
      const file = files.find((candidate) => candidate.path === paths[0]);
      if (read?.installed !== true || paths.length !== 1 || file === undefined)
        return [];
      if (!file.lfs)
        return file.status === "D"
          ? []
          : [
              submenu(
                { id: "track-lfs", label: "Track with LFS", group: "edit" },
                patternActions("track", trackingPatterns(file.path), true),
              ),
            ];
      const untrack = trackingPatterns(file.path).filter((pattern) =>
        read.patterns.includes(pattern),
      );
      const current = lockOf(file.path);
      const action: LockAction =
        current === undefined
          ? "Lock"
          : current.ours
            ? "Unlock"
            : "ForceUnlock";
      return [
        ...(untrack.length === 0
          ? []
          : [
              submenu(
                {
                  id: "untrack-lfs",
                  label: "Stop tracking with LFS",
                  group: "edit",
                },
                patternActions("untrack", untrack, false),
              ),
            ]),
        ...(locks.data === undefined
          ? []
          : [
              {
                id: "lock",
                label: lockLabels[action],
                enabled: !setLock.running,
                group: "edit" as const,
                run: () => lock(file.path, action),
              },
            ]),
      ];
    },
  };
}

function missingDiff(data: unknown, path: string) {
  return (
    typeof data === "object" &&
    data !== null &&
    "kind" in data &&
    data.kind === "missing" &&
    "path" in data &&
    data.path === path
  );
}

export function trackingPatterns(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1
    ? [`*${name.slice(dot)}`, path]
    : [path];
}

export function LockMark({ lock }: { readonly lock: LfsLock }) {
  return (
    <span className="flex min-w-14 items-center justify-end gap-1 pr-1 text-badge text-muted-foreground">
      <IconLock aria-hidden="true" className="size-3 shrink-0" />
      <span className="sr-only">Locked by</span>
      <span className="truncate">{lock.ours ? "you" : lock.owner}</span>
    </span>
  );
}

export function LargeFilesNotice() {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-border border-b bg-muted/40 px-3 py-2 text-meta"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-status-connecting"
      />
      Git LFS isn't installed on this server.
    </div>
  );
}

export function NotDownloaded({
  path,
  bytes,
  commits,
}: {
  readonly path: string;
  readonly bytes: number;
  readonly commits: readonly string[];
}) {
  const { read } = useLargeFilesState();
  const queryClient = useQueryClient();
  const statusToast = useStatusToast();
  const errorToast = useErrorToast();
  const download = useCommand(RepositoryLfsApi.download, {
    progress: ({ percent }) =>
      statusToast.advance("downloadLargeFiles", percent),
  });
  const start = () => {
    statusToast.progress("downloadLargeFiles", "Pulling large files", {
      percent: 0,
      cancel: download.cancel,
    });
    void download.run({ paths: [path], commits }).then((result) => {
      if (result._tag !== "Ok")
        return errorToast.failure("downloadLargeFiles", result);
      statusToast.success("downloadLargeFiles", "Pulled large files");
      void queryClient.invalidateQueries({
        predicate: ({ state }) => missingDiff(state.data, path),
      });
    });
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground">
      <IconCloudDownload aria-hidden="true" className="size-8" />
      <p className="text-body">Not downloaded</p>
      <p className="text-meta">{bytes.toLocaleString()} bytes</p>
      {read?.installed === true ? (
        <Button
          size="xs"
          variant="outline"
          disabled={download.running}
          onClick={start}
        >
          Download
        </Button>
      ) : null}
    </div>
  );
}
